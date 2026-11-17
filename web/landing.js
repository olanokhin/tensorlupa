// Главная: живая трасса на первом экране, ссылка для телефона, переключатель языка.
// Трасса — настоящая: первые 40 токенов истории seed 2779 (dragon, cookie, school), записанные движком студии,
// и на каждом шаге четыре самых вероятных кандидата. Модель здесь не загружается — страница лёгкая и для телефона.

const TRACE = [["Once",[["Once",0.986],["One",0.01],["Lily",0.002],["The",0.001]]],[" upon",[[" upon",0.974],[" there",0.026],[",",0],[" a",0]]],[" a",[[" a",1],[" the",0],[" an",0],[" time",0]]],[" time",[[" time",1],[" happy",0],[" little",0],[" big",0]]],[" there",[[",",0.829],[" there",0.171],[" in",0],[" a",0]]],[" was",[[" was",0.994],[" were",0.004],[" lived",0.001],[" is",0]]],[" a",[[" a",0.999],[" an",0.001],[" two",0],[" three",0]]],[" little",[[" little",0.605],[" boy",0.19],[" school",0.074],[" girl",0.053]]],[" girl",[[" girl",0.871],[" boy",0.128],[" dog",0],[" school",0]]],[" named",[[".",0.688],[" called",0.15],[" named",0.137],[" who",0.016]]],[" Lily",[[" Lily",0.979],[" Lucy",0.003],[" Sarah",0.003],[" Amy",0.003]]],[".",[[".",0.999],[" who",0.001],[" and",0],[",",0]]],[" She",[[" She",0.953],[" One",0.025],[" Lily",0.021],[" Every",0]]],[" loved",[[" loved",0.76],[" was",0.115],[" had",0.082],[" lived",0.031]]],[" to",[[" to",0.989],[" playing",0.006],[" her",0.001],[" cookie",0.001]]],[" play",[[" play",0.785],[" read",0.132],[" eat",0.04],[" school",0.012]]],[" with",[[" with",0.881],[" outside",0.051],[" in",0.03],[" games",0.017]]],[" her",[[" her",1],[" a",0],[" the",0],[" cookies",0]]],[" toys",[[" toys",0.929],[" dolls",0.053],[" toy",0.008],[" friends",0.003]]],[" and",[[" and",0.866],[",",0.108],[".",0.014],[" all",0.007]]],[" read",[[" her",0.29],[" run",0.259],[" read",0.242],[" sing",0.073]]],[" books",[[" books",0.99],[" her",0.004],[" stories",0.003],[" all",0.001]]],[".",[[".",0.991],[" about",0.003],[" together",0.001],[" on",0.001]]],[" One",[[" One",0.994],[" But",0.003],[" Her",0.002],[" She",0.001]]],[" day",[[" day",1],[" night",0],[" sunny",0],[" morning",0]]],[",",[[",",0.98],[" she",0.016],[" her",0.001],[" while",0.001]]],[" she",[[" she",0.864],[" Lily",0.103],[" her",0.03],[" while",0.003]]],[" went",[[" went",0.523],[" found",0.209],[" was",0.092],[" decided",0.067]]],[" to",[[" to",0.975],[" outside",0.015],[" for",0.008],[" on",0.002]]],[" school",[[" school",0.96],[" the",0.023],[" her",0.016],[" a",0.001]]],[" and",[[" and",0.942],[" with",0.043],[" to",0.004],[" in",0.003]]],[" saw",[[" saw",0.414],[" she",0.22],[" found",0.155],[" her",0.041]]],[" a",[[" a",0.675],[" her",0.313],[" that",0.005],[" herself",0.003]]],[" big",[[" dragon",0.616],[" big",0.212],[" cookie",0.165],[" new",0.001]]],[" dragon",[[" dragon",0.976],[" cookie",0.018],[" bear",0.001],[",",0.001]]],[" in",[[".",0.672],[" on",0.178],[" in",0.117],[" flying",0.018]]],[" her",[[" the",0.673],[" her",0.315],[" a",0.01],[" school",0.001]]],[" class",[[" class",0.757],[" room",0.15],[" school",0.083],[" teacher",0.003]]],["room",[[".",0.614],["room",0.37],[" class",0.004],["'s",0.002]]],[".",[[".",0.998],[".\n",0.002],["!",0],[" that",0]]]];

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

// ---------------------------------------------------------------- язык
const other = L === 'ru' ? 'en' : 'ru';
$('lang').textContent = other === 'ru' ? 'Русский' : 'English';
$('lang').addEventListener('click', () => { try { localStorage.setItem('mq.lang', other); } catch { /* только на эту загрузку */ } location.reload(); });
