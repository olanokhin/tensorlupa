import { t as tx } from './i18n.js';
// Управление 3D-видом в духе Пункта управления macOS: стеклянная кнопка с камерой в углу; по щелчку выпадают
// отдельные парящие стеклянные модули (без общей подложки): «Камера» и «Слои» — ползунки как Display/Sound,
// переключатель — плитка с круглым значком (включено — белый диск), «Сбросить вид» — круглая кнопка.

const ICON = {
  cam: '<svg viewBox="0 0 20 20"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h1.8l1.2-1.6h5l1.2 1.6h1.8A1.5 1.5 0 0 1 17 6.5v8A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="10.3" r="2.9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  far: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>',
  near: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="currentColor"/></svg>',
  closer: '<svg viewBox="0 0 20 20"><path d="M7 6v8M13 6v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  apart: '<svg viewBox="0 0 20 20"><path d="M3 6v8M17 6v8M10 6v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  reset: '<svg viewBox="0 0 20 20"><path d="M4.5 9.5a5.5 5.5 0 1 1 1.6 4.4M4.5 5v4.5H9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lines: '<svg viewBox="0 0 20 20"><path d="M3 14c4-1 5-8 14-8M3 9c5 0 8 5 14 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

// ползунок-модуль: подпись сверху, тонкая дорожка со значками по краям (как Display в Пункте управления)
function sliderModule(label, iconL, iconR, get, set) {
  const m = document.createElement('div'); m.className = 'cc-mod cc-slider';
  m.innerHTML = `<div class="cc-title">${label}</div><div class="cc-track">${ICON[iconL]}<input type="range" min="0" max="1" step="0.001">${ICON[iconR]}</div>`;
  const inp = m.querySelector('input');
  const paint = () => inp.style.setProperty('--f', inp.value);
  inp.addEventListener('input', () => { set(Number(inp.value)); paint(); });
  m.sync = () => { inp.value = get(); paint(); };
  return m;
}

export function navPad(host, { view, spread, toggles = [], reset, layersLabel = tx('nav.layers') }) {
  const wrap = document.createElement('div'); wrap.className = 'navpad';
  const btn = document.createElement('button'); btn.className = 'navpad-btn'; btn.title = tx('nav.title'); btn.innerHTML = ICON.cam;
  const pop = document.createElement('div'); pop.className = 'cc'; pop.hidden = true;

  // камера: ползунок расстояния (логарифмически, от 0.4 до 2.2 расстояния по умолчанию)
  let base = null;
  const dist = () => { const v = view(); return v.camera.position.distanceTo(v.controls.target); };
  const LO = Math.log(0.4), HI = Math.log(2.2);
  const zoom = sliderModule(tx('nav.zoom'), 'far', 'near',
    () => 1 - (Math.log(dist() / base) - LO) / (HI - LO),
    (f) => { const v = view(), t = v.controls.target, d = base * Math.exp(LO + (1 - f) * (HI - LO));
      const dir = v.camera.position.clone().sub(t).setLength(d);   // направление — до переноса камеры
      v.camera.position.copy(t).add(dir); v.userMoved = true; });
  const mods = [zoom];
  if (spread) mods.push(sliderModule(layersLabel, 'closer', 'apart', spread.get, spread.set));
  const row = document.createElement('div'); row.className = 'cc-row';
  for (const t of toggles) {
    const b = document.createElement('button'); b.className = 'cc-mod cc-tile';
    b.innerHTML = `<span class="cc-disc">${ICON[t.icon]}</span><span class="cc-text"><b>${t.label}</b><small></small></span>`;
    const show = () => { b.classList.toggle('on', t.get()); b.querySelector('small').textContent = tx(t.get() ? 'nav.on' : 'nav.off'); };
    b.addEventListener('click', () => { t.set(!t.get()); show(); }); show();
    row.append(b);
  }
  const rb = document.createElement('button'); rb.className = 'cc-mod cc-round'; rb.title = tx('nav.reset'); rb.innerHTML = ICON.reset;
  rb.addEventListener('click', () => { reset(); setTimeout(() => { base = dist(); mods.forEach((m) => m.sync()); }, 650); });
  row.append(rb);
  pop.append(...mods, row);

  const open = (on) => {
    if (on) { if (base === null || !view().userMoved) base = dist(); mods.forEach((m) => m.sync()); }
    pop.hidden = !on; wrap.classList.toggle('open', on);
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(pop.hidden); });
  document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  wrap.append(btn, pop);
  host.appendChild(wrap);
}
