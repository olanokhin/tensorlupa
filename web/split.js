// Центр студии — группы окон с вкладками, как группы редакторов в VS Code. Сейчас вкладок две: «Model» и «Attention».
// Группа — окно со своей полосой стеклянных язычков; активный язычок и окно под ним — одна стеклянная фигура
// (clip-path + световая кромка в SVG), неактивные язычки — тонкое стекло, к основанию темнее.
// Две группы рядом: тянуть границу — соотношение; дотянуть до края — группы сливаются в одну.
// Язычок можно тащить: вдоль своей полосы — переставить; на полосу или в окно другой группы — перенести туда
// (если группа опустела, она исчезает: так из двух окон получается одно); в левую или правую половину единственного
// окна — разделить экран на две группы (если ширины хватает на две по MIN).
// Двойной щелчок по границе — исходное соотношение, стрелки на границе — шаг 5%.
// Состояние запоминается в браузере. 3D-виды сами подстраиваются под размер (у них ResizeObserver).
// Это же основа будущего режима вкладок для узких экранов и телефона.

const STORE = 'mq.split2';
const DEFAULT = 1.32 / 2.32;   // левой группе (модели) чуть больше места: она вытянута вдоль потока
const MIN = 180;               // уже этого окно бесполезно
const GUT = 8;                 // ширина границы между группами
const NARROW = 1100;            // область окон уже этого — Docs открывается вкладкой, а не отдельным окном
const DRAG = 6;                // столько пикселей нужно сдвинуть язычок, чтобы это был не щелчок, а перетаскивание
const TR = 12, F = 10, BR = 16; // скругление верха язычка, вогнутых переходов у основания, углов окна
const NS = 'http://www.w3.org/2000/svg';

