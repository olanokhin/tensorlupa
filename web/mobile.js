// TensorLupa — Copyright 2026 Alex Anokhin — Apache License 2.0 (LICENSE, NOTICE)
// Студия на телефоне: та же модель, те же ссылки на эксперимент и те же числа, что на большом экране (editor.js),
// но одна колонка под палец. Сверху вниз: навбар, история, четыре вкладки (Model, Logits, Attention, Docs),
// закреплённый плеер. Настройки — шторка, которая вытягивается из плеера за «крючок»; её карточки листаются вбок.
// 3D и three.js здесь не загружаются вовсе.
import { t, lang, LANGS, setLang } from './i18n.js';
import { loadEngine, Engine, Corpus } from './engine/engine.js';
import { show } from './logits.js';
import { Controls } from './controls.js';
import { MModel } from './mmodel.js';
import { MAttn } from './mattn.js';
import { DocPane } from './docs.js';
import { DEF, QK, linkDefaults, DEMO_SEED, COMPLETION_SEED, MODELS, parseWords, PICKS_ALL, countRun, DOC_SLUG } from './core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const P = { temperature: 0.6, topK: 40, minP: 0.02, seed: 1111, wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, loopPenalty: true,
  maxNew: 200, speed: 24, autoplay: true };
const S = { engine: null, run: null, cur: 0, timer: null, items: [], tab: 'model', track: null, head: null, pos: -1, mode: 'order', words: 'dragon, cookie, school',
  prompt: 'Once upon a time', more: false, sheet: false };
window.__viz = S;
try { S.bits = localStorage.getItem('mq.bits') === '4' ? 4 : 8; } catch { S.bits = 8; }

const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.1v9.8a.7.7 0 0 0 1.06.6l7.7-4.9a.7.7 0 0 0 0-1.2l-7.7-4.9A.7.7 0 0 0 5 3.1z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="2.8" height="10" rx="0.9"/><rect x="9.2" y="3" width="2.8" height="10" rx="0.9"/></svg>',
  prev: '<svg viewBox="0 0 16 16"><path d="M11.5 3.6v8.8a.6.6 0 0 1-.92.5L4.1 8.5a.6.6 0 0 1 0-1l6.48-4.4a.6.6 0 0 1 .92.5z"/></svg>',
  next: '<svg viewBox="0 0 16 16"><path d="M4.5 3.6v8.8a.6.6 0 0 0 .92.5L11.9 8.5a.6.6 0 0 0 0-1L5.42 3.1a.6.6 0 0 0-.92.5z"/></svg>',
  dice: '<svg viewBox="0 0 20 20"><rect x="3.2" y="3.2" width="13.6" height="13.6" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="1.25" fill="currentColor"/><circle cx="13" cy="7" r="1.25" fill="currentColor"/><circle cx="10" cy="10" r="1.25" fill="currentColor"/><circle cx="7" cy="13" r="1.25" fill="currentColor"/><circle cx="13" cy="13" r="1.25" fill="currentColor"/></svg>',
};

// ---------------------------------------------------------------- ссылка на эксперимент (тот же формат, что в editor.js)
function readLink() {
  const q = new URLSearchParams(location.search);
  if (q.has('q') && !q.has('seed')) S.bits = q.get('q') === '4' ? 4 : 8;
  if (!q.has('seed')) return null;
  const D = linkDefaults(q);
  for (const [key, short] of Object.entries(QK)) {
    if (!q.has(short)) { P[key] = D[key]; continue; }
    P[key] = typeof DEF[key] === 'boolean' ? q.get(short) === '1' : Number(q.get(short));
  }
  P.seed = Math.max(1, Math.min(99999, Number(q.get('seed')) || 1));
  S.bits = q.get('q') === '8' ? 8 : 4;      // ссылка без q — со времён одной 4-битной версии
  S.lab = q.get('mode') === 'lab';          // режим большого экрана: телефон его не использует, но в ссылке сохраняет
  if (q.has('p')) { S.mode = 'continue'; S.prompt = q.get('p'); } else if (q.has('w')) S.words = q.get('w').split(',').join(', ');
  return { step: q.has('s') ? Number(q.get('s')) : -1 };
}
function writeLink() {
  if (!S.run) return;
  const q = new URLSearchParams();
  if (S.mode === 'continue') q.set('p', S.prompt); else q.set('w', S.words.split(/[ ,]+/).filter(Boolean).join(','));
  q.set('seed', P.seed);
  for (const [key, short] of Object.entries(QK)) if (P[key] !== DEF[key]) q.set(short, typeof DEF[key] === 'boolean' ? (P[key] ? 1 : 0) : P[key]);
  q.set('s', S.cur); q.set('q', S.bits);
  if (S.lab) q.set('mode', 'lab');
  history.replaceState(null, '', location.pathname + '?' + q.toString().replace(/%2C/g, ','));
}
const LINK = readLink();
if (!LINK) P.seed = DEMO_SEED[S.bits];

