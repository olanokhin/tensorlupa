// Редактор micro-qwen3: генерирует историю тем же движком, что на ESP32-S3 (WebAssembly), записывает трассу каждого
// шага и даёт откатиться на любой токен. Версия 1: полоса логитов, история, таймлайн, настройки, инспектор.
import { Deck } from './cards.js';
import { Stage } from './stage.js';
import { Split } from './split.js';
import { DocPane } from './docs.js';
import { navPad } from './navpad.js';
import { popover } from './popover.js';
import { startTour } from './tour.js';
import { Controls } from './controls.js';
import { t, lang, LANGS, setLang } from './i18n.js';
import { loadEngine, Engine, Corpus } from './engine/engine.js';
import { LogitStrip, show } from './logits.js';
import { AttentionView } from './attention.js';
import { ModelView } from './modelview.js';
import { GrowthChart } from './growth.js';
import { DEF, QK, linkDefaults, DEMO_SEED, COMPLETION_SEED, MODELS, parseWords, PICKS_ALL, countRun, softmaxT, DOC_SLUG } from './core.js';

const $ = (id) => document.getElementById(id);
const P = {
  // seed по умолчанию — лучшая демо-история для слов по умолчанию (dragon, cookie, school): подобран перебором seed
  // (все слова на месте, закончилась сама, без повторов 4-грамм) и прочитан глазами, отдельно для каждой версии весов
  // (DEMO_SEED); кубик даёт случайные
  temperature: 0.6, topK: 40, minP: 0.02, seed: 1111,
  wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, loopPenalty: false,
  maxNew: 200, speed: 24, autoplay: true,
};
const S = { engine: null, run: null, cur: 0, timer: null, items: [] };
let engineReady; S.ready = new Promise((r) => { engineReady = r; });   // модель загружена и интерфейс привязан

function readLink() {
  const q = new URLSearchParams(location.search);
  if (q.has('q') && !q.has('seed')) S.bits = q.get('q') === '4' ? 4 : 8;   // «открыть 4-битную версию» с лендинга
  if (!q.has('seed')) return null;
  const D = linkDefaults(q);
  for (const [key, short] of Object.entries(QK)) {
    if (!q.has(short)) { P[key] = D[key]; continue; }
    const v = q.get(short);
    P[key] = typeof DEF[key] === 'boolean' ? v === '1' : Number(v);
  }
  P.seed = Math.max(1, Math.min(99999, Number(q.get('seed')) || 1));
  S.bits = q.get('q') === '8' ? 8 : 4;   // ссылка без q — со времён, когда в студии была только 4-битная версия
  if (q.get('mode') === 'lab' || q.get('mode') === 'guide') { S.mode = q.get('mode'); S.modeFromLink = true; }   // только на эту загрузку
  if (q.has('p')) { $('mode').value = 'continue'; $('prompt').value = q.get('p'); $('words').hidden = true; $('prompt').hidden = false; }
  else if (q.has('w')) $('words').value = q.get('w');
  return { step: q.has('s') ? Number(q.get('s')) : -1 };
}
function writeLink() {
  if (!S.run) return;
  const q = new URLSearchParams();
  if ($('mode').value === 'continue') q.set('p', $('prompt').value); else q.set('w', $('words').value.split(/[ ,]+/).filter(Boolean).join(','));
  q.set('seed', P.seed);
  for (const [key, short] of Object.entries(QK)) if (P[key] !== DEF[key]) q.set(short, typeof DEF[key] === 'boolean' ? (P[key] ? 1 : 0) : P[key]);
  q.set('s', S.cur);
  q.set('q', S.bits);
  if (S.mode === 'lab') q.set('mode', 'lab');
  history.replaceState(null, '', location.pathname + '?' + q.toString().replace(/%2C/g, ','));   // путь явно: на странице есть <base href="/">
}
try { S.mode = localStorage.getItem('mq.mode') || 'guide'; } catch { S.mode = 'guide'; }
try { S.bits = localStorage.getItem('mq.bits') === '4' ? 4 : 8; } catch { S.bits = 8; }
const LINK = readLink();
// штраф за повторы с учётом корпуса и min-p 0.02 включены по умолчанию у обеих версий (замер в micro-qwen3,
// experiments/ngram: зацикленных историй 9–16% → 1–2%, историй с обломками слов не больше, у 4 бит — вдвое меньше)
if (!LINK) P.loopPenalty = DEF.loopPenalty;
if (!LINK) P.seed = DEMO_SEED[S.bits];

// Гайд · Лаб: Гайд — главное простыми словами (простые логиты, одна карточка «что произошло», только сэмплинг,
// 3D и веса attention), Лаб — весь редактор. Названия про вид, а не про человека.
function setMode(m, persist = true) {
  S.mode = m;
  document.body.dataset.mode = m;
  setPair('mode-pair', m);
  if (persist) try { localStorage.setItem('mq.mode', m); } catch { /* без памяти — только на эту загрузку */ }
  if (S.deck) { S.deck.show('order', m === 'lab'); S.deck.setLead(m === 'guide' ? t('g.title') : null); S.deck.setMode(m); }   // в Гайде «что произошло» — первой
  if (m === 'guide' && S.engine) {
    if (S.view !== '3d') switchView('3d');
    if (S.amode !== 'look') { S.amode = 'look'; S.attn.mode = 'look'; setPair('amode-pair', 'look'); }
  }
  if (S.stage) S.stage.layout();
  if (S.run) { setCur(S.cur); writeLink(); }
  requestAnimationFrame(() => { if (S.strip) S.strip.draw(); });
}
// модели студии: пока одна; новые добавляются сюда и появляются в меню модели
const MODEL = () => MODELS.find((m) => m.bits === S.bits) || MODELS[0];
const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M5 3.1v9.8a.7.7 0 0 0 1.06.6l7.7-4.9a.7.7 0 0 0 0-1.2l-7.7-4.9A.7.7 0 0 0 5 3.1z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="2.8" height="10" rx="0.9"/><rect x="9.2" y="3" width="2.8" height="10" rx="0.9"/></svg>';
window.__viz = S;   // для отладки из консоли

