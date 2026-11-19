// Левая часть редактора — картотека стеклянных карточек сверху вниз: модель и attention (всё свободное место),
// логиты, вход и выход, плеер. Логиты и историю можно свернуть до корешка (щелчок по заголовку): свёрнутая карточка
// уходит под следующую и просвечивает сквозь её стекло; если свернуть обе — 3D-вид занимает почти весь экран.
// Внутренняя высота свёрнутой карточки не меняется (её холсты не перерисовываются), видимая часть — clip-path.

const HEAD = 32;       // корешок = заголовок панели
const OVERLAP = 8;     // нижняя карточка заходит на верхнюю — ощущение стопки
const PEEK = 70;       // сколько свёрнутой карточки лежит под следующей
const STORE = 'mq.stage.closed';

export class Stage {
  constructor(el, { views, folds, player, onLayout }) {
    this.el = el; this.views = views; this.folds = folds; this.player = player; this.onLayout = onLayout;
    try { this.closed = new Set(JSON.parse(localStorage.getItem(STORE) || '[]')); } catch { this.closed = new Set(); }
    for (const f of folds) {
      const head = f.el.querySelector('.vp-title');
      head.classList.add('fold-h');
      const chev = document.createElement('span'); chev.className = 'fold-chev';
      chev.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      head.appendChild(chev);
      head.addEventListener('click', (e) => { if (!e.target.closest('button, input, select, label, a')) this.toggle(f.key); });
    }
    new ResizeObserver(() => this.layout()).observe(el);
    this.layout();
  }

  toggle(key) {
    this.closed.has(key) ? this.closed.delete(key) : this.closed.add(key);
    try { localStorage.setItem(STORE, JSON.stringify([...this.closed])); } catch { /* без памяти — не страшно */ }
    this.el.classList.add('anim'); clearTimeout(this.animT);
    this.animT = setTimeout(() => this.el.classList.remove('anim'), 420);
    this.layout();
    // во время анимации сдвигаются элементы, привязанные к экранным координатам (стеклянные ручки ползунков)
    const t0 = performance.now(), tick = () => { if (this.onLayout) this.onLayout(); if (performance.now() - t0 < 420) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  layout() {
    const H = this.el.clientHeight;
    if (!H) return;
    const P = this.player.offsetHeight || 48;
    const fs = this.folds.map((f) => {
      const mn = typeof f.min === 'function' ? f.min() : f.min;   // минимум может зависеть от режима (Гайд/Лаб)
      const open = !this.closed.has(f.key), full = Math.round(Math.max(mn, Math.min(f.max, f.share * H)));
      return { f, open, full, span: open ? full - OVERLAP : HEAD };
    });
    const viewsH = H - P + OVERLAP - fs.reduce((s, x) => s + x.span, 0);
    Object.assign(this.views.style, { top: '0px', height: viewsH + 'px', zIndex: 1 });
    let y = viewsH - OVERLAP;
    fs.forEach((x, i) => {
      const next = i + 1 < fs.length ? fs[i + 1] : null;
      const nextTop = y + x.span, nextBottom = next ? nextTop + (next.open ? next.full : HEAD + PEEK) : H;
      const vis = x.open ? x.full : Math.min(x.full, HEAD + PEEK, nextBottom - y);
      const el = x.f.el;
      el.classList.toggle('folded', !x.open);
      Object.assign(el.style, { top: y + 'px', height: x.full + 'px', zIndex: 2 + i,
        clipPath: `inset(0 0 ${x.full - vis}px 0 round 16px)` });
      y = nextTop;
    });
    Object.assign(this.player.style, { top: (H - P) + 'px', zIndex: 2 + fs.length });
    if (this.onLayout) this.onLayout();
  }
}