// ---------------------------------------------------------------- каркас
const TABS = [['model', t('model.title'), 'model'], ['logits', t('logits.title'), 'logits'], ['attn', t('attn.title'), 'attention'], ['docs', t('docs.tab'), null]];
function build() {
  document.getElementById('app')?.remove();
  const m = document.createElement('div'); m.id = 'm';
  m.innerHTML = `
  <header class="m-top">
    <a class="brand" href="${lang === 'en' ? '/' : '/' + lang + '/'}"><img class="brand-mark" src="media/logo.svg" alt="" width="20" height="20"><span class="brand-name">TensorLupa</span></a>
    <span class="m-status" id="m-status">${t('status.loading')}</span>
    <button id="m-gen" class="primary"><span class="gen-core" aria-hidden="true"></span><span class="gen-star" aria-hidden="true"></span><span data-i18n="gen">${t('gen')}</span></button>
    <button id="m-share" class="m-icon" title="${t('share.title')}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5V3.5M6.6 6.6 10 3.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 9.5H5.3A1.3 1.3 0 0 0 4 10.8v4.9A1.3 1.3 0 0 0 5.3 17h9.4a1.3 1.3 0 0 0 1.3-1.3v-4.9a1.3 1.3 0 0 0-1.3-1.3h-1.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    <button id="m-lang" class="m-icon" title="${t('lang.title')}">${lang.toUpperCase()}</button>
  </header>
  <section class="m-story">
    <div id="m-story-text" class="story-text"><span class="m-empty">${t('mob.empty')}</span></div>
    <div id="m-story-sub" class="m-sub"></div>
  </section>
  <nav class="m-tabs" role="tablist">${TABS.map(([k, name]) => `<button role="tab" data-tab="${k}">${esc(name)}</button>`).join('')}</nav>
  <main class="m-view">
    <div class="m-pane" data-pane="model"></div>
    <div class="m-pane" data-pane="logits"><div id="m-logits" class="logits-simple"></div></div>
    <div class="m-pane" data-pane="attn"></div>
    <div class="m-pane m-docs" data-pane="docs">
      <div class="doc-bar">
        <button class="doc-back" type="button" disabled title="${t('docs.back')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <nav class="doc-crumbs" aria-label="Docs"><span class="doc-h">Docs</span></nav>
        <a class="doc-site" href="docs/" target="_blank" rel="noopener" title="${t('docs.site')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11.5 9.5v3a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      </div>
      <div class="doc-scroll"><article class="doc"></article></div>
    </div>
  </main>
  <footer class="m-dock" id="m-dock">
    <button class="m-grab" id="m-grab" aria-expanded="false" aria-controls="m-sheet" title="${t('mob.settings')}"><i></i></button>
    <div class="m-sheet" id="m-sheet" inert>
      <nav class="m-slidenav" id="m-slidenav"></nav>
      <div class="m-slides" id="m-slides"></div>
    </div>
    <div class="m-play">
      <button id="m-prev" title="${t('t.prev')}">${ICON.prev}</button>
      <button id="m-play" title="${t('t.play')}">${ICON.play}</button>
      <button id="m-next" title="${t('t.next')}">${ICON.next}</button>
      <div id="m-seek" class="m-seek" role="slider" tabindex="0" aria-label="${t('mob.step')}" aria-valuemin="1" aria-valuemax="1" aria-valuenow="1"><i></i><b></b></div>
      <span id="m-label" class="mono m-label"></span>
    </div>
  </footer>`;
  document.body.appendChild(m);
  document.body.dataset.mode = 'guide';
}