// ---------------------------------------------------------------- загрузка
async function boot() {
  try {
    const buf = new Uint8Array(await (await fetch(MODEL().file)).arrayBuffer());
    S.modelBytes = buf.length;
    S.engine = await loadEngine(buf);
  } catch (e) {
    $('status').textContent = t('status.fail', { msg: e.message }); $('status').classList.add('fail');
    return;
  }
  const i = S.engine.info;
  // справка о модели (слои, головы, словарь) — в меню модели, а не в навбаре: строка состояния нужна только на время
  // загрузки и для ошибки, потом исчезает и не сдвигает кнопки
  $('status').textContent = ''; $('status').hidden = true;
  S.strip = new LogitStrip($('logits-canvas'), $('tip'), S.engine.tokenText);
  S.amode = 'look';
  S.attn = new AttentionView($('attn-canvas'), (sel) => { tintStory(); linkAttnToModel(); renderInspector(S.run.steps[S.cur]); });
  S.attn.engine = S.engine; S.attn.mode = S.amode;
  // связь окон: голова под курсором или выбранная во «Внимании» обводит пластину голов своего слоя в «Модели»
  S.attn.onHover = () => linkAttnToModel();
  // счёт какого слова показывать в карточке головы: то же слово, за которым следят в «Модели»
  S.attn.tokFn = () => (S.v3d && S.v3d.step ? S.v3d.tok : S.run.steps[S.cur].output);
  // 3D нужен WebGL. На некоторых машинах его нет (Linux с отключённым драйвером, школьные компьютеры, старые
  // видеокарты): тогда обе панели сразу в 2D, переключатели 3D скрыты, Гайд не возвращает 3D (no3d).
  let View3D = null;
  if (webglOK()) {
    try { ({ View3D } = await import('./view3d.js')); }   // 3D только у «Модели»; «Внимание» плоское
    catch (e) { console.error(e); }
  }
  S.growth = new GrowthChart($('growth-canvas'), S.engine.info);
  S.model = new ModelView($('model-canvas'), S.engine);
  S.view = '3d';
  if (View3D) try { S.v3d = new View3D($('model-3d'), S.engine); S.v3d.onSelect = () => { linkModelToAttn(); renderInspector(S.run.steps[S.cur]); };
    S.v3d.onHover = (pl, idx) => { S.attn.link = pl && pl.kind === 'heads' ? { layer: pl.layer, head: idx >= 0 && idx < S.engine.info.heads ? idx : -1 } : null; S.attn.cardKey = ''; S.attn.draw(); }; }
  catch (e) { S.v3d = null; console.error(e); }
  if (!S.v3d) no3d();              // 3D теперь только у «Модели»; «Внимание» плоское и от WebGL не зависит
  // драйвер может потерять WebGL и позже: тогда тоже переходим на 2D, а не оставляем чёрный прямоугольник
  for (const v of [S.v3d]) v?.renderer?.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); no3d(); });
  // управление 3D-видами: выпадающая стеклянная панель в углу (камера, раздвинуть, линии, сброс)
  S.spreadK = 1;
  if (S.v3d) navPad($('model-3d'), {
    view: () => S.v3d,
    spread: { get: () => (S.spreadK - 0.6) / 1.4, set: (f) => { S.spreadK = 0.6 + 1.4 * f; S.v3d.setSpread(S.spreadK); } },
    toggles: [{ label: t('nav.traces'), icon: 'lines', get: () => S.v3d.wiresOn !== false, set: (on) => S.v3d.showWires(on) }],
    reset: () => { S.spreadK = 1; S.v3d.setSpread(1); S.v3d.preset('perspective', true); },
  });
  bindUI();
  S.booted = true;
  engineReady();
  offerTour();
  if (LINK) generate({ atStep: LINK.step });      // открыли ссылку на эксперимент — показать ровно его
  else if (S.pendingGen) generate();                // нажали «Сгенерировать», пока модель грузилась
}

// ---------------------------------------------------------------- панель настроек
function buildPane() {
  // настройки — три карточки картотеки; элементы в стиле панели камеры (controls.js).
  // Всё, что меняет сам вывод модели, — в «Сэмплинге» и «Ограничениях»; «Воспроизведение» только показывает готовый
  // прогон (скорость, по токену) и есть в обоих режимах.
  S.deck = new Deck($('side'));
  const L = (k) => t('set.' + k);
  const fs = new Controls(S.deck.add('sampling', t('card.sampling')), P, live)
    .slider('temperature', L('temperature'), 0.05, 1.5, 0.05).slider('topK', L('topK'), 1, 64, 1).slider('minP', L('minP'), 0, 0.2, 0.01)
    .slider('seed', L('seed'), 1, 99999, 1).slider('maxNew', L('maxNew'), 20, 220, 10).toggle('loopPenalty', L('loopPenalty'));
  const fo = new Controls(S.deck.add('order', t('card.order')), P, live)
    .slider('wbBase', L('wbBase'), 0, 6, 0.25).slider('wbTau', L('wbTau'), 10, 400, 10)
    .slider('wbStart', L('wbStart'), 0, 1, 0.25).toggle('fsm', L('fsm'));
  const runHost = S.deck.add('run', t('card.run'));
  const fp = new Controls(runHost, P, live)
    .slider('speed', L('speed'), 1, 120, 1)
    .toggle('autoplay', L('autoplay'));
  // плеер — только показ готового прогона: модель уже всё посчитала, скорость показа на неё не влияет
  const rn = document.createElement('div'); rn.id = 'run-note'; rn.className = 'run-note'; rn.textContent = t('card.runNote0'); runHost.appendChild(rn);
  document.querySelectorAll('#side .card-t').forEach((el) => { if (el.textContent === t('card.sampling')) el.dataset.term = 'sampling'; });
  const panes = [fs, fo, fp];
  S.pane = { refresh: () => panes.forEach((x) => x.refresh()) };
}

// ---------------------------------------------------------------- генерация
// живые настройки: любое изменение, влияющее на текст, пересчитывает историю с тем же seed (~90 мс), без анимации,
// на том же шаге — видно, что меняет именно эта настройка. Не чаще раза за кадр.
const LIVE = new Set(['temperature', 'topK', 'minP', 'seed', 'wbBase', 'wbTau', 'wbStart', 'fsm', 'loopPenalty', 'maxNew']);
function live(key) {
  if (!LIVE.has(key) || !S.run) return;
  if (live.raf) return;
  live.raf = requestAnimationFrame(() => { live.raf = 0; generate({ live: true }); });
}

function wordsHint(key, field = 'words') {
  let h = document.getElementById('words-hint');
  if (!key) { h?.remove(); return; }
  if (!h) { h = document.createElement('div'); h.id = 'words-hint'; h.className = 'cc-mod words-hint'; document.body.appendChild(h); }
  h.textContent = t(key);
  const r = $(field).getBoundingClientRect();
  h.style.left = r.left + 'px'; h.style.top = (r.bottom + 8) + 'px';
  clearTimeout(wordsHint.tm); wordsHint.tm = setTimeout(() => h.remove(), 5000);
}

const PICKS = PICKS_ALL.map(([ws, s4, s8]) => [ws, S.bits === 4 ? s4 : s8]);
function picksMenu() {
  const w = $('words'), box = document.createElement('div');
  box.className = 'cc-mod words-picks'; box.hidden = true;
  box.innerHTML = `<div class="wp-title">${t('picks.title')}</div>` +
    PICKS.map(([ws, seed], i) => `<button class="wp-row" data-i="${i}"><span>${ws}</span><small>seed ${seed}</small></button>`).join('');
  document.body.appendChild(box);
  const place = () => { const r = w.getBoundingClientRect(); box.style.left = r.left + 'px'; box.style.top = (r.bottom + 8) + 'px'; box.style.minWidth = Math.max(260, r.width) + 'px'; };
  // при фокусе — весь список; при наборе — строки, где есть все набранные слова; пустое поле — снова весь список
  const filter = (byText) => {
    const q = byText ? w.value.toLowerCase().split(/[ ,]+/).filter(Boolean) : [];
    const all = !q.length;
    let n = 0;
    box.querySelectorAll('.wp-row').forEach((b) => { const ws = PICKS[Number(b.dataset.i)][0]; const on = all || q.every((x) => ws.includes(x)); b.hidden = !on; n += on; });
    return n;
  };
  const show = (on, byText = false) => { if (on && filter(byText)) { wordsHint(null); place(); box.hidden = false; } else box.hidden = true; };
  w.addEventListener('focus', () => show(true));
  w.addEventListener('blur', () => show(false));
  w.addEventListener('input', () => show(true, true));
  w.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') show(false); });
  box.addEventListener('mousedown', (e) => e.preventDefault());   // клик по списку не уводит фокус раньше времени
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.wp-row'); if (!b) return;
    const [ws, seed] = PICKS[Number(b.dataset.i)];
    w.value = ws; P.seed = seed; S.pane.refresh(); w.blur(); generate();
  });
  addEventListener('resize', () => { if (!box.hidden) place(); });
}


