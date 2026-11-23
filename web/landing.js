// Главная: живая трасса на первом экране, ссылка для телефона, переключатель языка.
// Трасса — настоящая: первые 40 токенов истории seed 1111 (dragon, cookie, school), записанные движком студии на 8-битной версии с правилами по умолчанию (штраф за повторы, min-p 0.02),
// и на каждом шаге четыре самых вероятных кандидата. Модель здесь не загружается — страница лёгкая и для телефона.

const TRACE = [["Once",[["Once",1],["One",0],["The",0],["Lily",0]]],[" upon",[[" upon",1],[" there",0],[",",0],[" a",0]]],[" a",[[" a",1],[" time",0],[" the",0],[" an",0]]],[" time",[[" time",1],[" little",0],[" while",0],[" long",0]]],[",",[[",",0.966],[" there",0.034],[" in",0],[" a",0]]],[" there",[[" there",1],[" in",0],[" a",0],[" two",0]]],[" was",[[" was",1],[" were",0],[" lived",0],[" be",0]]],[" a",[[" a",1],[" an",0],[" two",0],[" another",0]]],[" little",[[" little",0.812],[" big",0.099],[" boy",0.061],[" school",0.029]]],[" girl",[[" girl",0.694],[" boy",0.306],[" school",0],[" duck",0]]],[" named",[[" named",1],[" called",0],[".",0],[" who",0]]],[" Lily",[[" Lily",1],[" Lucy",0],[" Sue",0],[" Sarah",0]]],[".",[[".",1],[" who",0],[" and",0],[".\n",0]]],[" She",[[" She",0.962],[" Lily",0.038],[" One",0],[" They",0]]],[" loved",[[" loved",1],[" had",0],[" was",0],[" liked",0]]],[" to",[[" to",1],[" playing",0],[" cookies",0],[" going",0]]],[" play",[[" play",0.707],[" eat",0.15],[" read",0.142],[" draw",0]]],[" with",[[" with",0.789],[" in",0.139],[" outside",0.072],[" at",0]]],[" her",[[" her",1],[" cookies",0],[" toys",0],[" cookie",0]]],[" toys",[[" toys",1],[" dolls",0],[" friends",0],[" toy",0]]],[" and",[[" and",0.968],[",",0.032],[".",0],[" in",0]]],[" eat",[[" eat",0.471],[" read",0.332],[" run",0.098],[" her",0.061]]],[" cookies",[[" cookies",0.363],[" snacks",0.286],[" yummy",0.184],[" candy",0.132]]],[".",[[".",1],[" with",0],[".\n",0],[",",0]]],[" One",[[" One",1],[" But",0],[" Her",0],[" She",0]]],[" day",[[" day",1],[" sunny",0],[" night",0],[" morning",0]]],[",",[[",",1],[" she",0],[" her",0],[" Lily",0]]],[" she",[[" she",0.514],[" Lily",0.435],[" her",0.051],[" while",0]]],[" went",[[" went",0.771],[" saw",0.136],[" was",0.054],[" found",0.039]]],[" to",[[" to",0.974],[" outside",0.026],[" for",0],[" on",0]]],[" school",[[" school",0.717],[" the",0.283],[" her",0],[" a",0]]],[" and",[[" and",0.603],[" with",0.298],[" to",0.1],[" because",0]]],[" saw",[[" saw",0.955],[" found",0.045],[" played",0],[" met",0]]],[" a",[[" a",0.748],[" her",0.252],[" an",0],[" many",0]]],[" dragon",[[" dragon",0.782],[" big",0.218],[" cookie",0],[" little",0]]],[".",[[".",0.494],[" on",0.381],[" in",0.125],[" with",0]]],[" The",[[" The",0.769],[" She",0.148],[" It",0.084],[" Her",0]]],[" dragon",[[" dragon",1],[" princess",0],[" knight",0],[" story",0]]],[" was",[[" was",1],[" said",0],[" had",0],[" looked",0]]],[" big",[[" very",0.456],[" big",0.39],[" scared",0.079],[" a",0.036]]]];

const D = window.MQ_DICTS || {}, L = window.MQ_LANG || 'en';
const t = (k) => (D[L] && D[L][k]) ?? D.en[k] ?? k;
const $ = (id) => document.getElementById(id);
const show = (s) => s.replace(/\n/g, '↵');
const pct = (p) => (p < 0.01 ? '<1' : Math.round(100 * p)) + '%';

// ---------------------------------------------------------------- трасса
const box = $('trace-text'), list = $('tc-list');
const spans = TRACE.map(([tok], i) => {
  const s = document.createElement('span');
  s.className = 'tok'; s.textContent = show(tok); s.dataset.i = i; s.tabIndex = -1;
  return s;
});
const caret = document.createElement('span'); caret.className = 'caret'; caret.setAttribute('aria-hidden', 'true');

