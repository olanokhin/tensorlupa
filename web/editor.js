// Редактор micro-qwen3: генерирует историю тем же движком, что на ESP32-S3 (WebAssembly), записывает трассу каждого
// шага и даёт откатиться на любой токен. Версия 1: полоса логитов, история, таймлайн, настройки, инспектор.
import { Deck } from './cards.js';
import { Stage } from './stage.js';
import { navPad } from './navpad.js';
import { popover } from './popover.js';
import { startTour } from './tour.js';
import { Controls } from './controls.js';
import { t, lang, LANGS, setLang } from './i18n.js';
import { loadEngine, Engine } from './engine/engine.js';
import { LogitStrip, show } from './logits.js';
import { AttentionView } from './attention.js';
import { ModelView } from './modelview.js';
import { GrowthChart } from './growth.js';

const $ = (id) => document.getElementById(id);
const P = {
  // seed по умолчанию — лучшая демо-история для слов по умолчанию (dragon, cookie, school): подобран перебором 3000 seed
  // (все слова на месте, закончилась сама, без повторов 4-грамм) и прочитан глазами; кубик даёт случайные
  temperature: 0.6, topK: 40, seed: 2779,
  wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, loopPenalty: false,
  maxNew: 200, speed: 24, autoplay: true,
};
const S = { engine: null, run: null, cur: 0, timer: null, items: [] };
let engineReady; S.ready = new Promise((r) => { engineReady = r; });   // модель загружена и интерфейс привязан

// ссылка на эксперимент: слова (или текст), seed, шаг и настройки, отличные от умолчаний, — в адресе страницы.
// Прогон детерминирован, поэтому по ссылке у получателя ровно та же история и тот же шаг.
const DEF = { temperature: 0.6, topK: 40, wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, loopPenalty: false, maxNew: 200 };
const QK = { temperature: 't', topK: 'k', wbBase: 'wb', wbTau: 'tau', wbStart: 'cs', fsm: 'fsm', loopPenalty: 'rp', maxNew: 'n' };
function readLink() {
  const q = new URLSearchParams(location.search);
  if (!q.has('seed')) return null;
  for (const [key, short] of Object.entries(QK)) {
    if (!q.has(short)) continue;
    const v = q.get(short);
    P[key] = typeof DEF[key] === 'boolean' ? v === '1' : Number(v);
  }
  P.seed = Math.max(1, Math.min(99999, Number(q.get('seed')) || 1));
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
  if (S.mode === 'lab') q.set('mode', 'lab');
  history.replaceState(null, '', location.pathname + '?' + q.toString().replace(/%2C/g, ','));   // путь явно: на странице есть <base href="/">
}
try { S.mode = localStorage.getItem('mq.mode') || 'guide'; } catch { S.mode = 'guide'; }
const LINK = readLink();

// Гайд · Лаб: Гайд — главное простыми словами (простые логиты, одна карточка «что произошло», только сэмплинг,
// 3D и веса attention), Лаб — весь редактор. Названия про вид, а не про человека.
function setMode(m, persist = true) {
  S.mode = m;
  document.body.dataset.mode = m;
  setPair('mode-pair', m);
  if (persist) try { localStorage.setItem('mq.mode', m); } catch { /* без памяти — только на эту загрузку */ }
  if (S.deck) { S.deck.show('order', m === 'lab'); }
  if (m === 'guide' && S.engine) {
    if (S.view !== '3d') switchView('3d');
    if (S.aview !== '3d') switchAttn('3d');
    if (S.amode !== 'look') { S.amode = 'look'; S.attn.mode = 'look'; if (S.a3d) { S.a3d.mode = 'look'; S.a3d.ridges(); } setPair('amode-pair', 'look'); }
  }
  if (S.stage) S.stage.layout();
  if (S.run) { setCur(S.cur); writeLink(); }
  requestAnimationFrame(() => { if (S.a3d) S.a3d.resize(); if (S.strip) S.strip.draw(); });
}
// модели студии: пока одна; новые добавляются сюда и появляются в меню модели
const MODELS = [{ id: 'micro-qwen3', file: 'model.bin', params: 1056656 }];
const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M5 3.1v9.8a.7.7 0 0 0 1.06.6l7.7-4.9a.7.7 0 0 0 0-1.2l-7.7-4.9A.7.7 0 0 0 5 3.1z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="2.8" height="10" rx="0.9"/><rect x="9.2" y="3" width="2.8" height="10" rx="0.9"/></svg>';
window.__viz = S;   // для отладки из консоли

