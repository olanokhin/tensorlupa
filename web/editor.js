// Редактор micro-qwen3: генерирует историю тем же движком, что на ESP32-S3 (WebAssembly), записывает трассу каждого
// шага и даёт откатиться на любой токен. Версия 1: полоса логитов, история, таймлайн, настройки, инспектор.
import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { loadEngine, Engine, WORD_STATES } from './engine/engine.js';
import { LogitStrip, show } from './logits.js';
import { AttentionView } from './attention.js';
import { ModelView } from './modelview.js';
import { View3D } from './view3d.js';
import { AttnStack3D } from './attn3d.js';
import { GrowthChart } from './growth.js';

const $ = (id) => document.getElementById(id);
const P = {
  temperature: 0.6, topK: 40, seed: 1, randomSeed: true,
  wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, loopPenalty: false,
  maxNew: 200, speed: 24, autoplay: true,
};
const S = { engine: null, run: null, cur: 0, timer: null, items: [] };
window.__viz = S;   // для отладки из консоли

// ---------------------------------------------------------------- загрузка
async function boot() {
  try {
    const buf = new Uint8Array(await (await fetch('model.bin')).arrayBuffer());
    S.engine = await loadEngine(buf);
  } catch (e) {
    $('status').textContent = 'не удалось загрузить модель: ' + e.message;
    return;
  }
  const i = S.engine.info;
  $('status').textContent = `${i.layers} слоя × ${i.dim}, ${i.heads} головы, словарь ${i.vocab} · WebAssembly`;
  S.strip = new LogitStrip($('logits-canvas'), $('tip'), S.engine.tokenText);
  S.amode = 'look';
  S.attn = new AttentionView($('attn-canvas'), (sel) => { if (S.a3d) S.a3d.setSel(sel); tintStory(); renderInspector(S.run.steps[S.cur]); });
  S.attn.engine = S.engine; S.attn.mode = S.amode;
  if (S.a3d) { S.a3d.weightsFn = (sel) => S.attn.weights(S.amode, sel); S.a3d.mode = S.amode; }
  S.aview = '3d';
  try { S.a3d = new AttnStack3D($('attn-3d'), S.engine.info, (sel) => { S.attn.sel = { ...sel }; tintStory(); renderInspector(S.run.steps[S.cur]); }, S.engine.tokenText); }
  catch (e) { S.a3d = null; console.error(e); }
  S.growth = new GrowthChart($('growth-canvas'), S.engine.info);
  S.model = new ModelView($('model-canvas'), S.engine);
  S.view = '3d';
  try { S.v3d = new View3D($('model-3d'), S.engine); S.v3d.onSelect = () => renderInspector(S.run.steps[S.cur]); }
  catch (e) { S.v3d = null; switchView('schema'); console.error(e); }
  buildPane();
  bindUI();
  generate();
}

// ---------------------------------------------------------------- панель настроек
function buildPane() {
  const pane = new Pane({ container: $('pane'), title: 'Настройки' });
  const fs = pane.addFolder({ title: 'Сэмплинг' });
  fs.addBinding(P, 'temperature', { label: 'температура', min: 0.05, max: 1.5, step: 0.05 });
  fs.addBinding(P, 'topK', { label: 'top-k', min: 1, max: 64, step: 1 });
  fs.addBinding(P, 'seed', { label: 'seed', min: 1, max: 99999, step: 1 });
  fs.addBinding(P, 'randomSeed', { label: 'новый seed' });
  const fo = pane.addFolder({ title: 'Заказ слов' });
  fo.addBinding(P, 'wbBase', { label: 'доплата base', min: 0, max: 6, step: 0.25 });
  fo.addBinding(P, 'wbTau', { label: 'нарастание τ', min: 10, max: 400, step: 10 });
  fo.addBinding(P, 'wbStart', { label: 'старт каскада', min: 0, max: 1, step: 0.25 });
  fo.addBinding(P, 'fsm', { label: 'автомат' });
  fo.addBinding(P, 'loopPenalty', { label: 'штраф за циклы' });
  const fp = pane.addFolder({ title: 'Прогон' });
  fp.addBinding(P, 'maxNew', { label: 'макс. токенов', min: 20, max: 220, step: 10 });
  fp.addBinding(P, 'speed', { label: 'скорость, ток/с', min: 1, max: 120, step: 1 });
  fp.addBinding(P, 'autoplay', { label: 'печатать по токену' });
  pane.addButton({ title: 'Сгенерировать заново' }).on('click', generate);
  S.pane = pane;
}