// ---------------------------------------------------------------- шторка настроек
// Карточки те же по смыслу, что на большом экране: Sampling и Constraints меняют сам вывод модели, Replay только показ.
// Первая карточка — что просим у модели: режим, слова или начало, seed.
function buildSheet() {
  const slides = $('m-slides'), nav = $('m-slidenav'), L = (k) => t('set.' + k), panes = [];
  const add = (key, title) => {
    const el = document.createElement('section'); el.className = 'm-slide'; el.dataset.slide = key; slides.appendChild(el);
    const b = document.createElement('button'); b.textContent = title; b.dataset.slide = key; nav.appendChild(b);
    b.addEventListener('click', () => el.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }));
    return el;
  };
  const sp = add('prompt', t('mob.slide.prompt'));
  sp.innerHTML = `<div class="m-field">
      <span class="pair m-mode" id="m-mode"><button class="pair-o" data-v="order">${t('mode.order')}</button><button class="pair-o" data-v="continue">${t('mode.continue')}</button></span>
      <input id="m-words" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="go">
    </div><div id="m-hint" class="m-hint" hidden></div><div class="m-picks" id="m-picks"></div>`;
  // seed на телефоне — число и кубик: ползунок на 99 999 значений пальцем бесполезен
  const seed = document.createElement('div'); seed.className = 'm-seed';
  seed.innerHTML = `<span class="ctl-l" data-term="seed">${L('seed')}</span><input id="m-seed" class="ctl-v" inputmode="numeric" spellcheck="false">` +
    `<button id="m-dice" class="m-icon" title="${t('gen.another')}">${ICON.dice}</button>`;
  sp.appendChild(seed);
  const seedIn = seed.querySelector('input'), syncSeed = () => { seedIn.value = P.seed; };
  seedIn.addEventListener('change', () => { const v = Math.round(Number(seedIn.value)); P.seed = Number.isFinite(v) ? Math.max(1, Math.min(99999, v)) : P.seed; syncSeed(); live('seed'); });
  seedIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') seedIn.blur(); });
  seedIn.addEventListener('focus', () => seedIn.select());
  seed.querySelector('#m-dice').addEventListener('click', () => generate({ newSeed: true, keepSheet: true }));
  panes.push({ refresh: syncSeed }); syncSeed();
  panes.push(new Controls(sp, P, live).slider('maxNew', L('maxNew'), 20, 220, 10));
  panes.push(new Controls(add('sampling', t('card.sampling')), P, live)
    .slider('temperature', L('temperature'), 0.05, 1.5, 0.05).slider('topK', L('topK'), 1, 64, 1).slider('minP', L('minP'), 0, 0.2, 0.01)
    .toggle('loopPenalty', L('loopPenalty')));
  panes.push(new Controls(add('order', t('card.order')), P, live)
    .slider('wbBase', L('wbBase'), 0, 6, 0.25).slider('wbTau', L('wbTau'), 10, 400, 10).slider('wbStart', L('wbStart'), 0, 1, 0.25).toggle('fsm', L('fsm')));
  const sr = add('run', t('card.run'));
  panes.push(new Controls(sr, P, live).slider('speed', L('speed'), 1, 120, 1).toggle('autoplay', L('autoplay')));
  const bits = document.createElement('div'); bits.className = 'm-bits';
  bits.innerHTML = `<span class="ctl-l">${t('mob.weights')}</span><span class="pair" id="m-bits">` +
    MODELS.map((x) => `<button class="pair-o${x.bits === S.bits ? ' on' : ''}" data-v="${x.bits}">${t('mob.bits', { n: x.bits })}</button>`).join('') + '</span>';
  sr.appendChild(bits);
  bits.addEventListener('click', (e) => { const b = e.target.closest('.pair-o'); if (!b || Number(b.dataset.v) === S.bits) return;
    try { localStorage.setItem('mq.bits', b.dataset.v); } catch { /* без памяти */ }
    const q = new URLSearchParams(location.search); q.set('q', b.dataset.v); if (!LINK && !S.run) q.delete('seed');
    location.assign(location.pathname + '?' + q.toString().replace(/%2C/g, ',')); });   // другие веса — другая загрузка страницы, как на большом экране
  S.pane = { refresh: () => panes.forEach((x) => x.refresh()) };
  // какая карточка на экране — та подпись подсвечена
  const mark = () => { const i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)); [...nav.children].forEach((b, k) => b.classList.toggle('on', k === i)); };
  slides.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true }); mark();

  // режим и поле: слова заказа или начало истории
  const field = $('m-words');
  const syncMode = () => { document.querySelectorAll('#m-mode .pair-o').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
    field.value = S.mode === 'order' ? S.words : S.prompt; field.placeholder = t(S.mode === 'order' ? 'words.ph' : 'prompt.ph'); $('m-picks').hidden = S.mode !== 'order'; };
  $('m-mode').addEventListener('click', (e) => { const b = e.target.closest('.pair-o'); if (!b || b.dataset.v === S.mode) return;
    S.mode = b.dataset.v; P.seed = (S.mode === 'order' ? DEMO_SEED : COMPLETION_SEED)[S.bits]; S.pane.refresh(); syncMode(); hint(null); });
  field.addEventListener('input', () => { if (S.mode === 'order') S.words = field.value; else S.prompt = field.value; });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { field.blur(); generate(); } });
  // проверенные заказы: слова и seed, подобранные и прочитанные глазами (core.js)
  $('m-picks').innerHTML = PICKS_ALL.map(([ws], i) => `<button class="m-pick" data-i="${i}">${esc(ws)}</button>`).join('');
  $('m-picks').addEventListener('click', (e) => { const b = e.target.closest('.m-pick'); if (!b) return;
    const [ws, s4, s8] = PICKS_ALL[Number(b.dataset.i)]; S.words = ws; P.seed = S.bits === 4 ? s4 : s8; S.pane.refresh(); syncMode(); generate(); });
  S.syncMode = syncMode; syncMode();
}
function hint(key) { const h = $('m-hint'); h.hidden = !key; if (key) h.textContent = t(key); }