// newSeed — «другая история»; live — пересчёт после изменения настройки (без анимации, на том же шаге)
function generate({ newSeed = false, live: isLive = false, atStep = -1 } = {}) {
  if (!S.engine) { S.pendingGen = true; return; }   // модель ещё грузится — запустим сразу после загрузки
  const keepStep = isLive ? S.cur : -1;
  stop();
  const mode = $('mode').value;
  let words = '';
  if (mode === 'order') {
    const pw = parseWords($('words').value);
    if (!pw.words.length) { wordsHint(pw.foreign ? 'words.foreign' : 'words.empty'); return; }   // пустой заказ не запускаем
    wordsHint(pw.foreign ? 'words.foreign' : pw.extra ? 'words.extra' : null);
    words = pw.words.join(', ');
  } else if (!$('prompt').value.trim()) { wordsHint('prompt.empty', 'prompt'); return; }   // пустое начало — нечего продолжать
  else wordsHint(null);
  const prompt = mode === 'order' ? Engine.orderPrompt(words) : $('prompt').value;
  if (newSeed) { P.seed = 1 + Math.floor(Math.random() * 99999); S.pane.refresh(); }
  // штраф за повторы опирается на статистику корпуса (corpus-4grams.bin, ~2,3 МБ): грузим при первом включении
  if (P.loopPenalty && !S.engine.corpus) {
    S.corpusLoading ||= fetch('corpus-4grams.bin').then((r) => r.arrayBuffer()).then((b) => { S.engine.corpus = new Corpus(new Uint8Array(b)); })
      .catch((e) => { console.error(e); S.corpusLoading = null; });
    S.corpusLoading.then(() => { if (S.engine.corpus) generate({ live: isLive, atStep }); });
    return;
  }
  S.engine.settings({ temperature: P.temperature, topK: P.topK, seed: P.seed, wbBase: P.wbBase, wbTau: P.wbTau,
    wbStart: P.wbStart, fsm: P.fsm, corpusPenalty: P.loopPenalty, minP: P.minP, maxNew: P.maxNew });
  const t0 = performance.now();
  S.run = S.engine.run(prompt, words);
  const ms = performance.now() - t0;
  if (!isLive && S.mode === 'guide' && !document.querySelector('.tour-card')) setTimeout(hoverHint, 1800);   // «наведите на подчёркнутое» — один раз
  if ($('run-note')) $('run-note').textContent = t('card.runNote', { ms: ms < 10 ? ms.toFixed(1) : ms.toFixed(0) });
  const gen = S.run.steps.filter((s) => s.kind === 'gen');
  const last = S.run.steps[S.run.steps.length - 1];
  $('story-sub').textContent = t('story.sub', { gen: gen.length, ms: ms.toFixed(0), seed: P.seed,
    words: last && last.words.length ? `${last.wordsUsed}/${last.words.length}` : '' });
  // квитанция прогона: доказательство, что история посчитана здесь и сейчас
  const tps = gen.length / Math.max(ms, 1) * 1000, at = new Date().toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const ri = $('run-info');
  const rv = { at, np: S.run.nPrompt, ng: gen.length, ms: ms.toFixed(0), tps: Math.round(tps), seed: P.seed };
  ri.innerHTML = t('run.info', rv); ri.title = t('run.title', rv);
  if (S.booted && !isLive) { ri.classList.remove('fresh'); void ri.offsetWidth; ri.classList.add('fresh'); }   // не при загрузке и не на живом пересчёте
  buildStory();
  S.stage?.layout();   // высота панели истории — по новому тексту
  if (!isLive) countRun();
  const firstGen = Math.max(0, S.run.nPrompt - 1);
  $('t-range').max = S.run.steps.length - 1;
  if (atStep >= 0) setCur(Math.min(atStep, S.run.steps.length - 1));   // ссылка на шаг (в том числе из Docs, с live)
  else if (isLive) setCur(Math.min(Math.max(keepStep, firstGen), S.run.steps.length - 1));
  else if (P.autoplay) { setCur(firstGen); play(); } else setCur(S.run.steps.length - 1);
}

// ---------------------------------------------------------------- история: токены, по которым можно ходить
// нужная панели истории высота: текст (по его настоящим строкам, а не по высоте коробки) + заголовок и поля
function storyFit() {
  const t = $('story-text'); if (!t || !t.firstChild) return 0;
  const r = document.createRange(); r.selectNodeContents(t);
  const h = r.getBoundingClientRect().height; if (!h) return 0;
  const cs = getComputedStyle(t), pane = $('story');
  return h + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + t.parentElement.offsetTop + parseFloat(getComputedStyle(pane).paddingBottom) + 6;
}
function buildStory() {
  const box = $('story-text'); box.textContent = '';
  const steps = S.run.steps, tt = S.engine.tokenText;
  S.items = [];
  const add = (tok, step, cls) => {
    const sp = document.createElement('span');
    const special = tok <= 2;
    sp.className = 'tok ' + cls + (special ? ' special' : '');
    if (special) sp.dataset.term = 'specialTokens';   // служебные метки чата: подсказка «что это»
    sp.textContent = special ? tt[tok] : tt[tok];
    if (step >= 0) { sp.dataset.step = step; sp.addEventListener('click', () => { stop(); setCur(step); }); }
    box.appendChild(sp);
    S.items.push({ el: sp, step });
  };
  if (steps.length) add(steps[0].input, -1, 'prompt');
  steps.forEach((s, i) => {
    if (s.kind === 'prompt') { add(s.output, i, 'prompt'); return; }
    if (i === S.run.nPrompt - 1) { const br = document.createElement('span'); br.className = 'prompt-sep'; box.appendChild(br); }
    const biased = s.bias.some((b) => b.tok === s.output && b.val < 1e8);
    add(s.output, i, 'gen' + (s.forced >= 0 ? ' forced' : '') + (biased ? ' biased' : ''));
  });
}

function setCur(i) {
  if (!S.run || !S.run.steps.length) return;
  S.cur = Math.max(0, Math.min(S.run.steps.length - 1, i));
  clearTimeout(setCur.lt); setCur.lt = setTimeout(writeLink, 300);
  const step = S.run.steps[S.cur];
  for (const it of S.items) {
    it.el.classList.toggle('cur', it.step === S.cur);
    it.el.classList.toggle('future', it.step > S.cur);
  }
  const curEl = S.items.find((it) => it.step === S.cur);
  // прокручиваем только текст истории (scrollIntoView прокрутил бы и родителей — всю левую часть)
  if (curEl) {
    const box = $('story-text'), r = curEl.el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.bottom > b.bottom - 4) box.scrollTop += r.bottom - b.bottom + 8;
    else if (r.top < b.top + 4) box.scrollTop -= b.top - r.top + 8;
  }
  $('t-range').value = S.cur; fillRange($('t-range'));
  $('t-label').textContent = step.kind === 'gen' ? t('t.label.gen', { step: S.cur + 1, total: S.run.steps.length, tok: step.genIndex + 1 })
    : t('t.label.prompt', { step: S.cur + 1, total: S.run.steps.length });
  S.strip.set(step, P.temperature > 0 ? S.run.settings.temperature : 1);
  renderSimpleLogits(step);
  $('logits-sub').textContent = t('logits.sub.head', { step: S.cur + 1, tok: show(S.engine.tokenText[step.input]) }) +
    (step.forced >= 0 ? t('logits.sub.forced') : step.kind === 'prompt' ? t('logits.sub.prompt')
      : t('logits.sub.gen', { temp: S.run.settings.temperature, topk: S.run.settings.topK }));
  S.attn.set(S.run.steps, S.cur, S.engine.info);
  S.growth.set(step.pos);
  if (S.view === 'schema') S.model.set(step); else S.model.step = step;
  if (S.v3d && S.view === '3d') S.v3d.set(step, true, S.timer ? Math.min(600, 900 / P.speed) : 600, S.run.steps);
  tintStory();
  renderInspector(step);
}

// подсветка истории весами внимания выбранной головы: куда смотрит текущий токен
function tintStory() {
  const w = S.attn.weights(S.amode);
  const sel = S.attn.sel, rgb = S.amode === 'contrib' ? '169,140,240' : '217,137,74';
  const contrib = S.amode === 'contrib';
  $('attn-sub').textContent = sel.layer < 0 ? t('attn.sub.all', { contrib })
    : t('attn.sub.one', { contrib, head: sel.head + 1, layer: sel.layer + 1 });
  for (const it of S.items) {
    const key = it.step + 1;                       // позиция токена в тексте (первый токен промпта — 0)
    const v = w && key <= S.cur ? w[key] : 0;
    it.el.style.backgroundColor = v > 0.01 && !it.el.classList.contains('cur') ? `rgba(${rgb},${Math.min(0.85, Math.sqrt(v))})` : '';
    it.el.classList.toggle('kv-sel', key === S.attn.selTok);      // выбранная запись KV-кэша в окне «Внимание»
  }
}