// ---------------------------------------------------------------- генерация
function generate() {
  if (!S.engine) return;
  stop();
  const mode = $('mode').value;
  const words = mode === 'order' ? $('words').value.trim() : '';
  const prompt = mode === 'order' ? Engine.orderPrompt(words) : $('prompt').value;
  if (P.randomSeed) { P.seed = 1 + Math.floor(Math.random() * 99999); S.pane.refresh(); }
  S.engine.settings({ temperature: P.temperature, topK: P.topK, seed: P.seed, wbBase: P.wbBase, wbTau: P.wbTau,
    wbStart: P.wbStart, fsm: P.fsm, loopImm: P.loopPenalty ? 3 : 0, loopMult: P.loopPenalty ? 1 : 0, maxNew: P.maxNew });
  const t0 = performance.now();
  S.run = S.engine.run(prompt, words);
  const ms = performance.now() - t0;
  const gen = S.run.steps.filter((s) => s.kind === 'gen');
  const last = S.run.steps[S.run.steps.length - 1];
  $('story-sub').textContent = `· ${gen.length} токенов ответа за ${ms.toFixed(0)} мс в браузере` +
    (last && last.words.length ? ` · слова ${last.wordsUsed}/${last.words.length}` : '') + ` · seed ${P.seed}`;
  buildStory();
  const firstGen = Math.max(0, S.run.nPrompt - 1);
  $('t-range').max = S.run.steps.length - 1;
  if (P.autoplay) { setCur(firstGen); play(); } else setCur(S.run.steps.length - 1);
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
  const step = S.run.steps[S.cur];
  for (const it of S.items) {
    it.el.classList.toggle('cur', it.step === S.cur);
    it.el.classList.toggle('future', it.step > S.cur);
  }
  const curEl = S.items.find((it) => it.step === S.cur);
  if (curEl) curEl.el.scrollIntoView({ block: 'nearest' });
  $('t-range').value = S.cur; fillRange($('t-range'));
  const g = step.kind === 'gen' ? `ответ, токен ${step.genIndex + 1}` : 'промпт';
  $('t-label').textContent = `шаг ${S.cur + 1}/${S.run.steps.length} · ${g}`;
  S.strip.set(step, P.temperature > 0 ? S.run.settings.temperature : 1);
  $('logits-sub').textContent = `· шаг ${S.cur + 1}: следующий токен после «${show(S.engine.tokenText[step.input])}»` +
    (step.forced >= 0 ? ' · кусок задан автоматом — показано, что выбрала бы модель сама'
      : step.kind === 'prompt' ? ' · промпт: токен известен, показан прогноз модели'
        : ` · T ${S.run.settings.temperature}, top-k ${S.run.settings.topK} · белая черта — p без доплаты`);
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
  const what = S.amode === 'contrib' ? 'вкладом' : 'вниманием';
  $('attn-sub').textContent = sel.layer < 0 ? `· история подсвечена ${what} всех голов · щёлкни карту — одна голова`
    : `· голова ${sel.head + 1} слоя ${sel.layer + 1}: подсветка ${what} · щёлкни ещё раз — все головы`;
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
  $('t-play').textContent = '⏸';
  S.timer = setInterval(() => {
    if (S.cur >= S.run.steps.length - 1) { stop(); return; }
    setCur(S.cur + 1);
  }, 1000 / P.speed);
}
function stop() { if (S.timer) clearInterval(S.timer); S.timer = null; $('t-play').textContent = '▶'; }