// ---------------------------------------------------------------- загрузка
async function boot() {
  try {
    const buf = new Uint8Array(await (await fetch(MODELS[0].file)).arrayBuffer());
    S.modelBytes = buf.length;
    S.engine = await loadEngine(buf);
  } catch (e) {
    $('status').textContent = t('status.fail', { msg: e.message });
    return;
  }
  const i = S.engine.info;
  $('status').textContent = t('status.model', { layers: i.layers, dim: i.dim, heads: i.heads, vocab: i.vocab });
  S.strip = new LogitStrip($('logits-canvas'), $('tip'), S.engine.tokenText);
  S.amode = 'look';
  S.attn = new AttentionView($('attn-canvas'), (sel) => { if (S.a3d) S.a3d.setSel(sel); tintStory(); renderInspector(S.run.steps[S.cur]); });
  S.attn.engine = S.engine; S.attn.mode = S.amode;
  if (S.a3d) { S.a3d.weightsFn = (sel) => S.attn.weights(S.amode, sel); S.a3d.mode = S.amode; }
  S.aview = '3d';
  let View3D = null, AttnStack3D = null;
  try { ({ View3D } = await import('./view3d.js')); ({ AttnStack3D } = await import('./attn3d.js')); }   // Three.js с CDN
  catch (e) { console.error(e); }
  try { S.a3d = new AttnStack3D($('attn-3d'), S.engine.info, (sel) => { S.attn.sel = { ...sel }; tintStory(); renderInspector(S.run.steps[S.cur]); }, S.engine.tokenText); }
  catch (e) { S.a3d = null; console.error(e); }
  S.growth = new GrowthChart($('growth-canvas'), S.engine.info);
  S.model = new ModelView($('model-canvas'), S.engine);
  S.view = '3d';
  try { S.v3d = new View3D($('model-3d'), S.engine); S.v3d.onSelect = () => renderInspector(S.run.steps[S.cur]); }
  catch (e) { S.v3d = null; switchView('schema'); console.error(e); }
  // управление 3D-видами: выпадающая стеклянная панель в углу (камера, раздвинуть, линии, сброс)
  S.spreadK = 1; S.explodeK = 0.25;
  if (S.v3d) navPad($('model-3d'), {
    view: () => S.v3d,
    spread: { get: () => (S.spreadK - 0.6) / 1.4, set: (f) => { S.spreadK = 0.6 + 1.4 * f; S.v3d.setSpread(S.spreadK); } },
    toggles: [{ label: t('nav.traces'), icon: 'lines', get: () => S.v3d.wiresOn !== false, set: (on) => S.v3d.showWires(on) }],
    reset: () => { S.spreadK = 1; S.v3d.setSpread(1); S.v3d.preset('perspective', true); },
  });
  if (S.a3d) navPad($('attn-3d'), {
    view: () => S.a3d, layersLabel: t('nav.maps'),
    spread: { get: () => S.explodeK, set: (f) => { S.explodeK = f; S.a3d.setExplode(f); } },
    reset: () => { S.explodeK = 0.25; S.a3d.userMoved = false; S.a3d.setExplode(0.25); },
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
    .slider('temperature', L('temperature'), 0.05, 1.5, 0.05).slider('topK', L('topK'), 1, 64, 1)
    .slider('seed', L('seed'), 1, 99999, 1).slider('maxNew', L('maxNew'), 20, 220, 10).toggle('loopPenalty', L('loopPenalty'));
  const fo = new Controls(S.deck.add('order', t('card.order')), P, live)
    .slider('wbBase', L('wbBase'), 0, 6, 0.25).slider('wbTau', L('wbTau'), 10, 400, 10)
    .slider('wbStart', L('wbStart'), 0, 1, 0.25).toggle('fsm', L('fsm'));
  const fp = new Controls(S.deck.add('run', t('card.run')), P, live)
    .slider('speed', L('speed'), 1, 120, 1)
    .toggle('autoplay', L('autoplay'));
  document.querySelectorAll('#side .card-t').forEach((el) => { if (el.textContent === t('card.sampling')) el.dataset.term = 'sampling'; });
  const panes = [fs, fo, fp];
  S.pane = { refresh: () => panes.forEach((x) => x.refresh()) };
}

// ---------------------------------------------------------------- генерация
// живые настройки: любое изменение, влияющее на текст, пересчитывает историю с тем же seed (~90 мс), без анимации,
// на том же шаге — видно, что меняет именно эта настройка. Не чаще раза за кадр.
const LIVE = new Set(['temperature', 'topK', 'seed', 'wbBase', 'wbTau', 'wbStart', 'fsm', 'loopPenalty', 'maxNew']);
function live(key) {
  if (!LIVE.has(key) || !S.run) return;
  if (live.raf) return;
  live.raf = requestAnimationFrame(() => { live.raf = 0; generate({ live: true }); });
}

// Ключевые слова: движок понимает до трёх английских слов (a–z, дефис, апостроф, до 23 букв), разделители — пробел
// или запятая. Лишние и неанглийские слова не уходят ни в движок, ни в промпт (иначе модель просят то, что не подталкивают),
// а под полем появляется тихая подсказка.
const WORD_RE = /^[a-z][a-z'-]{0,22}$/i;
function parseWords(raw) {
  const all = raw.split(/[ ,]+/).filter(Boolean);
  const ok = all.filter((w) => WORD_RE.test(w)).map((w) => w.toLowerCase());
  return { words: ok.slice(0, 3), foreign: ok.length < all.length, extra: ok.length > 3 };
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

// Проверенные заказы: слова + seed, отобранные перебором 600 seed на комбинацию и чтением историй
// (все слова на месте, история закончилась сама, мало повторов). Клик — вписать и сгенерировать.
const PICKS = [
  ['dragon, cookie, school', 2779], ['share, toy, kind', 147], ['find, treasure, brave', 319],
  ['run, dog, fast', 231], ['fly, kite, red', 326], ['play, ball, happy', 273], ['robot, moon', 552],
];
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

// Счётчик прогонов на главной: после каждой готовой истории — анонимный «+1» на наш же сервер (tensorlupa.com/api/run).
// Отправляется только случайный номер браузера (localStorage), без текста и слов. Пересчёты от ползунков не считаются —
// иначе одно движение дало бы сотню «прогонов». На локальном сервере разработки не отправляется.
function countRun() {
  if (/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname)) return;
  let id = null;
  try { id = localStorage.getItem('mq.uid'); if (!id) { id = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem('mq.uid', id); } }
  catch { id = (countRun.tmp ||= crypto.randomUUID().replace(/-/g, '')); }   // без хранилища — номер только на эту загрузку
  fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {});
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
  S.engine.settings({ temperature: P.temperature, topK: P.topK, seed: P.seed, wbBase: P.wbBase, wbTau: P.wbTau,
    wbStart: P.wbStart, fsm: P.fsm, loopImm: P.loopPenalty ? 3 : 0, loopMult: P.loopPenalty ? 1 : 0, maxNew: P.maxNew });
  const t0 = performance.now();
  S.run = S.engine.run(prompt, words);
  const ms = performance.now() - t0;
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
  if (!isLive) countRun();
  const firstGen = Math.max(0, S.run.nPrompt - 1);
  $('t-range').max = S.run.steps.length - 1;
  if (atStep >= 0) setCur(Math.min(atStep, S.run.steps.length - 1));
  else if (isLive) setCur(Math.min(Math.max(keepStep, firstGen), S.run.steps.length - 1));
  else if (P.autoplay) { setCur(firstGen); play(); } else setCur(S.run.steps.length - 1);
}

// ---------------------------------------------------------------- история: токены, по которым можно ходить
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
  if (S.aview === '2d') S.attn.set(S.run.steps, S.cur, S.engine.info);
  else { S.attn.steps = S.run.steps; S.attn.cur = S.cur; S.attn.info = S.engine.info; if (S.a3d) S.a3d.set(S.run.steps, S.cur); }
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
    `<span class="ls-p">${c.p < 0.01 ? '<1' : (100 * c.p).toFixed(0)}%</span></div>`).join('');
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
  const pushes = s.bias.filter((x) => x.val < 1e8);
  if (pushes.length) h += `<div class="note">${t('g.boost', { list: pushes.map((x) => pill(x.tok) + ' +' + x.val.toFixed(1)).join(' ') })}</div>`;
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
  let h = (S.v3d && S.view === '3d' ? S.v3d.describe() : '') + (S.a3d ? S.a3d.describe() : '');
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
function switchAttn(v) {
  S.aview = v;
  setPair('aview-pair', v);
  $('attn-3d').hidden = v !== '3d'; $('attn-canvas').hidden = v !== '2d';
  if (S.run) setCur(S.cur);
  if (v === '3d' && S.a3d) { S.a3d.resize(); S.a3d.setSel(S.attn.sel); }
}

function switchView(v) {
  S.view = v;
  setPair('view-pair', v);
  $('model-3d').hidden = v !== '3d'; $('model-canvas').hidden = v !== 'schema';
  $('model-sub').hidden = v === '3d';
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
  folds: [{ key: 'logits', el: $('logits'), share: 0.2, min: 118, max: 230 },
          { key: 'story', el: $('story'), share: 0.3, min: 160, max: 380 }],
  onLayout: () => glassRanges.forEach(placeKnob),
});
addEventListener('scroll', () => glassRanges.forEach(placeKnob), true);
new MutationObserver(() => glassRanges.forEach(placeKnob)).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });

function bindUI() {
  // стеклянные ручки — у ползунков интерфейса; у ползунков панели камеры свой вид (как в Пункте управления)
  document.querySelectorAll('input[type=range]').forEach((el) => { if (el.closest('.cc, .cc-track')) return; glassRange(el); el.addEventListener('input', () => fillRange(el)); });
  bindPair('amode-pair', (v) => {
    S.amode = v; S.attn.mode = v; if (S.a3d) { S.a3d.mode = v; S.a3d.ridges(); }
    setPair('amode-pair', v); tintStory(); if (S.run) renderInspector(S.run.steps[S.cur]);
  });
  bindPair('aview-pair', switchAttn);
  bindPair('view-pair', switchView);
  $('mode').addEventListener('change', () => {
    const order = $('mode').value === 'order';
    $('words').hidden = !order; $('prompt').hidden = order;
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
    { key: 'tour.story', anchor: '#story', before: () => openFold('story') },
    { key: 'tour.logits', anchor: '#logits', before: () => { openFold('logits'); setCur(notFavourite()); } },
    // температура: подсвечены и ползунок, и история; стоим на первом токене ответа — контекст (промпт) не меняется,
    // и видно, как температура сплющивает и заостряет одно и то же распределение
    { key: 'tour.temp', anchor: ['#side .card', '#story', '#logits'], before: () => { openFold('story'); openFold('logits'); openFold(null, 'sampling'); setCur(firstGen()); } },
    { key: 'tour.attn', anchor: '#view-attn' },
    { key: 'tour.model', anchor: '#view-model' },
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
// термин подсказки → страница Docs (/docs/glossary/<slug>/). Какие страницы уже написаны, студия узнаёт из
// /docs/pages.json (его пишет сборка Docs); у остальных терминов — только подсказка, без ссылки.
const DOC_SLUG = {
  languageModel: 'language-model', token: 'token', prompt: 'prompt', specialTokens: 'special-tokens', mode: 'instruct', model: 'transformer',
  embedding: 'residual-stream', residualStream: 'residual-stream', attention: 'attention', head: 'attention-head',
  weights: 'attention-head', valueWeighted: 'attention-head', mlp: 'mlp', logits: 'logits', logitLens: 'logit-lens',
  sampling: 'sampling', sampleDraw: 'sampling', pOut: 'sampling', temperature: 'temperature', topK: 'top-k', seed: 'seed',
  maxNew: 'max-new-tokens', loopPenalty: 'repetition-penalty', wbBase: 'logit-bias', wbTau: 'logit-bias',
  wbStart: 'logit-bias', logitBias: 'logit-bias', keywords: 'logit-bias', fsm: 'fsm', entropy: 'entropy',
};
let DOCS = new Set();
fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.glossary) DOCS = new Set(j.glossary); }).catch(() => {});
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
        a.href = `/${lang === 'en' ? '' : lang + '/'}docs/glossary/${slug}/`;
        a.textContent = t('gl.more');
        tip.appendChild(a);
      }
      tip.hidden = false;
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
  const cur = MODELS[0];
  const item = document.createElement('button'); item.className = 'cc-mod lang-item on';
  item.innerHTML = `<span>${cur.id}</span>${CHECK}`;
  const card = document.createElement('div'); card.className = 'cc-mod info-card';
  const fill = () => {
    const mb = S.modelBytes ? (S.modelBytes / 1e6).toFixed(2) : '0.68';
    card.innerHTML = `<div class="ic-title">${t('model.current')}</div><ul>` +
      [t('model.arch'), t('model.params', { n: cur.params }), t('model.size', { mb: lang === 'ru' ? mb.replace('.', ',') : mb }),
        t('model.vocab'), t('model.data'), t('model.esp')].map((x) => `<li>${x}</li>`).join('') + '</ul>';
  };
  pop.append(item, card);
  const m = popover($('model-pill'), pop, { align: 'left', onOpen: fill });
  item.addEventListener('click', () => m.open(false));
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