// ---------------------------------------------------------------- воспроизведение
function play() {
  if (!S.run) return;
  if (S.cur >= S.run.steps.length - 1) setCur(Math.max(0, S.run.nPrompt - 1));
  stop();
  $('t-play').innerHTML = ICON_PAUSE; $('gen').classList.add('busy'); genSpeed();   // огоньки кнопки бегут быстрее, пока печатается
  S.timer = setInterval(() => {
    if (S.cur >= S.run.steps.length - 1) { stop(); return; }
    setCur(S.cur + 1);
  }, 1000 / P.speed);
}
function stop() { if (S.timer) clearInterval(S.timer); S.timer = null; $('t-play').innerHTML = ICON_PLAY; $('gen').classList.remove('busy'); genSpeed(); }

// ---------------------------------------------------------------- инспектор шага
// Гайд: «модель выбирала между» — пять кандидатов с процентами вместо полосы из 64 столбиков
function renderSimpleLogits(s) {
  const box = $('logits-simple'); if (S.mode !== 'guide') return;
  const tt = S.engine.tokenText, top = s.topk.slice().sort((a, b) => b.p - a.p).slice(0, 5);
  box.innerHTML = `<div class="ls-title"><span data-term="logits">${t('g.choose')}</span></div>` + top.map((c) => `<div class="ls-row${c.tok === s.output ? ' on' : ''}">` +
    `<span class="tokpill">${esc(show(tt[c.tok]))}</span><span class="ls-bar"><i style="width:${(100 * c.p).toFixed(1)}%"></i></span>` +
    `<span class="ls-p">${c.p < 0.01 ? '<1' : (100 * c.p).toFixed(0)}%</span></div>`).join('') +
    `<div class="ls-note">${t('g.spaceNote')}</div>`;
  const note = box.querySelector('.ls-note'); if (note && box.scrollHeight > box.clientHeight + 1) note.hidden = true;   // пояснение — только если есть место
}

// Гайд: что произошло на шаге — простыми словами, с отраслевым термином там, где он нужен
function guideCard(s) {
  const tt = S.engine.tokenText, pill = (x) => `<span class="tokpill">${esc(show(tt[x]))}</span>`;
  const top = s.topk.slice().sort((a, b) => b.p - a.p)[0];
  let h = `<h4>${t('g.title')}</h4>`;
  if (s.kind === 'prompt') return h + `<div class="note">${t('g.prompt', { out: pill(s.output) })}</div>`;
  if (s.output <= 2) h += `<div class="note">${t('g.end')}</div>`;
  else h += `<div class="note">${t('g.read', { in: pill(s.input), out: pill(s.output) })}</div>`;
  if (s.forced >= 0) h += `<div class="note">${t('g.forced')}</div>`;
  else if (top && top.tok === s.output) h += `<div class="note">${t('g.top')}</div>`;
  else if (top) h += `<div class="note">${t('g.notTop', { top: pill(top.tok), t: S.run.settings.temperature })}</div>`;
  // доплата к логиту сама по себе ничего не говорит новичку («+4,2 к чему?»), поэтому показываем её эффект:
  // шанс слова без доплаты и с ней, при той же температуре (как белая черта на полосе логитов в Лабе)
  const pushes = s.bias.filter((x) => x.val < 1e8);
  if (pushes.length) {
    const T = S.run.settings.temperature, pRaw = softmaxT(s.logitsRaw, T), pFin = softmaxT(s.logitsFinal, T);
    const nf1 = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }), nf0 = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
    const pc = (p) => (p < 0.001 ? '<' + nf1.format(0.1) + '%' : (p < 0.1 ? nf1 : nf0).format(100 * p) + '%');
    const felt = pushes.filter((x) => pFin[x.tok] >= 0.01);   // доплата, которая на этом шаге заметно меняет шанс
    h += `<div class="note">${felt.length ? t('g.boost', { list: felt.map((x) => `${pill(x.tok)} ${pc(pRaw[x.tok])} → ${pc(pFin[x.tok])}`).join(', ') }) : t('g.boostSmall')}</div>`;
  }
  // штраф за повторы с учётом корпуса: какой токен и почему (фраза из четырёх токенов уже была в истории)
  for (const x of s.loop) if (x.gram && !x.twin) h += `<div class="note">${t('g.loop', { tok: pill(x.tok), gram: x.gram.map(pill).join(''), val: Math.abs(x.val).toFixed(0) })}</div>`;
  const level = s.entropy < 1 ? 0 : s.entropy < 3 ? 1 : 2;
  h += `<div class="note">${t('g.conf', { level, bits: s.entropy.toFixed(1) })}</div>`;
  if (s.words.length) {
    h += `<h4>${t('insp.words')}</h4><table class="words"><tr><th>${t('insp.word')}</th><th>${t('insp.state')}</th></tr>`;
    for (const w of s.words) h += `<tr><td>${esc(w.text)}</td><td><span class="st st${w.state}">${t('word.state')[w.state]}</span></td></tr>`;
    h += '</table>';
  }
  return h;
}

