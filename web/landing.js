// Главная: живая трасса на первом экране, ссылка для телефона, переключатель языка.
// Трасса — настоящая: первые 40 токенов истории seed 1111 (dragon, cookie, school), записанные движком студии на 8-битной версии,
// и на каждом шаге четыре самых вероятных кандидата. Модель здесь не загружается — страница лёгкая и для телефона.

const TRACE = [["Once",[["Once",0.977],["One",0.018],["The",0.002],["Lily",0.001]]],[" upon",[[" upon",0.996],[" there",0.004],[",",0],[" a",0]]],[" a",[[" a",1],[" time",0],[" the",0],[" an",0]]],[" time",[[" time",1],[" little",0],[" while",0],[" long",0]]],[",",[[",",0.966],[" there",0.034],[" in",0],[" a",0]]],[" there",[[" there",0.999],[" in",0.001],[" a",0.001],[" two",0]]],[" was",[[" was",0.998],[" were",0.001],[" lived",0],[" be",0]]],[" a",[[" a",1],[" an",0],[" two",0],[" another",0]]],[" little",[[" little",0.795],[" big",0.097],[" boy",0.06],[" school",0.028]]],[" girl",[[" girl",0.692],[" boy",0.305],[" school",0.002],[" duck",0]]],[" named",[[" named",0.99],[" called",0.009],[".",0.001],[" who",0]]],[" Lily",[[" Lily",0.998],[" Lucy",0.001],[" Sue",0],[" Sarah",0]]],[".",[[".",0.998],[" who",0.002],[" and",0],[".\n",0]]],[" She",[[" She",0.953],[" Lily",0.037],[" One",0.009],[" They",0]]],[" loved",[[" loved",0.978],[" had",0.016],[" was",0.003],[" liked",0.002]]],[" to",[[" to",0.991],[" playing",0.003],[" cookies",0.002],[" going",0.001]]],[" play",[[" play",0.686],[" eat",0.146],[" read",0.138],[" draw",0.008]]],[" with",[[" with",0.783],[" in",0.137],[" outside",0.072],[" at",0.004]]],[" her",[[" her",1],[" cookies",0],[" toys",0],[" cookie",0]]],[" toys",[[" toys",0.976],[" dolls",0.014],[" friends",0.007],[" toy",0.002]]],[" and",[[" and",0.951],[",",0.032],[".",0.014],[" in",0.002]]],[" eat",[[" eat",0.446],[" read",0.315],[" run",0.093],[" her",0.058]]],[" cookies",[[" cookies",0.345],[" snacks",0.272],[" yummy",0.175],[" candy",0.126]]],[".",[[".",0.999],[" with",0],[".\n",0],[",",0]]],[" One",[[" One",0.999],[" But",0],[" Her",0],[" She",0]]],[" day",[[" day",1],[" sunny",0],[" night",0],[" morning",0]]],[",",[[",",1],[" she",0],[" her",0],[" Lily",0]]],[" she",[[" she",0.511],[" Lily",0.432],[" her",0.051],[" while",0.005]]],[" went",[[" went",0.741],[" saw",0.131],[" was",0.052],[" found",0.037]]],[" to",[[" to",0.967],[" outside",0.026],[" for",0.005],[" on",0.001]]],[" school",[[" school",0.708],[" the",0.28],[" her",0.009],[" a",0.003]]],[" and",[[" and",0.594],[" with",0.294],[" to",0.098],[" because",0.002]]],[" saw",[[" saw",0.905],[" found",0.043],[" played",0.01],[" met",0.01]]],[" a",[[" a",0.743],[" her",0.25],[" an",0.002],[" many",0.001]]],[" dragon",[[" dragon",0.78],[" big",0.217],[" cookie",0.001],[" little",0]]],[".",[[".",0.475],[" on",0.366],[" in",0.12],[" with",0.007]]],[" The",[[" The",0.756],[" She",0.145],[" It",0.082],[" Her",0.007]]],[" dragon",[[" dragon",1],[" princess",0],[" knight",0],[" story",0]]],[" was",[[" was",0.979],[" said",0.015],[" had",0.004],[" looked",0.001]]],[" big",[[" very",0.424],[" big",0.363],[" scared",0.073],[" a",0.034]]]];

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

// ---------------------------------------------------------------- телефон: ссылка для компьютера
const url = location.origin + location.pathname.replace(/[^/]*$/, '');
document.querySelector('.phone-url').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(url); $('copy').textContent = t('land.copied'); } catch { /* без буфера — адрес виден на экране */ }
});
if (navigator.share) {
  $('share').hidden = false;
  $('share').addEventListener('click', () => navigator.share({ title: 'TensorLupa', text: t('land.h1'), url }).catch(() => {}));
}

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

// ---------------------------------------------------------------- счётчики: кольца с набегающими числами
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
  for (const k of ['runs', 'users']) roll(k, target[k], first ? 1800 : 900);
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