export class Split {
  // panes: [{ el, label, closable }] — закрываемые вкладки (Docs) могут не входить ни в одну группу
  constructor(box, panes, { title, closeLabel, onChange } = {}) {
    this.box = box; this.panes = panes; this.onChange = onChange;
    this.load();

    this.gut = document.createElement('div');
    this.gut.className = 'split-gutter'; this.gut.tabIndex = 0;
    this.gut.setAttribute('role', 'separator'); this.gut.setAttribute('aria-orientation', 'vertical');
    if (title) this.gut.title = title;
    box.appendChild(this.gut);

    // у каждой группы своя полоса язычков (вторая видна, только когда групп две)
    this.strips = [0, 1].map(() => { const s = document.createElement('div'); s.className = 'split-strip'; s.setAttribute('role', 'tablist'); box.appendChild(s); return s; });
    this.tabs = panes.map((p, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'split-tab'; b.dataset.i = i;
      b.setAttribute('role', 'tab');
      // текст язычка — термин глоссария: наведение показывает подсказку со ссылкой в Docs
      const l = document.createElement('span'); l.className = 'split-l'; l.textContent = p.label; if (p.term) l.dataset.term = p.term; b.append(l);
      if (p.closable) {
        const x = document.createElement('span'); x.className = 'split-x'; x.setAttribute('role', 'button'); x.title = closeLabel || '';
        x.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        x.addEventListener('click', (e) => { e.stopPropagation(); this.close(i); });
        b.classList.add('closable'); b.append(x);
      }
      b.addEventListener('pointerdown', (e) => this.dragTab(e, i));
      b.addEventListener('click', () => { if (this.dragged) { this.dragged = false; return; } const g = this.groupOf(i); this.active[g] = i; this.apply(true); });
      return b;
    });
    this.mark = document.createElement('span'); this.mark.className = 'split-mark'; this.mark.hidden = true;   // куда встанет язычок
    this.drop = document.createElement('div'); this.drop.className = 'split-drop'; this.drop.hidden = true;
    box.appendChild(this.drop);

    this.gut.addEventListener('pointerdown', (e) => this.down(e));
    this.gut.addEventListener('dblclick', () => { this.r = DEFAULT; this.apply(true); });
    this.gut.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      this.r = Math.min(0.85, Math.max(0.15, this.r + (e.key === 'ArrowLeft' ? -0.05 : 0.05)));
      this.apply(true);
    });
    new ResizeObserver(() => this.shapeAll()).observe(box);
    this.apply(false);
  }

  // ---------------------------------------------------------------- состояние
  load() {
    let st = {};
    try { st = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* без памяти — по умолчанию */ }
    const flat = Array.isArray(st.groups) ? st.groups.flat() : [], n = this.panes.length;
    const ok = Array.isArray(st.groups) && st.groups.length >= 1 && st.groups.length <= 2 && st.groups.every((g) => Array.isArray(g) && g.length) &&
      flat.every((k) => Number.isInteger(k) && k >= 0 && k < n) && new Set(flat).size === flat.length &&
      this.panes.every((p, k) => p.closable || flat.includes(k));   // незакрываемые вкладки есть всегда
    this.groups = ok ? st.groups : [[0], [1]];
    this.active = ok && Array.isArray(st.active) && st.active.length === this.groups.length && st.active.every((a, g) => this.groups[g].includes(a))
      ? st.active : this.groups.map((g) => g[0]);
    this.r = typeof st.r === 'number' && st.r > 0.05 && st.r < 0.95 ? st.r : DEFAULT;
  }
  save() { try { localStorage.setItem(STORE, JSON.stringify({ groups: this.groups, active: this.active, r: this.r })); } catch { /* только на эту загрузку */ } }
  groupOf(i) { return this.groups.findIndex((g) => g.includes(i)); }
  roomForTwo() { return this.box.getBoundingClientRect().width >= 2 * MIN + GUT; }

  // показать вкладку i (сделать активной в её группе) — например, для тура
  show(i) { const g = this.groupOf(i); if (g >= 0 && this.active[g] !== i) { this.active[g] = i; this.apply(true); } }
  isOpen(i) { return this.groupOf(i) >= 0; }
  // открыть закрытую вкладку: справа отдельным окном, а если окна уже два (или места нет) — вкладкой в правом
  // на узких экранах (область окон уже NARROW — ноутбуки до ~1366) — вкладкой в самом широком окне: статье нужна ширина
  open(i) {
    if (this.groupOf(i) >= 0) { this.show(i); return; }
    const narrow = this.box.getBoundingClientRect().width < NARROW;
    if (this.groups.length === 1 && this.roomForTwo() && !narrow) { this.groups.push([i]); this.active.push(i); }
    else { const g = this.groups.length === 2 && narrow && this.r >= 0.5 ? 0 : this.groups.length - 1; this.groups[g].push(i); this.active[g] = i; }
    this.apply(true);
  }
  close(i) {
    const g = this.groupOf(i); if (g < 0 || !this.panes[i].closable) return;
    this.groups[g] = this.groups[g].filter((k) => k !== i);
    if (!this.groups[g].length) { this.groups.splice(g, 1); this.active.splice(g, 1); }
    else if (this.active[g] === i) this.active[g] = this.groups[g][Math.max(0, this.groups[g].length - 1)];
    this.apply(true);
  }

  // перенести вкладку i в группу tg на место slot; опустевшая группа исчезает
  moveTab(i, tg, slot) {
    const sg = this.groupOf(i);
    this.groups[sg] = this.groups[sg].filter((k) => k !== i);
    const target = this.groups[tg];   // берём после filter: при перестановке в своей группе это уже новый массив
    target.splice(Math.min(slot, target.length), 0, i);
    this.active[tg] = i;
    if (!this.groups[sg].length) { this.groups.splice(sg, 1); this.active.splice(sg, 1); }
    else if (!this.groups[sg].includes(this.active[sg])) this.active[sg] = this.groups[sg][0];
    this.apply(true);
  }
  // разделить единственную группу: вкладка i уходит на сторону side
  splitTo(i, side) {
    if (this.groups.length !== 1 || this.groups[0].length < 2 || !this.roomForTwo()) return;
    const rest = this.groups[0].filter((k) => k !== i), keep = rest.includes(this.active[0]) ? this.active[0] : rest[0];
    this.groups = side === 'left' ? [[i], rest] : [rest, [i]];
    this.active = this.groups.map((g) => (g.includes(i) ? i : keep));
    this.apply(true);
  }
  // слить группы в одну (видна вкладка keep)
  merge(keep) {
    if (this.groups.length < 2) return;
    this.groups = [this.groups.flat()]; this.active = [keep];
    this.apply(true);
  }

  // ---------------------------------------------------------------- граница между группами
  down(e) {
    e.preventDefault();
    this.gut.setPointerCapture(e.pointerId);
    this.box.classList.add('splitting');
    const rect = this.box.getBoundingClientRect(), W = rect.width - GUT;
    let edge = null; const r0 = this.r;   // после слияния и нового разделения — соотношение до перетаскивания
    const move = (ev) => {
      const x = ev.clientX - rect.left - GUT / 2;
      edge = x < MIN ? 1 : W - x < MIN ? 0 : null;   // остаётся группа с другой стороны
      this.box.classList.toggle('to-tabs', edge !== null);
      if (edge === null) { this.r = Math.min(0.95, Math.max(0.05, x / W)); this.apply(false); }
    };
    const up = () => {
      this.gut.removeEventListener('pointermove', move); this.gut.removeEventListener('pointerup', up);
      this.box.classList.remove('splitting', 'to-tabs');
      if (edge !== null) { this.r = r0; this.merge(this.active[edge]); } else this.apply(true);
    };
    this.gut.addEventListener('pointermove', move); this.gut.addEventListener('pointerup', up);
  }

  // ---------------------------------------------------------------- перетаскивание язычка
  dragTab(e, i) {
    if (e.button !== 0 || e.target.closest('.split-x')) return;
    const x0 = e.clientX, y0 = e.clientY, sg = this.groupOf(i);
    let ghost = null, act = null;   // act: { kind: 'move', g, slot } | { kind: 'split', side }
    const inRect = (r, x, y, pad = 0) => x >= r.left && x <= r.right && y >= r.top - pad && y <= r.bottom + pad;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG) return;
        ghost = document.createElement('div'); ghost.className = 'split-ghost'; ghost.textContent = this.panes[i].label;
        document.body.appendChild(ghost); this.box.classList.add('tab-dragging'); this.tabs[i].classList.add('lifted');
      }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 10 + 'px';
      act = null; this.mark.hidden = true; this.drop.hidden = true;
      const x = ev.clientX, y = ev.clientY, br = this.box.getBoundingClientRect();
      // 1) над полосой язычков какой-то группы — поставить в неё (в своей — переставить)
      for (let g = 0; g < this.groups.length; g++) {
        const sr = this.strips[g].getBoundingClientRect();
        if (!inRect(sr, x, y, 6)) continue;
        if (g === sg && this.groups[g].length === 1) break;   // единственный язычок своей группы некуда переставлять
        const seq = this.groups[g].filter((k) => k !== i).map((k) => this.tabs[k]);
        // пустая часть полосы справа от язычков — уже не перестановка, а «к краю»: разделение (ниже)
        const lastRight = Math.max(...this.groups[g].map((k) => this.tabs[k].getBoundingClientRect().right));
        // до середины экрана — перестановка (язычок встанет в конец), дальше — разбивка
        if (this.groups.length === 1 && x > Math.max(lastRight + 24, br.left + br.width / 2)) break;
        let slot = seq.findIndex((t) => { const r = t.getBoundingClientRect(); return x < r.left + r.width / 2; });
        if (slot < 0) slot = seq.length;
        act = { kind: 'move', g, slot };
        this.strips[g].appendChild(this.mark); this.mark.hidden = false;
        const after = seq[slot - 1], before = seq[slot];
        const px = before ? before.getBoundingClientRect().left + F : after ? after.getBoundingClientRect().right - F : sr.left + F;
        this.mark.style.left = px - sr.left - 1 + 'px';
        break;
      }
      // 2) над окном: в другой группе — перенести туда; в единственной группе — разделить по половинам
      if (!act && inRect(br, x, y)) {
        if (this.groups.length === 2) {
          const og = 1 - sg, pr = this.panes[this.active[og]].el.getBoundingClientRect();
          if (inRect(pr, x, y)) { act = { kind: 'move', g: og, slot: this.groups[og].length }; this.showDrop({ left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom }, br); }
        } else if (this.groups[0].length > 1 && this.roomForTwo()) {
          const side = x < br.left + br.width / 2 ? 'left' : 'right', mid = br.left + br.width / 2;
          act = { kind: 'split', side };
          this.showDrop({ left: side === 'left' ? br.left : mid + GUT / 2, right: side === 'left' ? mid - GUT / 2 : br.right, top: br.top, bottom: br.bottom }, br);   // до уровня язычков
        }
      }
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      this.drop.hidden = true; this.mark.hidden = true; this.box.classList.remove('tab-dragging'); this.tabs[i].classList.remove('lifted');
      if (!ghost) return;                       // не тянули — обычный щелчок, его обработает click
      ghost.remove(); this.dragged = true; setTimeout(() => { this.dragged = false; }, 0);
      if (act?.kind === 'move') this.moveTab(i, act.g, act.slot);
      else if (act?.kind === 'split') { this.r = 0.5; this.splitTo(i, act.side); }   // ровно как показала рамка: пополам
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  showDrop(r, br) {
    Object.assign(this.drop.style, { left: r.left - br.left + 'px', top: r.top - br.top + 'px', width: r.right - r.left + 'px', height: r.bottom - r.top + 'px' });
    this.drop.hidden = false;
  }

  // ---------------------------------------------------------------- раскладка
  apply(persist) {
    const G = this.groups.length, col = (g) => (G === 2 ? (g === 0 ? 1 : 3) : 1);
    this.box.classList.toggle('one-group', G === 1);
    this.box.style.gridTemplateColumns = G === 2 ? `minmax(0, ${this.r}fr) ${GUT}px minmax(0, ${1 - this.r}fr)` : 'minmax(0, 1fr)';
    this.box.style.gridTemplateRows = 'auto minmax(0, 1fr)';
    Object.assign(this.gut.style, { gridColumn: '2', gridRow: '1 / 3' }); this.gut.hidden = G === 1;
    this.strips.forEach((s, g) => {
      s.hidden = g >= G;
      if (g >= G) return;
      Object.assign(s.style, { gridColumn: String(col(g)), gridRow: '1' });
      // первый язычок полосы продолжает левый край окна: слева у него нет вогнутого перехода и отступа под него
      this.groups[g].forEach((k, n) => { s.appendChild(this.tabs[k]); this.tabs[k].style.order = n; this.tabs[k].classList.toggle('first', n === 0); });
    });
    this.panes.forEach((p, i) => {
      const g = this.groupOf(i), on = g >= 0 && this.active[g] === i;
      if (g < 0) { p.el.hidden = true; this.tabs[i].remove(); this.tabs[i].classList.remove('on'); return; }   // закрыта
      p.el.hidden = !on;
      p.el.classList.add('tab-body');
      Object.assign(p.el.style, { gridColumn: String(col(g)), gridRow: '1 / 3' });
      this.tabs[i].classList.toggle('on', on);
      this.tabs[i].setAttribute('aria-selected', String(on));
    });
    this.gut.setAttribute('aria-valuenow', String(Math.round(100 * this.r)));
    requestAnimationFrame(() => this.shapeAll());
    if (persist) { this.save(); this.onChange?.(); }
  }

  // ---------------------------------------------------------------- стеклянные формы
  shapeAll() {
    this.groups.forEach((g, n) => { const a = this.active[n]; if (a !== undefined) this.shapePane(this.panes[a].el, this.tabs[a], this.strips[n]); });
    this.shapeTabs();
  }
  // окно с активным язычком — одна фигура: тело окна плюс язычок сверху с вогнутыми переходами у основания
  shapePane(P, tab, strip) {
    if (!P || P.hidden) return;
    const W = P.clientWidth, H = P.clientHeight; if (!W || !H) return;
    const pr = P.getBoundingClientRect(), tr = tab.getBoundingClientRect(), T = strip.offsetHeight;
    const x0 = Math.max(0, tr.left - pr.left + (tab.classList.contains('first') ? 0 : F)), x1 = Math.min(W, tr.right - pr.left - F);
    const leftEdge = x0 < BR + F, rightEdge = W - x1 < BR + F;
    const path = (k) => {        // k — отступ внутрь от краёв окна (0 — фигура, 0.75 — линия кромки)
      const l = k, r = W - k, t = k, b = H - k, X0 = leftEdge ? l : x0, X1 = rightEdge ? r : x1;
      return [
        leftEdge ? `M ${l} ${b - BR} L ${l} ${t + TR} A ${TR} ${TR} 0 0 1 ${l + TR} ${t}` : `M ${l} ${b - BR} L ${l} ${T + BR} A ${BR} ${BR} 0 0 1 ${l + BR} ${T} L ${X0 - F} ${T} A ${F} ${F} 0 0 0 ${X0} ${T - F} L ${X0} ${t + TR} A ${TR} ${TR} 0 0 1 ${X0 + TR} ${t}`,
        rightEdge ? `L ${r - TR} ${t} A ${TR} ${TR} 0 0 1 ${r} ${t + TR}` : `L ${X1 - TR} ${t} A ${TR} ${TR} 0 0 1 ${X1} ${t + TR} L ${X1} ${T - F} A ${F} ${F} 0 0 0 ${X1 + F} ${T} L ${r - BR} ${T} A ${BR} ${BR} 0 0 1 ${r} ${T + BR}`,
        `L ${r} ${b - BR} A ${BR} ${BR} 0 0 1 ${r - BR} ${b} L ${l + BR} ${b} A ${BR} ${BR} 0 0 1 ${l} ${b - BR} Z`,
      ].join(' ');
    };
    const d = path(0);
    P.style.clipPath = `path('${d}')`;
    let svg = P.querySelector(':scope > .tab-rim');
    if (!svg) {
      const id = 'tabRimOn' + Math.random().toString(36).slice(2, 7);
      svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'tab-rim');
      svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,0.32)"/><stop offset="0.12" stop-color="rgba(255,255,255,0.12)"/><stop offset="1" stop-color="rgba(255,255,255,0.06)"/></linearGradient></defs><path fill="none" stroke-width="1.5" stroke="url(#${id})"/>`;
      P.appendChild(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.querySelector('path').setAttribute('d', path(0.75));
  }
  // неактивные язычки: та же форма, только тонкое стекло; кромка гаснет книзу
  shapeTabs() {
    this.tabs.forEach((b, i) => {
      let svg = b.querySelector(':scope > .tab-rim');
      if (b.classList.contains('on')) { b.style.clipPath = ''; if (svg) svg.style.display = 'none'; return; }
      const w = b.offsetWidth, h = b.offsetHeight; if (!w || !h) return;
      const first = b.classList.contains('first');
      const shape = (k) => (first ? `M ${k} ${h} L ${k} ${TR + k} A ${TR} ${TR} 0 0 1 ${TR + k} ${k}` : `M 0 ${h} A ${F} ${F} 0 0 0 ${F} ${h - F} L ${F} ${TR + k} A ${TR} ${TR} 0 0 1 ${F + TR} ${k}`) +
        ` L ${w - F - TR} ${k} A ${TR} ${TR} 0 0 1 ${w - F} ${TR + k} L ${w - F} ${h - F} A ${F} ${F} 0 0 0 ${w} ${h}`;
      b.style.clipPath = `path('${shape(0)} Z')`;
      const outline = shape(0.75);
      if (!svg) {
        svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'tab-rim');
        svg.innerHTML = `<defs><linearGradient id="tabRimOff${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,0.24)"/><stop offset="0.55" stop-color="rgba(255,255,255,0.08)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><path fill="none" stroke-width="1.5" stroke="url(#tabRimOff${i})"/>`;
        b.appendChild(svg);
      }
      svg.style.display = '';
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.querySelector('path').setAttribute('d', outline);
    });
  }
}