function setSheet(on) {
  S.sheet = on; $('m-dock').classList.toggle('open', on); $('m-grab').setAttribute('aria-expanded', on);
  $('m-sheet').inert = !on;
}
// «крючок»: нажатие открывает и закрывает, а потянуть вверх или вниз — то же самое жестом
function bindGrab() {
  const g = $('m-grab'); let y0 = null, moved = false;
  g.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = false; try { g.setPointerCapture(e.pointerId); } catch { /* синтетическое событие без активного указателя */ } });
  g.addEventListener('pointermove', (e) => { if (y0 == null) return; const dy = e.clientY - y0;
    if (Math.abs(dy) > 18) { moved = true; setSheet(dy < 0); y0 = e.clientY; } });
  g.addEventListener('pointerup', () => { if (y0 != null && !moved) setSheet(!S.sheet); y0 = null; });
  g.addEventListener('pointercancel', () => { y0 = null; });
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(!S.sheet); } });
}

// ---------------------------------------------------------------- генерация
const LIVE = new Set(['temperature', 'topK', 'minP', 'seed', 'wbBase', 'wbTau', 'wbStart', 'fsm', 'loopPenalty', 'maxNew']);
// живые настройки: история пересчитывается с тем же seed на том же шаге. На быстром устройстве — на каждый кадр
// движения ползунка; на медленном (S.slow) — когда ползунок отпустили, иначе каждое движение стоило бы секунды.
function live(key) {
  if (!LIVE.has(key) || !S.run) return;
  if (S.slow) { clearTimeout(live.tm); live.tm = setTimeout(() => generate({ live: true }), 350); return; }
  if (live.raf) return;
  live.raf = requestAnimationFrame(() => { live.raf = 0; generate({ live: true }); });
}
// Генерация. Обычно вся история считается за десятки миллисекунд и показывается готовой. Но бывают браузеры, где
// программы идут без ускорения (например, iPhone в режиме блокировки): там история заняла бы секунды пустого экрана.
// Поэтому считаем порциями: если за 150 мс прогон не кончился, устройство медленное (S.slow) — дальше история
// пишется на глазах, токен за токеном, как у больших моделей, а страница между порциями остаётся живой.
function generate({ newSeed = false, live: isLive = false, atStep = -1, keepSheet = false } = {}) {
  if (!S.engine) { S.pendingGen = true; return; }
  const keepStep = isLive ? S.cur : -1;
  stop();
  let words = '';
  if (S.mode === 'order') {
    const pw = parseWords(S.words);
    if (!pw.words.length) { hint(pw.foreign ? 'words.foreign' : 'words.empty'); setSheet(true); return; }
    hint(pw.foreign ? 'words.foreign' : pw.extra ? 'words.extra' : null);
    words = pw.words.join(', ');
  } else if (!S.prompt.trim()) { hint('prompt.empty'); setSheet(true); return; }
  else hint(null);
  const prompt = S.mode === 'order' ? Engine.orderPrompt(words) : S.prompt;
  if (newSeed) { P.seed = 1 + Math.floor(Math.random() * 99999); S.pane.refresh(); }
  if (P.loopPenalty && !S.engine.corpus) {      // статистика корпуса для штрафа за повторы: ~2,3 МБ, один раз
    S.corpusLoading ||= fetch('corpus-4grams.bin').then((r) => r.arrayBuffer()).then((b) => { S.engine.corpus = new Corpus(new Uint8Array(b)); })
      .catch((e) => { console.error(e); S.corpusLoading = null; });
    S.corpusLoading.then(() => { if (S.engine.corpus) generate({ live: isLive, atStep, keepSheet }); });
    return;
  }
  const e = S.engine, id = (S.genId = (S.genId || 0) + 1);      // новый прогон отменяет тот, что ещё пишется
  e.settings({ temperature: P.temperature, topK: P.topK, seed: P.seed, wbBase: P.wbBase, wbTau: P.wbTau,
    wbStart: P.wbStart, fsm: P.fsm, corpusPenalty: P.loopPenalty, minP: P.minP, maxNew: P.maxNew });
  const t0 = performance.now();
  const run = { prompt, words, nPrompt: e.begin(prompt, words), settings: { ...e.cfg }, steps: [] };
  // считать шаги, пока не кончится история (false) или не выйдет время порции (true)
  const more = (budget) => { const tb = performance.now();
    for (let r; (r = e.step());) { run.steps.push(r); if (r.kind === 'gen' && r.output > 2) e.gen.push(r.output); if (performance.now() - tb > budget) return true; }
    return false; };
  const done = (streamed) => {
    const ms = performance.now() - t0, gen = run.steps.filter((x) => x.kind === 'gen'), last = run.steps[run.steps.length - 1];
    $('m-story-sub').textContent = t('story.sub', { gen: gen.length, ms: ms.toFixed(0), seed: P.seed,
      words: last && last.words.length ? `${last.wordsUsed}/${last.words.length}` : '' }).replace(/^·\s*/, '');
    if (!isLive) countRun();
    const firstGen = Math.max(0, run.nPrompt - 1), n = run.steps.length;
    if (atStep >= 0) setCur(Math.min(atStep, n - 1));
    else if (isLive) setCur(Math.min(Math.max(keepStep, firstGen), n - 1));
    else if (streamed) setCur(S.follow ? n - 1 : S.cur);       // историю уже видели, пока она писалась: не проигрываем заново
    else if (P.autoplay) { setCur(firstGen); play(); } else setCur(n - 1);
  };
  if (!isLive && atStep < 0 && !keepSheet) setSheet(false);
  if (!more(S.slow ? 30 : 150)) { S.run = run; buildStory(); done(false); return; }
  S.slow = true; S.streaming = true; S.follow = true; S.run = run;
  $('m-gen').classList.add('busy'); $('m-story-sub').textContent = t('mob.writing');
  buildStory(); setCur(run.steps.length - 1);
  const pump = () => {
    if (id !== S.genId) return;
    const going = more(40);
    growStory(); if (S.follow) setCur(run.steps.length - 1); else setCur(S.cur);
    if (going) { setTimeout(pump, 0); return; }
    S.streaming = false; $('m-gen').classList.remove('busy'); done(true);
  };
  setTimeout(pump, 0);
}

