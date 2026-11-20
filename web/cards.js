// Картотека правой колонки: стеклянные карточки лежат стопкой внахлёст, как в ящике.
// У закрытой карточки виден корешок (заголовок), её содержимое уходит под следующую карточку и просвечивает сквозь
// стекло затемнённым и размытым (backdrop-filter у каждой карточки). Щелчок по корешку открывает карточку —
// всё, что ниже, съезжает. Открытыми могут быть несколько; какие открыты — запоминается.
// Карточки бывают постоянные (настройки) и из инспектора: его HTML режется на карточки по заголовкам <h4>.
// Порядок можно менять: тянуть карточку за заголовок вверх-вниз (короткий щелчок — свернуть/развернуть).
// Свой порядок запоминается отдельно для Гайда и Лаба; карточки, которых в нём нет, встают в конец.

const HEAD = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head')) || 34;   // высота корешка (токен --head)
const OVERLAP = 8;      // открытая карточка чуть заходит под корешок следующей — ощущение стопки
const PEEK = 120;       // сколько содержимого закрытой карточки лежит под следующей (видно сквозь стекло)
const STORE = 'mq.cards.closed';
const ORDER = 'mq.cards.order.';   // + режим
const DRAG = 6;                    // столько пикселей — и это уже перетаскивание, а не щелчок

export class Deck {
  constructor(scroller) {
    this.scroller = scroller;
    this.el = document.createElement('div'); this.el.className = 'deck';
    scroller.appendChild(this.el);
    this.cards = [];                 // { key, el, head, title, body, fixed }
    try { this.closed = new Set(JSON.parse(localStorage.getItem(STORE) || '[]')); } catch { this.closed = new Set(); }
    new ResizeObserver(() => this.layout()).observe(scroller);
  }

  make(key, title, fixed) {
    const el = document.createElement('section'); el.className = 'card';
    const head = document.createElement('header'); head.className = 'card-h';
    const t = document.createElement('span'); t.className = 'card-t'; t.textContent = title;
    const chev = document.createElement('span'); chev.className = 'card-chev';
    chev.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    head.append(t, chev);
    const body = document.createElement('div'); body.className = 'card-b';
    el.append(head, body);
    const c = { key, el, head, title: t, body, fixed };
    head.addEventListener('click', () => { if (this.dragged) { this.dragged = false; return; } this.toggle(c); });
    head.addEventListener('pointerdown', (e) => this.drag(e, c));
    new ResizeObserver(() => this.layout()).observe(body);
    return c;
  }

  // постоянная карточка (настройки): возвращает тело, куда класть содержимое
  add(key, title) {
    const c = this.make(key, title, true);
    const i = this.cards.findIndex((x) => !x.fixed);
    if (i < 0) { this.cards.push(c); this.el.appendChild(c.el); } else { this.cards.splice(i, 0, c); this.el.insertBefore(c.el, this.cards[i + 1].el); }
    this.base = (this.base || []).concat(c);                 // порядок постоянных карточек по умолчанию
    this.cards = this.ordered(); this.placeDom();
    this.layout();
    return c.body;
  }

  // карточки из HTML инспектора: каждая секция — от <h4> до следующего <h4>
  sync(html) {
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const secs = [];
    for (const n of [...tpl.content.childNodes]) {
      if (n.nodeName === 'H4') secs.push({ title: n.textContent, nodes: [] });
      else if (secs.length) secs[secs.length - 1].nodes.push(n);
    }
    const keyOf = (t) => t.replace(/\d+/g, '#').split(/[·:]/)[0].trim().toLowerCase();
    const old = new Map(this.cards.filter((c) => !c.fixed).map((c) => [c.key, c]));
    const fixed = this.cards.filter((c) => c.fixed), dyn = [];
    for (const s of secs) {
      const key = keyOf(s.title);
      if (dyn.some((c) => c.key === key)) continue;
      let c = old.get(key);
      if (c) old.delete(key); else c = this.make(key, '', false);
      c.title.textContent = s.title;
      c.body.replaceChildren(...s.nodes);
      dyn.push(c);
    }
    for (const c of old.values()) c.el.remove();
    // ведущая карточка (в Гайде — «что произошло») стоит над настройками и подсвечена янтарной кромкой
    const lead = dyn.filter((c) => c.key === this.lead);
    this.dyn = dyn;
    this.cards = this.ordered();
    for (const c of dyn) c.el.classList.toggle('lead', c.key === this.lead);
    // новый шаг — текст ведущей карточки мягко проявляется; при быстром проигрывании (чаще ~3 раз в секунду) — нет
    for (const c of lead) {
      const now = performance.now(), html = c.body.innerHTML;
      if (c.prevHtml !== undefined && c.prevHtml !== html && now - (c.prevT || 0) > 350) { c.body.classList.remove('fresh'); void c.body.offsetWidth; c.body.classList.add('fresh'); }
      c.prevHtml = html; c.prevT = now;
    }
    // порядок в DOM = порядок в стопке; переставляем только при изменении — перенос узла между нажатием и
    // отпусканием мыши срывает щелчок (во время генерации карточки обновляются 24 раза в секунду)
    this.placeDom();
    this.layout();
  }

