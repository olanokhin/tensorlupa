// Левая часть редактора — картотека стеклянных карточек сверху вниз: модель и attention (всё свободное место),
// логиты, вход и выход, плеер. Логиты и историю можно свернуть до корешка (щелчок по заголовку): свёрнутая карточка
// уходит под следующую и просвечивает сквозь её стекло; если свернуть обе — 3D-вид занимает почти весь экран.
// Внутренняя высота свёрнутой карточки не меняется (её холсты не перерисовываются), видимая часть — clip-path.

const HEAD = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head')) || 34;   // корешок = заголовок панели (токен --head)
const OVERLAP = 8;     // нижняя карточка заходит на верхнюю — ощущение стопки
const PEEK = 70;       // сколько свёрнутой карточки лежит под следующей
const STORE = 'mq.stage.closed';
const ORDER = 'mq.stage.order';   // свой порядок нижних панелей (их можно поменять местами, перетащив за заголовок)
const DRAG = 6;

export class Stage {
  constructor(el, { views, folds, player, onLayout }) {
    this.el = el; this.views = views; this.folds = folds; this.player = player; this.onLayout = onLayout;
    try { this.closed = new Set(JSON.parse(localStorage.getItem(STORE) || '[]')); } catch { this.closed = new Set(); }
    try {
      const ord = JSON.parse(localStorage.getItem(ORDER) || 'null');
      if (Array.isArray(ord)) this.folds = [...folds].sort((a, b) => (ord.indexOf(a.key) + 1 || 99) - (ord.indexOf(b.key) + 1 || 99));
    } catch { /* порядок по умолчанию */ }
    for (const f of folds) {
      const head = f.el.querySelector('.vp-title');
      head.classList.add('fold-h');
      const chev = document.createElement('span'); chev.className = 'fold-chev';
      chev.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      head.appendChild(chev);
      head.addEventListener('click', (e) => { if (this.dragged) { this.dragged = false; return; } if (!e.target.closest('button, input, select, label, a')) this.toggle(f.key); });
      head.addEventListener('pointerdown', (e) => this.drag(e, f));
    }
    new ResizeObserver(() => this.layout()).observe(el);
    this.layout();
  }

  // тянуть панель за заголовок вверх-вниз: панель едет за мышью, соседняя плавно уступает место,
  // когда середина перетаскиваемой проходит середину соседней (по её целевому месту, а не по анимации)
  drag(e, f) {
    if (e.button !== 0 || e.target.closest('button, input, select, label, a')) return;
    const y0 = e.clientY, top0 = parseFloat(f.el.style.top) || 0;
    let moving = false;
    const vis = (el) => Math.min(el.offsetHeight, HEAD + 60);
    const move = (ev) => {
      const dy = ev.clientY - y0;
      if (!moving) { if (Math.abs(dy) < DRAG) return; moving = true; f.el.classList.add('fold-dragging'); this.el.classList.add('anim'); clearTimeout(this.animT); }
      const y = top0 + dy, mid = y + vis(f.el) / 2;
      const i = this.folds.indexOf(f);
      for (let j = 0; j < this.folds.length; j++) {
        if (j === i) continue;
        const o = this.folds[j].el, om = parseFloat(o.style.top) + vis(o) / 2;
        if ((j < i && mid < om) || (j > i && mid > om)) { this.folds.splice(i, 1); this.folds.splice(j, 0, f); this.layout(); break; }
      }
      f.el.style.top = y + 'px';
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!moving) return;
      this.dragged = true; setTimeout(() => { this.dragged = false; }, 0);
      f.el.classList.remove('fold-dragging'); this.layout();
      try { localStorage.setItem(ORDER, JSON.stringify(this.folds.map((x) => x.key))); } catch { /* только на эту загрузку */ }
      this.animT = setTimeout(() => this.el.classList.remove('anim'), 420);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
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
      let full = Math.round(Math.max(mn, Math.min(f.max, f.share * H)));
      if (f.fit) { const c = f.fit(); if (c > 0) full = Math.max(mn, Math.min(full, Math.ceil(c))); }   // по содержимому: не выше, чем нужно
      const open = !this.closed.has(f.key);
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