// ---------------------------------------------------------------- история
function buildStory() { $('m-story-text').textContent = ''; S.items = []; S.built = 0; growStory(); }
// дописать в историю шаги, которых в ней ещё нет (вся история сразу или новая порция, пока она пишется)
function growStory() {
  const box = $('m-story-text'), steps = S.run.steps, tt = S.engine.tokenText;
  const add = (tok, step, cls) => {
    const sp = document.createElement('span');
    sp.className = 'tok ' + cls + (tok <= 2 ? ' special' : ''); sp.textContent = tt[tok];
    if (step >= 0) sp.dataset.step = step;
    box.appendChild(sp); S.items.push({ el: sp, step });
  };
  if (!S.built && steps.length) add(steps[0].input, -1, 'prompt');
  for (let i = S.built; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === 'prompt') { add(s.output, i, 'prompt'); continue; }
    if (i === S.run.nPrompt - 1) { const br = document.createElement('span'); br.className = 'prompt-sep'; box.appendChild(br); }
    const biased = s.bias.some((b) => b.tok === s.output && b.val < 1e8);
    add(s.output, i, 'gen' + (s.forced >= 0 ? ' forced' : '') + (biased ? ' biased' : ''));
  }
  S.built = steps.length;
}

function setCur(i) {
  if (!S.run || !S.run.steps.length) return;
  S.cur = Math.max(0, Math.min(S.run.steps.length - 1, i));
  clearTimeout(setCur.lt); setCur.lt = setTimeout(writeLink, 300);
  if (setCur.at !== S.cur) { S.track = null; S.pos = -1; setCur.at = S.cur; }   // отслеживаемый кандидат относится к одному шагу
  const step = S.run.steps[S.cur];
  let curEl = null;
  for (const it of S.items) { const on = it.step === S.cur; it.el.classList.toggle('cur', on); it.el.classList.toggle('future', it.step > S.cur); if (on) curEl = it.el; }
  if (curEl) {      // выбранное слово всегда в видимой части истории
    const box = $('m-story-text'), r = curEl.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.bottom > b.bottom - 4) box.scrollTop += r.bottom - b.bottom + 8; else if (r.top < b.top + 4) box.scrollTop -= b.top - r.top + 8;
  }
  // полоса шагов своя, не <input type=range>: на iPhone ручка и заливка стандартного ползунка не следовали за шагом
  const sk = $('m-seek'), nS = S.run.steps.length;
  sk.style.setProperty('--f', nS > 1 ? S.cur / (nS - 1) : 0);
  sk.setAttribute('aria-valuemax', nS); sk.setAttribute('aria-valuenow', S.cur + 1);
  $('m-label').textContent = `${S.cur + 1}/${S.run.steps.length}`;
  // На медленном устройстве окно вкладки не пересчитывается на каждом токене, пока история проигрывается или пишется:
  // один такой пересчёт там дольше самого шага, и всё шло бы рывками. Окно обновится, когда шаг выбран.
  if (S.slow && (S.timer || S.streaming)) { S.stale = true; return; }
  S.stale = false; renderTab(step);
}