// ---------------------------------------------------------------- инспектор шага
function renderInspector(s) {
  const tt = S.engine.tokenText, pill = (t) => `<span class="tokpill">${esc(show(tt[t]))}</span>`;
  const chosen = s.topk.find((c) => c.tok === s.output);
  const how = s.kind === 'prompt' ? 'известен (промпт)' : s.forced >= 0 ? 'задан автоматом' : 'выбран сэмплингом';
  let h = (S.v3d && S.view === '3d' ? S.v3d.describe() : '') + (S.a3d ? S.a3d.describe() : '');
  if (S.run && S.attn.steps) {
    const sel = S.attn.sel, look = S.attn.weights('look'), con = S.attn.weights('contrib');
    if (look && con) {
      const top = Array.from(look.keys()).sort((a, b) => (look[b] + con[b]) - (look[a] + con[a])).slice(0, 6);
      const who = sel.layer >= 0 ? `голова ${sel.head + 1} слоя ${sel.layer + 1}` : 'все головы вместе';
      h += `<h4>Внимание и вклад · ${who}</h4><table class="cmp"><tr><th>токен</th><th class="bar-look">смотрит</th><th class="bar-contrib">вклад</th></tr>` +
        top.map((t) => `<tr><td>${pill(S.run.steps[t].input)} <span style="color:var(--dim)">#${t}</span></td><td class="bar-look">${(100 * look[t]).toFixed(0)}%</td><td class="bar-contrib">${(100 * con[t]).toFixed(0)}%</td></tr>`).join('') +
        `</table><div class="note">смотрит — вес внимания; вклад — вес × сила того, что голова реально забирает из токена (‖W_o·value‖)</div>`;
    }
  }
  h += `<h4>Шаг ${S.cur + 1}</h4><div class="kv">
    <div>позиция</div><div>${s.pos}</div>
    <div>вход</div><div>${pill(s.input)}</div>
    <div>выход</div><div>${pill(s.output)} <span style="color:var(--muted)">${how}</span></div>
    <div>p выхода</div><div>${s.forced >= 0 ? '100% (принудительно)' : chosen ? (100 * chosen.p).toFixed(1) + '%' : '—'}</div>
    <div>энтропия</div><div>${s.entropy.toFixed(2)} бит</div>
    ${s.kind === 'gen' && s.forced < 0 ? `<div>бросок</div><div>${(100 * s.sampleR).toFixed(1)}% массы</div>` : ''}
  </div>`;
  if (s.words.length) {
    h += `<h4>Заказанные слова</h4><table class="words"><tr><th>слово</th><th>состояние</th><th>куски</th></tr>`;
    for (const w of s.words) {
      h += `<tr><td>${esc(w.text)}</td><td><span class="st st${w.state}">${WORD_STATES[w.state]}</span></td>` +
        `<td>${w.state === 1 || w.state === 2 ? w.k + '/' : ''}${w.pieces}</td></tr>`;
    }
    h += '</table>';
    const b = s.wb, val = b.base * (b.u + b.u0 + 1) * (1 + b.t / b.tau);
    if (s.kind === 'prompt') h += `<h4>Доплата</h4><div class="note">на шагах промпта не действует — следующий токен известен</div>`;
    else if (s.wordsUsed >= s.words.length) h += `<h4>Доплата</h4><div class="note">все заказанные слова уже в тексте — доплаты нет, работает только правило «после слова — без мусорных суффиксов»</div>`;
    else h += `<h4>Доплата</h4><div class="formula">base·(u + u0 + 1)·(1 + t/τ)<br>= ${b.base}·(${b.u} + ${b.u0} + 1)·(1 + ${b.t}/${b.tau})<br>= <b>${val.toFixed(2)}</b> к логиту каждого ещё не найденного слова</div>
      <div class="note">u — слов уже в тексте, u0 — старт каскада, t — токенов с последнего найденного слова</div>`;
    const pushes = s.bias.filter((x) => x.val < 1e8);
    if (pushes.length) h += `<div class="note">подтолкнуты: ${pushes.map((x) => pill(x.tok) + ' +' + x.val.toFixed(2)).join(' ')}</div>`;
    if (s.forced >= 0) h += `<div class="note">автомат собирает слово: разрешён только ${pill(s.forced)}</div>`;
    if (s.form >= 0) {
      const banned = s.logitsFinal.reduce((n, v) => n + (v <= -1e29), 0);
      h += `<div class="note">слово только что закончилось: запрещено ${banned} буквенных продолжений` +
        (s.allowed.length ? `, кроме ${s.allowed.map(pill).join(' ')}` : '') + '</div>';
    }
    if (s.loop.length) h += `<div class="note">штраф за циклы: ${s.loop.map((x) => pill(x.tok) + ' ' + x.val.toFixed(2)).join(' ')}</div>`;
  }
  $('inspector').innerHTML = h;
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- управление
function switchAttn(v) {
  S.aview = v;
  document.querySelectorAll('.tab[data-aview]').forEach((b) => b.classList.toggle('on', b.dataset.aview === v));
  $('attn-3d').hidden = v !== '3d'; $('attn-canvas').hidden = v !== '2d'; $('explode-box').hidden = v !== '3d';
  if (S.run) setCur(S.cur);
  if (v === '3d' && S.a3d) { S.a3d.resize(); S.a3d.setSel(S.attn.sel); }
}

function switchView(v) {
  S.view = v;
  document.querySelectorAll('.vp-tabs .tab[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('model-3d').hidden = v !== '3d'; $('model-canvas').hidden = v !== 'schema';
  $('cams').hidden = v !== '3d';
  $('spread-box').hidden = v !== '3d';
  $('model-sub').hidden = v === '3d';
  $('model-sub').textContent = v === '3d' ? '· поток слева направо · мышь — вращать'
    : '· путь токена через слои · справа — logit lens';
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
addEventListener('scroll', () => glassRanges.forEach(placeKnob), true);
new MutationObserver(() => glassRanges.forEach(placeKnob)).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });

function bindUI() {
  document.querySelectorAll('input[type=range]').forEach((el) => { glassRange(el); el.addEventListener('input', () => fillRange(el)); });
  document.querySelectorAll('.tab.amode').forEach((b) => b.addEventListener('click', () => {
    S.amode = b.dataset.amode; S.attn.mode = S.amode; if (S.a3d) { S.a3d.mode = S.amode; S.a3d.ridges(); }
    document.querySelectorAll('.tab.amode').forEach((x) => x.classList.toggle('on', x === b));
    tintStory(); if (S.run) renderInspector(S.run.steps[S.cur]);
  }));
  document.querySelectorAll('.tab[data-aview]').forEach((b) => b.addEventListener('click', () => switchAttn(b.dataset.aview)));
  $('explode').addEventListener('input', (e) => { if (S.a3d) S.a3d.setExplode(Number(e.target.value)); });
  $('spread').addEventListener('input', (e) => { if (S.v3d) S.v3d.setSpread(Number(e.target.value)); });
  document.querySelectorAll('.vp-tabs .tab[data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  document.querySelectorAll('.tab.cam').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab.cam').forEach((x) => x.classList.toggle('on', x === b));
    if (S.v3d) S.v3d.preset(b.dataset.cam);
  }));
  $('gen').addEventListener('click', generate);
  $('words').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
  $('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });
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

boot();