function renderInspector(s) {
  if (S.mode === 'guide') { S.deck.sync(guideCard(s)); return; }
  const tt = S.engine.tokenText, pill = (t) => `<span class="tokpill">${esc(show(tt[t]))}</span>`;
  const chosen = s.topk.find((c) => c.tok === s.output);
  const how = t(s.kind === 'prompt' ? 'insp.how.prompt' : s.forced >= 0 ? 'insp.how.forced' : 'insp.how.sampled');
  let h = (S.v3d && S.view === '3d' ? S.v3d.describe() : '');
  if (S.run && S.attn.steps) {
    const sel = S.attn.sel, look = S.attn.weights('look'), con = S.attn.weights('contrib');
    if (look && con) {
      const top = Array.from(look.keys()).sort((a, b) => (look[b] + con[b]) - (look[a] + con[a])).slice(0, 6);
      const who = sel.layer >= 0 ? t('insp.cmp.one', { head: sel.head + 1, layer: sel.layer + 1 }) : t('insp.cmp.all');
      h += `<h4>${t('insp.cmp.head', { who })}</h4><table class="cmp"><tr><th>${t('insp.cmp.token')}</th><th class="bar-look"><span data-term="weights">${t('insp.cmp.look')}</span></th><th class="bar-contrib"><span data-term="valueWeighted">${t('insp.cmp.contrib')}</span></th></tr>` +
        top.map((t) => `<tr><td>${pill(S.run.steps[t].input)} <span style="color:var(--dim)">#${t}</span></td><td class="bar-look">${(100 * look[t]).toFixed(0)}%</td><td class="bar-contrib">${(100 * con[t]).toFixed(0)}%</td></tr>`).join('') +
        `</table><div class="note">${t('insp.cmp.note')}</div>`;
    }
  }
  h += `<h4>${t('insp.step', { n: S.cur + 1 })}</h4><div class="kv">
    <div>${t('insp.pos')}</div><div>${s.pos}</div>
    <div><span data-term="token">${t('insp.in')}</span></div><div>${pill(s.input)}</div>
    <div>${t('insp.out')}</div><div>${pill(s.output)} <span style="color:var(--muted)">${how}</span></div>
    <div><span data-term="pOut">${t('insp.pout')}</span></div><div>${s.forced >= 0 ? t('insp.forced100') : chosen ? (100 * chosen.p).toFixed(1) + '%' : '—'}</div>
    <div><span data-term="entropy">${t('insp.entropy')}</span></div><div>${t('insp.bits', { x: s.entropy.toFixed(2) })}</div>
    ${s.kind === 'gen' && s.forced < 0 ? `<div><span data-term="sampleDraw">${t('insp.draw')}</span></div><div>${t('insp.drawMass', { x: (100 * s.sampleR).toFixed(1) })}</div>` : ''}
  </div>`;
  if (s.words.length) {
    h += `<h4>${t('insp.words')}</h4><table class="words"><tr><th>${t('insp.word')}</th><th>${t('insp.state')}</th><th>${t('insp.pieces')}</th></tr>`;
    for (const w of s.words) {
      h += `<tr><td>${esc(w.text)}</td><td><span class="st st${w.state}">${t('word.state')[w.state]}</span></td>` +
        `<td>${w.state === 1 || w.state === 2 ? w.k + '/' : ''}${w.pieces}</td></tr>`;
    }
    h += '</table>';
    const b = s.wb, val = b.base * (b.u + b.u0 + 1) * (1 + b.t / b.tau);
    const bt = `<h4>${t('insp.bias')}</h4>`;
    if (s.kind === 'prompt') h += bt + `<div class="note">${t('insp.bias.prompt')}</div>`;
    else if (s.wordsUsed >= s.words.length) h += bt + `<div class="note">${t('insp.bias.done')}</div>`;
    else h += bt + `<div class="formula"><div class="f-gen">base·(u + u0 + 1)·(1 + t/τ)</div><div class="f-sub">= ${b.base}·(${b.u} + ${b.u0} + 1)·(1 + ${b.t}/${b.tau})</div><div class="f-res">${t('insp.bias.formula', { val: val.toFixed(2) })}</div></div>
      <div class="note">${t('insp.bias.legend')}</div>`;
    const pushes = s.bias.filter((x) => x.val < 1e8);
    if (pushes.length) h += `<div class="note">${t('insp.pushed', { list: pushes.map((x) => pill(x.tok) + ' +' + x.val.toFixed(2)).join(' ') })}</div>`;
    if (s.forced >= 0) h += `<div class="note">${t('insp.fsm', { tok: pill(s.forced) })}</div>`;
    if (s.form >= 0) {
      const banned = s.logitsFinal.reduce((n, v) => n + (v <= -1e29), 0);
      h += `<div class="note">${t('insp.ended', { n: banned, except: s.allowed.length ? s.allowed.map(pill).join(' ') : '' })}</div>`;
    }
    if (s.loop.length) h += `<div class="note">${t('insp.loop', { list: s.loop.map((x) => pill(x.tok) + ' ' + x.val.toFixed(2)).join(' ') })}</div>`;
    // штраф с учётом корпуса: какая фраза из четырёх токенов уже была в этой истории
    for (const x of s.loop) if (x.gram && !x.twin) h += `<div class="note">${t('insp.loop.why', { gram: x.gram.map(pill).join(''), n: x.times })}</div>`;
  }
  S.deck.sync(h);
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- управление
// выбор из двух: подпись · тумблер · подпись; щелчок по подписи выбирает её вариант, по тумблеру — переключает
function setPair(id, v) {
  const el = $(id), opts = el.querySelectorAll('.pair-o');
  opts.forEach((o) => o.classList.toggle('on', o.dataset.v === v));
  el.querySelector('input').checked = opts[1].dataset.v === v;
  el.dataset.value = v;
}
function bindPair(id, fn) {
  const el = $(id), opts = el.querySelectorAll('.pair-o');
  opts.forEach((o) => o.addEventListener('click', () => fn(o.dataset.v)));
  el.querySelector('input').addEventListener('change', (e) => fn(opts[e.target.checked ? 1 : 0].dataset.v));
}
// есть ли WebGL: без него Three.js не создаст сцену
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
// 3D недоступен: обе панели в 2D, переключатели 3D скрыты, в заголовках пояснение
function no3d() {
  S.no3d = true; S.v3d = null;
  document.body.classList.add('no3d');
  for (const id of ['view-model']) {      // «Внимание» плоское всегда, пометка про 3D ему не нужна
    const title = document.querySelector(`#${id} .vp-title`);
    if (title && !title.querySelector('.no3d-note')) { const n = document.createElement('span'); n.className = 'no3d-note'; n.textContent = t('no3d'); n.title = t('no3d.title'); title.appendChild(n); }
  }
  switchView('schema');
}
// «Модель» → «Внимание»: щелчок по плитке головы на пластине голов выбирает эту голову и там
function linkModelToAttn() {
  const sel = S.v3d && S.v3d.sel;
  if (!sel || sel.plate.kind !== 'heads' || sel.idx < 0 || sel.idx >= S.engine.info.heads) return;
  S.attn.sel = { layer: sel.plate.layer, head: sel.idx }; S.attn.cardKey = ''; S.attn.draw(); tintStory(); linkAttnToModel();
}
// «Внимание» → «Модель»: пластина голов слоя, где голова под курсором (или выбранная)
function linkAttnToModel() {
  if (!S.v3d) return;
  const c = S.attn.hoverCell && !S.attn.hoverCell.shelf ? S.attn.hoverCell : S.attn.sel.layer >= 0 ? S.attn.sel : null;
  S.v3d.linkPlate = c ? S.v3d.heads[c.layer] : null;
}

function switchView(v) {
  if (v === '3d' && !S.v3d) v = 'schema';
  S.view = v;
  setPair('view-pair', v);
  $('model-3d').hidden = v !== '3d'; $('model-canvas').hidden = v !== 'schema';
  $('model-sub').hidden = false;   // подзаголовок и в 3D: как у панели внимания
  $('model-sub').textContent = t(v === '3d' ? 'model.sub.3d' : 'model.sub.schema');
  if (S.run) { const st = S.run.steps[S.cur]; if (v === 'schema') S.model.set(st); else if (S.v3d) { S.v3d.resize(); S.v3d.set(st, false); } }
}

// заливка пройденной части у ползунков (CSS-переменная --p)
function fillRange(el) {
  const min = +el.min || 0, max = +el.max || 100, v = +el.value, f = max > min ? (v - min) / (max - min) : 0;
  // граница заливки — ровно под центром капли: центр ходит от 11px до (ширина − 11px), а не от края до края
  el.style.setProperty('--p', `calc(11px + ${f} * (100% - 22px))`);
  el._f = f;
  placeKnob(el);
}

// стеклянная ручка: элемент в слое поверх страницы, ставится по экранным координатам своего ползунка
function placeKnob(el) {
  const k = el._knob;
  if (!k) return;
  const r = el.getBoundingClientRect();
  if (!r.width || el.closest('[hidden]')) { k.style.display = 'none'; return; }
  k.style.display = '';
  const cx = r.left + 11 + (el._f || 0) * (r.width - 22);
  k.style.left = cx + 'px';
  k.style.top = r.top + r.height / 2 + 'px';
  // лупа: внутри капли дорожка есть только между её концами (центр капли в минимуме и в максимуме),
  // увеличена в M раз относительно центра капли; split — где кончается заливка (центр капли)
  const kw = k.classList.contains('drag') ? 30 : 22, M = 1.4, half = kw / 2;
  const toKnob = (x) => half + (x - cx) * M;              // экранная x -> координата внутри капли (с увеличением)
  const lcut = Math.max(0, toKnob(r.left + 11)), rcut = Math.max(0, kw - toKnob(r.right - 11));
  k.style.setProperty('--lcut', lcut + 'px'); k.style.setProperty('--rcut', rcut + 'px');
  k.style.setProperty('--split', Math.max(0, half - lcut) + 'px');
}
const glassRanges = [];
function glassRange(el) {
  const wrap = document.createElement('span'); wrap.className = 'rng-wrap';
  el.parentNode.insertBefore(wrap, el); wrap.appendChild(el);
  const knob = document.createElement('span'); knob.className = 'glass-knob'; document.body.appendChild(knob);
  el._knob = knob; glassRanges.push(el);
  const cs = getComputedStyle(el);                       // цвета дорожки этого ползунка — для лупы внутри капли
  knob.style.setProperty('--fill', cs.getPropertyValue('--fill').trim() || '#bbbcc4');
  knob.style.setProperty('--rest', cs.getPropertyValue('--rest').trim() || 'rgba(187,188,196,.14)');
  const up = () => { if (knob.classList.contains('drag')) { knob.classList.remove('drag'); placeKnob(el); } };
  el.addEventListener('pointerdown', () => { knob.classList.add('drag'); placeKnob(el); });
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  new ResizeObserver(() => placeKnob(el)).observe(el);
  fillRange(el);
}
// положение ручек обновляется при прокрутке, изменении окна и переключении видов
addEventListener('resize', () => glassRanges.forEach(placeKnob));
// левая часть — картотека: логиты и историю можно свернуть, модель и attention забирают освободившееся место
S.stage = new Stage($('stage'), {
  views: $('views'), player: $('player'),
  // в Гайде логиты — список из пяти строк: панели нужна высота на все пять, иначе последняя обрезается
  folds: [{ key: 'logits', el: $('logits'), share: 0.2, min: () => (S.mode === 'guide' ? 184 : 118), max: 230 },
          // история — по высоте текста (вся история считается сразу, поэтому высота не прыгает при проигрывании):
          // короткая — панель ниже, место уходит окнам 3D; длинная — до прежнего предела, дальше прокрутка
          { key: 'story', el: $('story'), share: 0.3, min: 118, max: 380, fit: storyFit }],
  onLayout: () => glassRanges.forEach(placeKnob),
});
// граница между моделью и attention: тянуть — соотношение, до края — панели складываются во вкладки
S.split = new Split($('views'), [
  { el: $('view-model'), label: t('model.title'), term: 'model' },
  { el: $('view-attn'), label: t('attn.title'), term: 'attention' },
  { el: $('view-docs'), label: t('docs.tab'), closable: true },
], { title: t('split.title'), closeLabel: t('docs.close'), onChange: () => glassRanges.forEach(placeKnob) });
// Docs внутри студии: статьи берутся с тех же страниц, что на сайте; открытая вкладка восстанавливается после перезагрузки
const DOCS_HOME = `/${lang === 'en' ? '' : lang + '/'}docs/`;
S.docs = new DocPane($('view-docs'), { t, home: DOCS_HOME, onStudio: (href) => openStudioLink(href) });
if (S.split.isOpen(2)) S.docs.load(S.docs.last() || DOCS_HOME, { push: false });
function openDoc(href) { S.split.open(2); S.docs.load(href); }
// ссылки на статьи из 3D-вида (карточка шага) открываются так же: во вкладке Docs рядом, а не в новой вкладке браузера
window.addEventListener('mq-open-doc', (e) => openDoc(e.detail));
// ссылка «открыть этот шаг» из статьи: без перезагрузки страницы. Ползунки плавно едут к значениям ссылки
// (чего в ссылке нет — к значениям по умолчанию, иначе шаг был бы другим), затем пересчёт с тем же seed (десятки мс)
// и курсор на шаг. Если настройки уже те же — сразу на шаг, без пересчёта. Вкладка Docs остаётся рядом.
function openStudioLink(href) {
  const q = new URL(href, location.href).searchParams;
  // ссылка на другую версию весов (без q — 4 бита, так записаны примеры в Docs) — открываем страницу заново с ней
  if (!q.has('seed') || !S.run || (q.get('q') === '8' ? 8 : 4) !== S.bits) { location.href = href; return; }
  const target = {};
  const LD = linkDefaults(q);
  for (const [key, short] of Object.entries(QK)) target[key] = q.has(short) ? (typeof DEF[key] === 'boolean' ? q.get(short) === '1' : Number(q.get(short))) : LD[key];
  target.seed = Math.max(1, Math.min(99999, Number(q.get('seed')) || 1));
  const step = q.has('s') ? Number(q.get('s')) : -1;
  const textSame = q.has('p') ? $('mode').value === 'continue' && $('prompt').value === q.get('p')
    : $('mode').value === 'order' && parseWords($('words').value).words.join(',') === parseWords(q.get('w') || '').words.join(',');
  if (q.has('p')) { $('mode').value = 'continue'; $('prompt').value = q.get('p'); } else { $('mode').value = 'order'; if (q.has('w')) $('words').value = q.get('w').split(',').join(', '); }
  $('words').hidden = q.has('p'); $('prompt').hidden = !q.has('p');
  const same = textSame && Object.keys(target).every((k) => P[k] === target[k]);
  stop();
  if (same) { setCur(step >= 0 ? step : S.run.steps.length - 1); return; }
  const from = { ...P }, t0 = performance.now(), D = 380;
  const paint = () => { S.pane.refresh(); document.querySelectorAll('#side input[type=range]').forEach(fillRange); };
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / D), e = 1 - (1 - k) ** 3;
    for (const key of Object.keys(target)) {
      if (typeof target[key] !== 'number') { P[key] = target[key]; continue; }
      P[key] = k < 1 ? from[key] + (target[key] - from[key]) * e : target[key];
    }
    paint();
    if (k < 1) requestAnimationFrame(tick);
    else generate({ live: true, atStep: step });
  };
  requestAnimationFrame(tick);
}
// кнопка Docs в верхней панели: вкладка Docs на последней прочитанной статье (в первый раз — главная Docs)
$('docs-btn').addEventListener('click', () => { const was = S.split.isOpen(2); S.split.open(2); if (!was || !S.docs.url) S.docs.load(S.docs.last() || DOCS_HOME, { push: false }); });
addEventListener('scroll', () => glassRanges.forEach(placeKnob), true);
new MutationObserver(() => glassRanges.forEach(placeKnob)).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });

function bindUI() {
  // стеклянные ручки — у ползунков интерфейса; у ползунков панели камеры свой вид (как в Пункте управления)
  document.querySelectorAll('input[type=range]').forEach((el) => { if (el.closest('.cc, .cc-track')) return; glassRange(el); el.addEventListener('input', () => fillRange(el)); });
  bindPair('amode-pair', (v) => {
    S.amode = v; S.attn.mode = v; S.attn.draw();
    setPair('amode-pair', v); tintStory(); if (S.run) renderInspector(S.run.steps[S.cur]);
  });
  bindPair('view-pair', switchView);
  $('mode').addEventListener('change', () => {
    const order = $('mode').value === 'order';
    $('words').hidden = !order; $('prompt').hidden = order;
    // пока seed не трогали, у каждого режима свой проверенный: история по умолчанию хорошая в обоих
    const from = order ? COMPLETION_SEED : DEMO_SEED, to = order ? DEMO_SEED : COMPLETION_SEED;
    if (P.seed === from[S.bits]) { P.seed = to[S.bits]; S.pane.refresh(); }
  });
  $('t-range').addEventListener('input', (e) => { stop(); setCur(Number(e.target.value)); });
  $('t-prev').addEventListener('click', () => { stop(); setCur(S.cur - 1); });
  $('t-next').addEventListener('click', () => { stop(); setCur(S.cur + 1); });
  $('t-first').addEventListener('click', () => { stop(); setCur(Math.max(0, S.run.nPrompt - 1)); });
  $('t-last').addEventListener('click', () => { stop(); setCur(S.run.steps.length - 1); });
  $('t-play').addEventListener('click', () => (S.timer ? stop() : play()));
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { stop(); setCur(S.cur - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { stop(); setCur(S.cur + 1); e.preventDefault(); }
    else if (e.key === ' ') { (S.timer ? stop() : play()); e.preventDefault(); }
    else if (e.key === 'Home') { stop(); setCur(Math.max(0, S.run.nPrompt - 1)); }
    else if (e.key === 'End') { stop(); setCur(S.run.steps.length - 1); }
  });
}

const CHECK = '<svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const navBtn = (host, svg, title) => {
  const b = document.createElement('button'); b.className = 'navpad-btn lang-btn'; b.innerHTML = svg; b.title = title;
  $(host).appendChild(b); return b;
};

// каркас интерфейса — сразу, до загрузки модели: карточки настроек, пустые состояния, меню языка.
// Модель и 3D потом подгружаются внутрь уже стоящих рамок — ничего не появляется и не прыгает.
buildPane();
S.deck.sync(`<h4>${t('empty.title')}</h4><div class="note">${t('empty.insp')}</div>`);
$('story-text').innerHTML = `<div class="empty-hint">${t('empty.story')}</div>`;
modelMenu();
modeMenu();
aboutMenu();
langMenu();
shareMenu();
bindPair('mode-pair', (m) => setMode(m));
glossary();