function choose(i) {
  spans.forEach((s, k) => s.classList.toggle('on', k === i));
  const [tok, top] = TRACE[i];
  list.innerHTML = top.map(([c, p]) => `<li class="${c === tok ? 'picked' : ''}"><code>${show(c).replace(/ /g, '·').replace(/</g, '&lt;')}</code>` +
    `<span class="tc-bar"><i style="width:${Math.max(1.5, 100 * p)}%"></i></span><span class="p">${pct(p)}</span></li>`).join('');
}

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let typing = true;
function finish() { typing = false; box.replaceChildren(...spans); box.classList.add('done'); spans.forEach((s) => (s.tabIndex = 0)); }

// в конце — шаг, где модель сомневалась сильнее всего (у фаворита меньше всего шансов): там выбор виден лучше всего
const SPOT = TRACE.reduce((best, [, top], i) => (top[0][1] < TRACE[best][1][0][1] ? i : best), 0);
if (reduce) { finish(); choose(SPOT); }
else {
  // одна оркестрованная сцена: предложение печатается само, под курсором — из чего модель выбирала
  let i = 0;
  const step = () => {
    if (!typing) return;
    box.append(spans[i]); box.append(caret); choose(i);
    i++;
    if (i < TRACE.length) setTimeout(step, /[.!?,]$/.test(TRACE[i - 1][0]) ? 420 : 170);
    else { caret.remove(); finish(); choose(SPOT); }
  };
  setTimeout(step, 500);
}
// после печати — наведите или нажмите на любой токен; клавиатура тоже
const pick = (e) => { const s = e.target.closest('.tok'); if (s && !typing) choose(Number(s.dataset.i)); };
box.addEventListener('mouseover', pick); box.addEventListener('click', pick); box.addEventListener('focusin', pick);
if (matchMedia('(hover: none)').matches) $('trace-hint').textContent = t('land.trace.tap');

// ---------------------------------------------------------------- видео: играет, только когда на экране
const film = $('film');
new IntersectionObserver(([e]) => { if (e.isIntersecting) { film.preload = 'auto'; film.play().catch(() => {}); } else film.pause(); }, { threshold: 0.35 }).observe(film);

// ---------------------------------------------------------------- язык: глобус и список языков (тот же перечень, что в студии)
// Выбор ведёт на эту же страницу в другом языке: / ↔ /ru/. Новый язык — словарь в i18n/ и строка в LANGS (i18n.js).
import { LANGS, langUrl } from './i18n.js';
{
  const btn = $('lang'), menu = $('lang-menu');
  $('lang-code').textContent = L.toUpperCase();
  menu.innerHTML = LANGS.map((x) => `<a role="menuitem" href="${langUrl(x.code)}" lang="${x.code}"${x.code === L ? ' aria-current="true"' : ''}>${x.name}</a>`).join('');
  const open = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.hidden); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
}

// ---------------------------------------------------------------- счётчики: набегающие числа
// Числа набегают от нуля, когда полоса впервые видна; потом страница раз в 30 секунд спрашивает свежие значения
// и докручивает разницу — счётчик живой, пока страница открыта.
const nf = new Intl.NumberFormat(L);
const nums = { runs: document.querySelector('.ctr-num[data-key="runs"]'), users: document.querySelector('.ctr-num[data-key="users"]') };
const shown = { runs: 0, users: 0 };
let target = null, seen = false;
function roll(key, to, ms) {
  const from = shown[key], t0 = performance.now(), el = nums[key];
  if (reduce || from === to) { shown[key] = to; el.textContent = nf.format(to); return; }
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = nf.format(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(tick); else shown[key] = to;
  };
  requestAnimationFrame(tick);
}
function render(first) {
  if (!target || !seen) return;
  for (const k of ['runs', 'users']) {
    if (!first && target[k] > shown[k]) { nums[k].classList.add('up'); setTimeout(() => nums[k].classList.remove('up'), 700); }   // вспышка: +1 вживую
    roll(k, target[k], first ? 1800 : 900);
  }
  for (const k of ['runs', 'users']) document.querySelector(`.ctr-${k} .ctr-label`).textContent = t(`land.ctr.${k}`)(target[k]);
}
async function load(first) {
  try {
    const r = await fetch('/api/stats', { cache: 'no-store' }); if (!r.ok) return;
    const st = await r.json(); if (typeof st.runs !== 'number') return;
    target = st; $('counters').hidden = false; render(first);
  } catch { /* без сервера (локальная разработка) — полосы нет */ }
}
new IntersectionObserver(([e], o) => { if (e.isIntersecting) { seen = true; render(true); o.disconnect(); } }, { threshold: 0.4 }).observe($('counters'));
load(true);
setInterval(() => { if (!document.hidden) load(false); }, 30000);