  placeDom() {
    const cur = [...this.el.children];
    if (cur.length !== this.cards.length || this.cards.some((c, i) => cur[i] !== c.el)) {
      this.cards.forEach((c, i) => { if (this.el.children[i] !== c.el) this.el.insertBefore(c.el, this.el.children[i] || null); });
    }
  }

  // ---------------------------------------------------------------- свой порядок
  setMode(m) {
    this.mode = m;
    try { this.order = JSON.parse(localStorage.getItem(ORDER + m) || 'null'); } catch { this.order = null; }
    this.cards = this.ordered(); this.placeDom(); this.layout();
  }
  // порядок по умолчанию: ведущая карточка, постоянные (в порядке добавления), остальные карточки инспектора
  defaultOrder() {
    const dyn = this.dyn || [];
    return [...dyn.filter((c) => c.key === this.lead), ...(this.base || []), ...dyn.filter((c) => c.key !== this.lead)];
  }
  // порядок по умолчанию, но карточки из своего порядка — в его последовательности; остальные — в конце
  ordered(list = this.defaultOrder()) {
    const ord = Array.isArray(this.order) ? this.order : null;
    if (!ord) return list;
    const rank = (c) => { const i = ord.indexOf(c.key); return i >= 0 ? i : 1000 + list.indexOf(c); };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }
  saveOrder() {
    const keys = this.cards.filter((c) => !c.el.hidden).map((c) => c.key);
    this.order = [...keys, ...(this.order || []).filter((k) => !keys.includes(k))];   // скрытые сейчас карточки не теряем
    try { localStorage.setItem(ORDER + (this.mode || 'lab'), JSON.stringify(this.order)); } catch { /* только на эту загрузку */ }
  }

  // тянуть карточку за заголовок: остальные расступаются на лету, на отпускании порядок запоминается
  drag(e, c) {
    if (e.button !== 0 || e.target.closest('a, button, input')) return;
    const y0 = e.clientY, top0 = parseFloat(c.el.style.top) || 0;
    let moving = false;
    const move = (ev) => {
      const dy = ev.clientY - y0;
      if (!moving) {
        if (Math.abs(dy) < DRAG) return;
        moving = true; c.el.classList.add('dragging'); this.el.classList.add('anim', 'sorting');
      }
      const y = top0 + dy, mid = y + Math.min(c.el.offsetHeight, 80) / 2;
      const others = this.cards.filter((x) => x !== c && !x.el.hidden);
      let idx = others.findIndex((x) => mid < parseFloat(x.el.style.top) + Math.min(x.el.offsetHeight, 80) / 2);
      if (idx < 0) idx = others.length;
      const rest = this.cards.filter((x) => x !== c);
      const at = idx < others.length ? rest.indexOf(others[idx]) : rest.length;
      const next = [...rest.slice(0, at), c, ...rest.slice(at)];
      if (next.some((x, i) => x !== this.cards[i])) { this.cards = next; this.order = this.cards.map((x) => x.key); this.layout(); }
      c.el.style.top = Math.max(-8, y) + 'px';
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!moving) return;
      this.dragged = true; setTimeout(() => { this.dragged = false; }, 0);
      c.el.classList.remove('dragging'); this.placeDom(); this.layout(); this.saveOrder();
      clearTimeout(this.animT); this.animT = setTimeout(() => this.el.classList.remove('anim', 'sorting'), 400);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  // ключ ведущей карточки по её заголовку (null — без ведущей); вступает в силу при следующем sync
  setLead(title) { this.lead = title ? title.replace(/\d+/g, '#').split(/[·:]/)[0].trim().toLowerCase() : null; }

  // показать/спрятать постоянную карточку по ключу (режимы Гайд/Лаб)
  show(key, on) { const c = this.cards.find((x) => x.key === key); if (c) c.el.hidden = !on; this.layout(); }

  toggle(c) {
    this.closed.has(c.key) ? this.closed.delete(c.key) : this.closed.add(c.key);
    try { localStorage.setItem(STORE, JSON.stringify([...this.closed])); } catch { /* без памяти — не страшно */ }
    this.el.classList.add('anim'); clearTimeout(this.animT);
    this.animT = setTimeout(() => this.el.classList.remove('anim'), 400);
    this.layout();
  }

  layout() {
    // 1) позиции и собственные высоты; 2) с конца: содержимое закрытой карточки не выходит за нижний край
    // карточки, что лежит на ней (иначе выглядывает из-под закрытой последней)
    // скрытые карточки (например, в режиме «Гайд») в стопке не участвуют
    const cards = this.cards.filter((c) => !c.el.hidden);
    const n = cards.length, top = [], h = [], open = [];
    let y = 0;
    cards.forEach((c, i) => {
      open[i] = !this.closed.has(c.key);
      const full = HEAD + c.body.scrollHeight, last = i === n - 1;
      h[i] = open[i] ? full : last ? HEAD : Math.min(full, HEAD + PEEK);
      top[i] = y;
      y += open[i] ? (last ? full : full - OVERLAP) : HEAD;
    });
    for (let i = n - 2; i >= 0; i--) if (!open[i]) h[i] = Math.min(h[i], top[i + 1] + h[i + 1] - top[i]);
    cards.forEach((c, i) => {
      c.el.classList.toggle('open', open[i]);
      c.el.style.top = top[i] + 'px'; c.el.style.height = h[i] + 'px'; c.el.style.zIndex = String(i + 1);
    });
    this.el.style.height = y + 'px';
  }

}