function play() {
  if (!S.run) return;
  if (S.cur >= S.run.steps.length - 1) setCur(Math.max(0, S.run.nPrompt - 1));
  stop();
  $('m-play').innerHTML = ICON.pause; $('m-gen').classList.add('busy');
  S.timer = setInterval(() => { if (S.cur >= S.run.steps.length - 1) { if (S.streaming) return; stop(); return; } setCur(S.cur + 1); }, 1000 / P.speed);
}
function stop() {
  if (S.timer) clearInterval(S.timer); S.timer = null; S.follow = false;      // человек взял управление: курсор больше не бежит за текстом
  $('m-play').innerHTML = ICON.play; if (!S.streaming) $('m-gen').classList.remove('busy');
  if (S.stale && S.run && !S.streaming) { S.stale = false; renderTab(S.run.steps[S.cur]); }
}

// История красится весами attention: выбранная голова (её можно выбрать и в Model, и в Attention) или, на вкладке
// Attention без выбора, все головы вместе. Обведённое слово — прошлый токен, выбранный в полосе или в списке головы.
function tint() {
  if (!S.run || !S.mattn) return;
  const on = S.head || S.tab === 'attn';
  if (on) S.mattn.steps = S.run.steps, S.mattn.cur = S.cur, S.mattn.head = S.head;
  const w = on ? S.mattn.weights() : null;
  for (const it of S.items) {
    const key = it.step + 1, v = w && key <= S.cur ? w[key] : 0;
    it.el.style.backgroundColor = v > 0.01 && !it.el.classList.contains('cur') ? `rgba(217,137,74,${Math.min(0.85, Math.sqrt(v))})` : '';
    it.el.classList.toggle('kv-sel', S.tab === 'attn' && key === S.pos);
  }
}
function reveal(el) {
  if (!el) return;
  const box = $('m-story-text'), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.bottom > b.bottom - 4) box.scrollTop += r.bottom - b.bottom + 8; else if (r.top < b.top + 4) box.scrollTop -= b.top - r.top + 8;
}

