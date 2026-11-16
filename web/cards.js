// Картотека правой колонки: стеклянные карточки лежат стопкой внахлёст, как в ящике.
// У закрытой карточки виден корешок (заголовок), её содержимое уходит под следующую карточку и просвечивает сквозь
// стекло затемнённым и размытым (backdrop-filter у каждой карточки). Щелчок по корешку открывает карточку —
// всё, что ниже, съезжает. Открытыми могут быть несколько; какие открыты — запоминается.
// Карточки бывают постоянные (настройки) и из инспектора: его HTML режется на карточки по заголовкам <h4>.

const HEAD = 34;        // высота корешка
const OVERLAP = 8;      // открытая карточка чуть заходит под корешок следующей — ощущение стопки
const PEEK = 120;       // сколько содержимого закрытой карточки лежит под следующей (видно сквозь стекло)
const STORE = 'mq.cards.closed';

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
    head.addEventListener('click', () => this.toggle(c));
    new ResizeObserver(() => this.layout()).observe(body);
    return c;
  }

  // постоянная карточка (настройки): возвращает тело, куда класть содержимое
  add(key, title) {
    const c = this.make(key, title, true);
    const i = this.cards.findIndex((x) => !x.fixed);
    if (i < 0) { this.cards.push(c); this.el.appendChild(c.el); } else { this.cards.splice(i, 0, c); this.el.insertBefore(c.el, this.cards[i + 1].el); }
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
    this.cards = [...fixed, ...dyn];
    // порядок в DOM = порядок в стопке; переставляем только при изменении — перенос узла между нажатием и
    // отпусканием мыши срывает щелчок (во время генерации карточки обновляются 24 раза в секунду)
    const cur = [...this.el.children];
    if (cur.length !== this.cards.length || this.cards.some((c, i) => cur[i] !== c.el)) {
      this.cards.forEach((c, i) => { if (this.el.children[i] !== c.el) this.el.insertBefore(c.el, this.el.children[i] || null); });
    }
    this.layout();
  }

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