// тур по Гайду: глубины 1–3. Перед шагом — нужная панель раскрыта и есть история на понятном шаге.
function openFold(stageKey, deckKey) {
  if (stageKey && S.stage.closed.delete(stageKey)) S.stage.layout();
  if (deckKey && S.deck.closed.delete(deckKey)) S.deck.layout();
}
async function runTour() {
  try { localStorage.setItem('mq.tour.seen', '1'); } catch { /* без памяти — предложим снова */ }
  $('tour-offer')?.remove();
  if (S.mode !== 'guide') setMode('guide');
  // согласились на тур — сначала дождаться модели и показать историю, иначе первые шаги смотрят на пустые панели
  if (!S.engine) await S.ready;
  if (!S.run) generate({ atStep: 40 });
  const firstGen = () => Math.max(0, S.run.nPrompt - 1);
  const ready = () => { if (!S.run) generate({ atStep: 40 }); else { stop(); if (S.cur < S.run.nPrompt) setCur(Math.min(S.run.nPrompt + 12, S.run.steps.length - 1)); } };
  // шаг, где модель выбрала НЕ фаворита (текст тура говорит «обычно фаворит, но не всегда»)
  const notFavourite = () => {
    const st = S.run.steps;
    for (let k = firstGen() + 4; k < st.length; k++) {
      const x = st[k]; if (x.kind !== 'gen' || x.forced >= 0 || x.output <= 2) continue;
      const top = x.topk.slice().sort((a, b) => b.p - a.p)[0];
      if (top && top.tok !== x.output && top.p < 0.8) return k;
    }
    return S.cur;
  };
  startTour([
    { key: 'tour.what', anchor: '#gen', before: ready },
    { key: 'tour.hover', anchor: ['#logits-simple .ls-title [data-term]', '#story .vp-title [data-term]'] },
    { key: 'tour.story', anchor: '#story', before: () => openFold('story') },
    { key: 'tour.logits', anchor: '#logits', before: () => { openFold('logits'); setCur(notFavourite()); } },
    // температура: подсвечены и ползунок, и история; стоим на первом токене ответа — контекст (промпт) не меняется,
    // и видно, как температура сплющивает и заостряет одно и то же распределение
    { key: 'tour.temp', anchor: ['#side .card', '#story', '#logits'], before: () => { openFold('story'); openFold('logits'); openFold(null, 'sampling'); setCur(firstGen()); } },
    { key: 'tour.attn', anchor: '#view-attn', before: () => S.split?.show(1) },
    { key: 'tour.model', anchor: '#view-model', before: () => S.split?.show(0) },
    { key: 'tour.end', actions: [
      { label: t('tour.act.words'), fn: () => { const w = $('words'); w.focus(); w.select(); } },
      { label: t('tour.act.dice'), fn: () => generate({ newSeed: true }) },
      { label: t('tour.act.lab'), fn: () => setMode('lab') },
    ] },
  ], t);
}
function offerTour() {
  let seen = false; try { seen = !!localStorage.getItem('mq.tour.seen'); } catch { /* нет памяти */ }
  // предлагаем всем, кто тур ещё не видел (адрес после любого прогона сам становится ссылкой — по нему не судим)
  if (seen || S.mode !== 'guide') return;
  const o = document.createElement('div'); o.id = 'tour-offer'; o.className = 'cc-mod tour-offer';
  o.innerHTML = `<span>${t('tour.offer')}</span><button class="to-go">${t('tour.start')}</button><button class="to-no">${t('tour.later')}</button>`;
  o.querySelector('.to-go').onclick = runTour;
  o.querySelector('.to-no').onclick = () => { try { localStorage.setItem('mq.tour.seen', '1'); } catch { /* — */ } o.remove(); };
  document.body.appendChild(o);
}

// глоссарий: у терминов пунктирное подчёркивание, при наведении — стеклянная подсказка в одно предложение
let DOCS = new Set();
fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.glossary) DOCS = new Set(j.glossary); }).catch(() => {});
let hintSeen = false;
try { hintSeen = !!localStorage.getItem('mq.hint.seen'); } catch { /* без памяти — покажем */ }
function hoverHint() {
  if (hintSeen || document.getElementById('hover-hint')) return;
  const h = document.createElement('div'); h.id = 'hover-hint'; h.className = 'cc-mod hover-hint'; h.textContent = t('hint.hover');
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 15000);
}
function glossary() {
  const tip = document.createElement('div'); tip.className = 'gloss-tip'; tip.hidden = true; document.body.appendChild(tip);
  let timer = 0, cur = null;
  let grace = 0;
  const hide = () => { clearTimeout(timer); clearTimeout(grace); tip.hidden = true; cur = null; };
  document.addEventListener('pointerover', (e) => {
    if (tip.contains(e.target)) { clearTimeout(grace); return; }    // мышь перешла в подсказку — держим её открытой
    const el = e.target.closest('[data-term]');
    if (el === cur) { clearTimeout(grace); return; }
    // ушли с термина на пустое место: даём 300 мс, чтобы мышь успела дойти до ссылки в подсказке
    if (!el) { if (!tip.hidden) { clearTimeout(grace); grace = setTimeout(hide, 300); } else hide(); return; }
    hide();
    const key = 'gl.' + el.dataset.term, text = t(key);
    if (text === key) return;                       // термина нет в словаре — без подсказки
    cur = el;
    timer = setTimeout(() => {
      tip.textContent = text;
      const slug = DOC_SLUG[el.dataset.term];
      if (slug && DOCS.has(slug)) {
        const a = document.createElement('a');
        a.className = 'gloss-more'; a.target = '_blank'; a.rel = 'noopener';
        // обычный щелчок — статья во вкладке Docs рядом, с Ctrl/⌘ — как обычная ссылка в новой вкладке браузера
        a.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.preventDefault(); hide(); openDoc(a.href); });
        a.href = `/${lang === 'en' ? '' : lang + '/'}docs/glossary/${slug}/`;
        a.textContent = t('gl.more');
        tip.appendChild(a);
      }
      tip.hidden = false;
      if (!hintSeen) { hintSeen = true; try { localStorage.setItem('mq.hint.seen', '1'); } catch { /* только на этот раз */ } document.getElementById('hover-hint')?.remove(); }
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      const y = r.bottom + 8 + h < innerHeight ? r.bottom + 8 : r.top - h - 8;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }, 250);
  });
  document.addEventListener('pointerdown', (e) => { if (!tip.contains(e.target)) hide(); }); addEventListener('scroll', hide, true);
}
setMode(S.mode, !S.modeFromLink);   // режим из ссылки не перезаписывает сохранённый выбор получателя
// огоньки «Generate»: скорость меняется плавно, без перезапуска анимации (иначе угол прыгает)
function genSpeed() {
  const g = $('gen'), a = g.getAnimations().find((x) => x.animationName === 'gen-orbit');
  if (!a) return;
  const target = g.classList.contains('busy') ? 2.6 : g.matches(':hover') ? 1.7 : 1;
  const from = a.playbackRate, t0 = performance.now();
  cancelAnimationFrame(genSpeed.raf);
  const step = () => {                                  // разгон/торможение за 400 мс
    const k = Math.min(1, (performance.now() - t0) / 400);
    a.updatePlaybackRate(from + (target - from) * k * (2 - k));
    if (k < 1) genSpeed.raf = requestAnimationFrame(step);
  };
  step();
}
$('gen').addEventListener('pointerenter', genSpeed);
$('gen').addEventListener('pointerleave', genSpeed);
$('gen').addEventListener('click', () => generate());
$('reroll').addEventListener('click', () => generate({ newSeed: true }));
$('tour-btn').addEventListener('click', () => runTour());
$('words').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
$('words').addEventListener('input', () => wordsHint(null));
$('prompt').addEventListener('input', () => wordsHint(null));
picksMenu();
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });


// язык: кнопка-глобус, по щелчку — отдельные стеклянные модули со списком языков
function langMenu() {
  const GLOBE = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 10h14.4M10 2.8c2.2 2.4 2.2 12 0 14.4M10 2.8c-2.2 2.4-2.2 12 0 14.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const btn = navBtn('lang', GLOBE, t('lang.title')), pop = document.createElement('div');
  pop.className = 'lang-pop';
  for (const L of LANGS) {
    const b = document.createElement('button'); b.className = 'cc-mod lang-item' + (L.code === lang ? ' on' : '');
    b.innerHTML = `<span>${L.name}</span>${L.code === lang ? CHECK : ''}`;
    b.addEventListener('click', () => { if (L.code !== lang) setLang(L.code); else m.open(false); });
    pop.appendChild(b);
  }
  const m = popover(btn, pop);
}

// модель: «пилюля» в навбаре; меню — текущая модель и её карточка (появятся другие — добавятся строками)
function modelMenu() {
  const pop = document.createElement('div'); pop.className = 'lang-pop model-pop';
  const cur = MODEL();
  $('model-pill').querySelector('.mp-name').textContent = cur.bits === 4 ? `${cur.id} · ${t('model.b4.short')}` : cur.id;
  // версии одной модели: щелчок по другой — страница открывается заново с этой версией (и с тем же экспериментом)
  const items = MODELS.map((v) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-mod lang-item mode-item' + (v === cur ? ' on' : '');
    b.innerHTML = `<span class="mi-t"><b>${t('model.b' + v.bits)}</b><small>${t('model.b' + v.bits + '.d')}</small></span>${CHECK}`;
    b.addEventListener('click', () => {
      m.open(false);
      if (v === cur) return;
      try { localStorage.setItem('mq.bits', String(v.bits)); } catch { /* только по ссылке */ }
      const q = new URLSearchParams(location.search);
      if (q.has('seed')) { q.set('q', v.bits); location.search = q.toString().replace(/%2C/g, ','); }
      else location.reload();
    });
    return b;
  });
  const card = document.createElement('div'); card.className = 'cc-mod info-card';
  const fill = () => {
    const mb = S.modelBytes ? (S.modelBytes / 1e6).toFixed(2) : (cur.bits === 4 ? '0.68' : '1.14');
    card.innerHTML = `<div class="ic-title">${t('model.current')}</div><ul>` +
      [t('model.arch'), t('model.params', { n: cur.params }), t('model.size' + cur.bits, { mb: lang === 'ru' ? mb.replace('.', ',') : mb }),
        t('model.vocab'), t('model.data'), t(cur.bits === 4 ? 'model.esp4' : 'model.esp8')].map((x) => `<li>${x}</li>`).join('') + '</ul>';
  };
  pop.append(...items, card);
  const m = popover($('model-pill'), pop, { align: 'left', onOpen: fill });
}

// режим Instruct / Completion: вместо системного списка — стеклянное меню, как у модели. Значение по-прежнему
// хранит <select id="mode"> (его читают генерация и ссылки), меню только выбирает и шлёт change
function modeMenu() {
  const sel = $('mode'), pop = document.createElement('div'); pop.className = 'lang-pop mode-pop';
  const items = [...sel.options].map((o) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-mod lang-item mode-item'; b.dataset.v = o.value;
    b.innerHTML = `<span class="mi-t"><b>${t('mode.' + o.value)}</b><small>${t('mode.' + o.value + '.d')}</small></span>${CHECK}`;
    b.addEventListener('click', () => { m.open(false); if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change')); } sel.focus(); });
    pop.append(b); return b;
  });
  const fill = () => items.forEach((b) => b.classList.toggle('on', b.dataset.v === sel.value));
  const m = popover(sel, pop, { align: 'left', onOpen: fill });
  sel.addEventListener('mousedown', (e) => e.preventDefault());   // системный список не открываем
  sel.addEventListener('keydown', (e) => {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); if (!m.isOpen) { m.open(true); (pop.querySelector('.on') || items[0]).focus(); } }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault(); const k = items.indexOf(document.activeElement);
    items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
}

// «О проекте»: что это, что внутри, ссылки, автор
function aboutMenu() {
  const INFO = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="6.3" r="1" fill="currentColor"/></svg>';
  const btn = navBtn('about', INFO, t('about.title')), pop = document.createElement('div');
  pop.className = 'lang-pop about-pop';
  // ссылки: только рабочие адреса — пунктов «скоро» нет (новый адрес — одна строка здесь)
  const LINKS = [
    { name: 'Docs', url: `/${lang === 'en' ? '' : lang + '/'}docs/` },
    { name: 'GitHub', url: 'https://github.com/olanokhin/tensorlupa' }, { name: 'Hugging Face', url: 'https://huggingface.co/olanokhin' },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/in/olanokhin/' }, { name: t('about.site'), url: 'https://olanokhin.com' },
  ];
  const links = LINKS.map((l) => l.url
    ? `<a class="ab-link" href="${l.url}" target="_blank" rel="noopener">${l.name}</a>`
    : `<span class="ab-link soon">${l.name}<small>${t('about.soon')}</small></span>`).join('');
  pop.innerHTML = `<div class="cc-mod info-card ab-head"><div class="ab-name">TensorLupa</div><div class="ab-tag">${t('about.tagline')}</div><p>${t('about.lead')}</p></div>` +
    `<div class="cc-mod info-card"><p>${t('about.model')}</p></div>` +
    `<div class="cc-mod info-card"><div class="ic-title">${t('about.links')}</div><div class="ab-links">${links}</div></div>` +
    `<div class="cc-mod info-card ab-foot"><span>${t('about.by')}</span><span>${t('about.free')}</span></div>`;
  const tb = document.createElement('button'); tb.className = 'cc-mod lang-item about-tour'; tb.textContent = t('tour.start');
  pop.appendChild(tb);
  const m = popover(btn, pop);
  tb.addEventListener('click', () => { m.open(false); runTour(); });
}

boot();

// «Поделиться»: ссылка на этот момент эксперимента (слова, seed, настройки, шаг). Главное — «Копировать ссылку»;
// ниже «Отправить через» X / LinkedIn / Telegram. Системное окно отправки вернём вместе с мобильной студией. Сторонние сайты открываются
// только по щелчку человека, сами по себе ничего никуда не отправляем.
function shareMenu() {
  const btn = $('share-btn'), pop = document.createElement('div');
  pop.className = 'lang-pop share-pop';
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const fill = () => {
    writeLink();
    const url = location.href, gen = S.run ? S.cur - Math.max(0, S.run.nPrompt - 1) + 1 : 0;
    const what = !S.run ? t('share.empty') : gen > 0 ? t('share.desc', { n: gen }) : t('share.descStart');
    const text = t('share.text'), u = encodeURIComponent(url), tx = encodeURIComponent(text);
    pop.innerHTML = `<div class="cc-mod info-card"><div class="ic-title">${t('share.title')}</div><p>${what}</p>` +
      `<div class="sh-row"><input class="sh-url" readonly value="${esc(url)}" aria-label="link"><button class="sh-copy">${t('share.copy')}</button></div>` +
      `<div class="sh-via">${t('share.via')}</div>` +
      `<div class="sh-apps"><a target="_blank" rel="noopener" href="https://x.com/intent/post?text=${tx}&url=${u}">X</a>` +
      `<a target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}">LinkedIn</a>` +
      `<a target="_blank" rel="noopener" href="https://t.me/share/url?url=${u}&text=${tx}">Telegram</a></div></div>`;
    const input = pop.querySelector('.sh-url'), copy = pop.querySelector('.sh-copy');
    input.addEventListener('focus', () => input.select());
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); } catch { input.select(); }   // без буфера — выделяем, Cmd+C
      copy.textContent = t('share.copied'); copy.classList.add('done');
      setTimeout(() => { copy.textContent = t('share.copy'); copy.classList.remove('done'); }, 1600);
    });
  };
  popover(btn, pop, { onOpen: fill });
}