// ---------------------------------------------------------------- вкладки
function setTab(k, load = true) {
  S.tab = k;
  if (k === 'docs' && load && S.docs && !S.docs.url) S.docs.load(S.docs.last() || DOCS_HOME, { push: false });
  document.querySelectorAll('.m-tabs button').forEach((b) => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.m-pane').forEach((p) => { p.hidden = p.dataset.pane !== k; });
  if (S.run) renderTab(S.run.steps[S.cur]);
}
// Docs: те же страницы, что на сайте, в стиле студии (docs.js). Шаг и настройки при этом не теряются.
const DOCS_HOME = `/${lang === 'en' ? '' : lang + '/'}docs/`;
function openDoc(href) { setTab('docs', false); S.docs.load(href); }
// ссылка «открыть этот шаг в студии» из статьи: те же слова, seed и настройки без перезагрузки страницы
function openStudioLink(href) {
  const q = new URL(href, location.href).searchParams;
  if (!q.has('seed') || !S.engine || (q.get('q') === '8' ? 8 : 4) !== S.bits) { location.href = href; return; }   // другие веса — загрузить заново
  const D = linkDefaults(q);
  for (const [key, short] of Object.entries(QK)) P[key] = q.has(short) ? (typeof DEF[key] === 'boolean' ? q.get(short) === '1' : Number(q.get(short))) : D[key];
  P.seed = Math.max(1, Math.min(99999, Number(q.get('seed')) || 1));
  if (q.has('p')) { S.mode = 'continue'; S.prompt = q.get('p'); } else { S.mode = 'order'; if (q.has('w')) S.words = q.get('w').split(',').join(', '); }
  S.pane.refresh(); S.syncMode();
  setTab('logits');
  generate({ live: true, atStep: q.has('s') ? Number(q.get('s')) : -1 });
}
function renderTab(step) {
  if (S.tab === 'logits') renderLogits(step);
  if (S.tab === 'model') { S.mmodel.head = S.head; S.mmodel.set(step); }
  if (S.tab === 'attn') S.mattn.set(S.run.steps, S.cur, S.head, S.track, S.pos);
  tint();
}

// Logits: «модель выбирала между» — кандидаты шага с долей шанса. Показываем восемь, по кнопке шестнадцать: дальше
// доли процента. Кандидат, которого исключили top-k или min-p, остаётся в списке серым, с нулевым шансом.
function renderLogits(s) {
  const tt = S.engine.tokenText, all = s.topk.slice().sort((a, b) => b.p - a.p), n = S.more ? 16 : 8, top = all.slice(0, n);
  const pc = (p) => (p <= 0 ? '0' : p < 0.01 ? '<1' : (100 * p).toFixed(0)) + '%';
  $('m-logits').innerHTML = `<div class="ls-title"><span data-term="logits">${t('g.choose')}</span></div>` +
    top.map((c) => `<div class="ls-row${c.tok === s.output ? ' on' : ''}${c.p <= 0 ? ' out' : ''}">` +
      `<span class="tokpill">${esc(show(tt[c.tok]))}</span><span class="ls-bar"><i style="width:${(100 * c.p).toFixed(1)}%"></i></span><span class="ls-p">${pc(c.p)}</span></div>`).join('') +
    (all.length > 8 ? `<button class="m-more" id="m-more">${t(S.more ? 'mob.less' : 'mob.more')}</button>` : '') +
    `<div class="ls-note">${t('g.spaceNote')}</div>`;
}

// ---------------------------------------------------------------- термины и «поделиться»
// Подчёркнутый термин: нажатие показывает то же объяснение из глоссария, что на большом экране при наведении, и
// ссылку на статью (если она написана). Нажатие в любое другое место закрывает подсказку.
function glossary() {
  const tip = document.createElement('div'); tip.className = 'gloss-tip m-tip'; tip.hidden = true; document.body.appendChild(tip);
  let docs = new Set();
  fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.glossary) docs = new Set(j.glossary); }).catch(() => {});
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.m-tip a.gloss-more');
    if (a) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); tip.hidden = true; openDoc(a.getAttribute('href')); return; }
    if (tip.contains(e.target)) return;
    const el = e.target.closest('[data-term]');
    if (!el || (el === glossary.cur && !tip.hidden)) { tip.hidden = true; glossary.cur = null; return; }
    const key = 'gl.' + el.dataset.term, text = t(key);
    if (text === key) return;
    e.preventDefault();                 // термин в подписи переключателя: показать объяснение, а не переключить
    glossary.cur = el; tip.textContent = text;
    const slug = DOC_SLUG[el.dataset.term];
    if (slug && docs.has(slug)) { const m = document.createElement('a'); m.className = 'gloss-more'; m.target = '_blank'; m.rel = 'noopener';
      m.href = `/${lang === 'en' ? '' : lang + '/'}docs/glossary/${slug}/`; m.textContent = t('gl.more'); tip.appendChild(m); }
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
  });
  addEventListener('scroll', () => { tip.hidden = true; }, true);
}
function toast(text) {
  const el = document.createElement('div'); el.className = 'gloss-tip m-toast'; el.textContent = text; document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
// «Поделиться»: ссылка на этот момент (слова, seed, настройки, шаг) уходит в системное окно отправки телефона.
// Где его нет — ссылка копируется; где нельзя и копировать (страница не по https) — показывается для ручного копирования.
async function share() {
  clearTimeout(setCur.lt); writeLink();
  const url = location.href;
  if (navigator.share) { try { await navigator.share({ title: 'TensorLupa', text: t('share.text'), url }); } catch { /* человек закрыл окно */ } return; }
  try { await navigator.clipboard.writeText(url); toast(t('share.copied')); }
  catch { const el = document.createElement('div'); el.className = 'gloss-tip m-toast m-link'; el.innerHTML = `<input readonly value="${esc(url).replace(/"/g, '&quot;')}">`; document.body.appendChild(el);
    const i = el.querySelector('input'); i.focus(); i.select(); setTimeout(() => document.addEventListener('click', (ev) => { if (!el.contains(ev.target)) el.remove(); }, { once: true }), 0); }
}

// ---------------------------------------------------------------- привязка и загрузка
function langMenu() {
  const next = LANGS[(LANGS.findIndex((l) => l.code === lang) + 1) % LANGS.length];
  $('m-lang').title = next.name;
  $('m-lang').addEventListener('click', () => setLang(next.code));
}
function bind() {
  $('m-gen').addEventListener('click', () => generate());
  $('m-play').addEventListener('click', () => (S.timer ? stop() : play()));
  // шаг назад и вперёд: нажатие — один токен; если держать — токены бегут, пока палец на кнопке
  for (const [id, d] of [['m-prev', -1], ['m-next', 1]]) {
    const b = $(id); let hold = 0, rep = 0, held = false;
    const end = () => { clearTimeout(hold); clearInterval(rep); hold = rep = 0; };
    b.addEventListener('pointerdown', () => { held = false; end(); hold = setTimeout(() => { held = true; stop(); rep = setInterval(() => setCur(S.cur + d), 70); }, 380); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, end);
    b.addEventListener('click', () => { if (held) { held = false; return; } stop(); setCur(S.cur + d); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());      // долгое нажатие не должно открывать меню
  }
  // полоса шагов: нажать или вести пальцем; ручка ходит между краями с отступом в половину своей ширины
  const sk = $('m-seek'); let seeking = false;
  const seek = (e) => { if (!S.run) return; const r = sk.getBoundingClientRect(), pad = 11, f = Math.max(0, Math.min(1, (e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad)));
    stop(); setCur(Math.round(f * (S.run.steps.length - 1))); };
  sk.addEventListener('pointerdown', (e) => { seeking = true; try { sk.setPointerCapture(e.pointerId); } catch { /* без захвата */ } seek(e); });
  sk.addEventListener('pointermove', (e) => { if (seeking) seek(e); });
  sk.addEventListener('pointerup', () => { seeking = false; }); sk.addEventListener('pointercancel', () => { seeking = false; });
  sk.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { stop(); setCur(S.cur - 1); } if (e.key === 'ArrowRight') { stop(); setCur(S.cur + 1); } });
  $('m-story-text').addEventListener('click', (e) => { const el = e.target.closest('.tok[data-step]'); if (el) { stop(); setCur(Number(el.dataset.step)); } });
  document.querySelector('.m-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('m-logits').addEventListener('click', (e) => { if (e.target.closest('#m-more')) { S.more = !S.more; renderLogits(S.run.steps[S.cur]); } });
  $('m-share').addEventListener('click', share);
  bindGrab(); langMenu(); glossary();
}

async function boot() {
  build(); buildSheet(); bind();
  S.docs = new DocPane(document.querySelector('[data-pane=docs]'), { t, home: DOCS_HOME, onStudio: (href) => openStudioLink(href) });
  setTab(S.tab);
  try {
    const file = (MODELS.find((x) => x.bits === S.bits) || MODELS[0]).file;
    S.engine = await loadEngine(new Uint8Array(await (await fetch(file)).arrayBuffer()));
  } catch (e) { $('m-status').textContent = t('status.fail', { msg: e.message }); $('m-status').classList.add('fail'); return; }
  $('m-status').hidden = true;
  S.mmodel = new MModel(document.querySelector('[data-pane=model]'), S.engine, {
    head: (hd) => { S.head = hd; tint(); },
    doc: (href) => openDoc(href) });
  S.mattn = new MAttn(document.querySelector('[data-pane=attn]'), S.engine, {
    head: (hd) => { S.head = hd; tint(); },
    pos: (t, scroll) => { S.pos = t; tint(); if (scroll) reveal(S.items.find((it) => it.step + 1 === t)?.el); },
    doc: (href) => openDoc(href) });
  S.booted = true;
  if (LINK) generate({ atStep: LINK.step }); else if (S.pendingGen) generate();
}
boot();
