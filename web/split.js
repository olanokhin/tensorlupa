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
const NARROW = 1100;            // область окон уже этого — Docs открывается вкладкой, а не отдельным окном
const DRAG = 6;                // столько пикселей нужно сдвинуть язычок, чтобы это был не щелчок, а перетаскивание
const F = 10;                  // радиус вогнутых переходов у основания язычка
const TUCK = 6;                // на столько неактивный язычок уходит под край окна (как в editor.css)
const NS = 'http://www.w3.org/2000/svg';
// кромка стекла — из общих токенов editor.css (--rim-w, --rim-top, --rim-low, --rim-fade), как у остальных панелей
// размеры из дизайн-системы (editor.css): граница между окнами = общий промежуток между поверхностями,
// скругление язычка и углов окна — токены радиусов
const TOK = (() => { const cs = getComputedStyle(document.documentElement), n = (k, d) => parseFloat(cs.getPropertyValue(k)) || d;
  return { gap: n('--gap', 6), tab: n('--r-tab', 12), surface: n('--r-surface', 16) }; })();
const GUT = TOK.gap, TR = TOK.tab, BR = TOK.surface;
const RIM = (() => { const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d;
  return { w: parseFloat(v('--rim-w', '1')) || 1, top: v('--rim-top', 'rgba(255,255,255,0.42)'), low: v('--rim-low', 'rgba(255,255,255,0.08)'), fade: parseFloat(v('--rim-fade', '48')) || 48 }; })();

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
  // перетаскивание язычка: за мышью едет сам язычок — парящий кусочек стекла; на его месте остаётся пустое гнездо.
  // Вдоль своей полосы соседние язычки плавно расступаются (перестановка вживую); над чужой полосой место
  // показывает янтарная черта, над окном — жёлтая рамка (разделить или перенести в другое окно)
  dragTab(e, i) {
    if (e.button !== 0 || e.target.closest('.split-x')) return;
    const x0 = e.clientX, y0 = e.clientY, sg = this.groupOf(i), tab = this.tabs[i];
    const tr0 = tab.getBoundingClientRect(), gx = x0 - tr0.left, gy = y0 - tr0.top;
    // парит всё окно (язычок + содержимое), уменьшенное до S вокруг точки захвата — язычок остаётся под курсором,
    // без скачка; неактивный язычок при
    // начале перетаскивания сперва становится активным (как в VS Code), поэтому окно у него тоже есть
    const pane = this.panes[i].el, S = 0.7;

    let float = null, act = null, live = false, standIn = null;
    // взятое окно и его язычок остаются видимыми и «активными» поверх раскладки, которую перестраивает apply()
    const keepFloat = () => {
      pane.hidden = false; tab.classList.add('on'); tab.style.clipPath = '';
      const rim = tab.querySelector(':scope > .tab-rim'); if (rim) rim.style.display = 'none';
    };
    const lift = (dx, dy) => {
      for (const el of [pane, tab]) if (el) el.style.transform = `translate(${dx}px, ${dy}px) scale(${S})`;   // dx, dy — сдвиг курсора от точки захвата
    };   // act: { kind: 'move', g, slot } | { kind: 'split', side }
    const inRect = (r, x, y, pad = 0) => x >= r.left && x <= r.right && y >= r.top - pad && y <= r.bottom + pad;
    // соседние язычки съезжают плавно: запомнить, где были, переставить, анимировать разницу (FLIP)
    const reorder = (g, order) => {
      const ts = order.map((k) => this.tabs[k]).filter((t) => t !== tab);
      const was = new Map(ts.map((t) => [t, t.getBoundingClientRect().left]));
      this.groups[g] = order; this.apply(false); if (this.floatIdx === i) keepFloat();
      for (const t of ts) {
        const d = was.get(t) - t.getBoundingClientRect().left; if (!d) continue;
        t.style.transition = 'none'; t.style.transform = `translateX(${d}px)`; void t.offsetWidth;
        t.style.transition = 'transform 200ms cubic-bezier(.2, .8, .2, 1)'; t.style.transform = '';
        clearTimeout(t._ft); t._ft = setTimeout(() => { t.style.transition = ''; }, 220);
      }
      clearTimeout(this.shapeT); this.shapeT = setTimeout(() => this.shapeAll(), 230);   // форма окна — когда язычки доехали
    };
    // язычок увели с его полосы — гнездо схлопывается, соседи плавно сдвигаются (вернули — гнездо снова есть)
    const setOut = (out) => {
      if (!pane || out === tab.classList.contains('out')) return;
      const strip = tab.parentElement, ts = [...strip.querySelectorAll('.split-tab')].filter((t) => t !== tab);
      const was = new Map(ts.map((t) => [t, t.getBoundingClientRect().left]));
      if (out) { tab.style.left = tab.offsetLeft + 'px'; tab.classList.add('out'); } else { tab.classList.remove('out'); tab.style.left = ''; }
      for (const t of ts) {
        const d = was.get(t) - t.getBoundingClientRect().left; if (!d) continue;
        t.style.transition = 'none'; t.style.transform = `translateX(${d}px)`; void t.offsetWidth;
        t.style.transition = 'transform 200ms cubic-bezier(.2, .8, .2, 1)'; t.style.transform = '';
        clearTimeout(t._ft); t._ft = setTimeout(() => { t.style.transition = ''; }, 220);
      }
      clearTimeout(this.shapeT); this.shapeT = setTimeout(() => this.shapeAll(), 230);
    };
    const move = (ev) => {
      if (!float) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG) return;
        float = document.createElement('div'); float.className = 'split-float'; float.textContent = this.panes[i].label;
        Object.assign(float.style, { width: tr0.width + 'px', height: tr0.height + 'px' });
        this.box.classList.add('tab-dragging');
        const prev = this.active[sg];
        if (prev !== i) { this.active[sg] = i; this.apply(false); this.shapeAll(); }
        // кто остаётся в окне вместо взятой вкладки: та, что была открыта до неё, иначе соседняя
        const rest = this.groups[sg].filter((k) => k !== i), at = this.groups[sg].indexOf(i);
        standIn = rest.length ? (prev !== i ? prev : this.groups[sg][at + 1] ?? this.groups[sg][at - 1]) : null;
        if (pane) {
          // вся пластина: окно и язычок масштабируются вокруг одной экранной точки, поэтому остаются совмещены
          float.hidden = true; this.floatIdx = i; this.box.classList.add('pane-dragging');
          // одна и та же экранная точка (точка захвата) — начало масштаба и у окна, и у язычка: они остаются совмещены
          const pr = pane.getBoundingClientRect(), tr = tab.getBoundingClientRect();
          pane.style.transformOrigin = `${x0 - pr.left}px ${y0 - pr.top}px`; tab.style.transformOrigin = `${x0 - tr.left}px ${y0 - tr.top}px`;
          this.box.parentElement.classList.add('pane-lifting'); document.documentElement.classList.add('pane-lifting');   // окно за краем экрана не растягивает страницу
          for (const el of [pane, tab]) el.classList.add('pane-float');
          // окно под взятой вкладкой не пустеет: там сразу открыта оставшаяся
          if (standIn !== null) { this.active[sg] = standIn; this.apply(false); this.shapeAll(); keepFloat(); }
        } else tab.classList.add('lifted');
        document.body.appendChild(float);
      }
      if (pane) lift(ev.clientX - x0, ev.clientY - y0);
      else { float.style.left = ev.clientX - gx + 'px'; float.style.top = ev.clientY - gy + 'px'; }
      act = null; this.mark.hidden = true; this.drop.hidden = true;
      const x = ev.clientX, y = ev.clientY, br = this.box.getBoundingClientRect();
      // 1) над полосой язычков какой-то группы — поставить в неё (в своей — переставить вживую)
      for (let g = 0; g < this.groups.length; g++) {
        const sr = this.strips[g].getBoundingClientRect();
        if (!inRect(sr, x, y, 6)) continue;
        if (g === sg && this.groups[g].length === 1) break;   // единственный язычок своей группы некуда переставлять
        const seq = this.groups[g].filter((k) => k !== i);
        // пустая часть полосы справа от язычков — уже не перестановка, а «к краю»: разделение (ниже)
        const lastRight = Math.max(...this.groups[g].map((k) => sr.left + this.tabs[k].offsetLeft + this.tabs[k].offsetWidth));
        // до середины экрана — перестановка (язычок встанет в конец), дальше — разбивка
        if (this.groups.length === 1 && x > Math.max(lastRight + 24, br.left + br.width / 2)) break;
        // середина парящего язычка против середин соседей (по их месту в раскладке, без учёта анимации)
        const fx = x - gx + tr0.width / 2;
        let slot = seq.findIndex((k) => fx < sr.left + this.tabs[k].offsetLeft + this.tabs[k].offsetWidth / 2);
        if (slot < 0) slot = seq.length;
        if (g === sg) {
          const order = [...seq.slice(0, slot), i, ...seq.slice(slot)];
          if (order.some((k, n) => k !== this.groups[g][n])) { reorder(g, order); live = true; }
          act = { kind: 'live' };
        } else {
          act = { kind: 'move', g, slot };
          this.strips[g].appendChild(this.mark); this.mark.hidden = false;
          const after = seq[slot - 1], before = seq[slot];
          const px = before !== undefined ? this.tabs[before].offsetLeft + F - GUT / 2 : after !== undefined ? this.tabs[after].offsetLeft + this.tabs[after].offsetWidth - F + GUT / 2 : 0;   // посередине промежутка между телами язычков
          this.mark.style.left = px - 1 + 'px';
        }
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
      setOut(act?.kind !== 'live');
      const over = act?.kind === 'move' && act.g !== sg || act?.kind === 'split';
      float.classList.toggle('over-drop', over); if (pane) pane.classList.toggle('over-drop', over);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      this.drop.hidden = true; this.mark.hidden = true; this.box.classList.remove('tab-dragging', 'pane-dragging'); tab.classList.remove('lifted');
      if (!float) return;                       // не тянули — обычный щелчок, его обработает click
      float.remove(); this.dragged = true; setTimeout(() => { this.dragged = false; }, 0);
      clearTimeout(this.shapeT); setTimeout(() => { this.shapeAll(); this.repaint(); }, 260);   // и ещё раз, когда всё доехало
      if (pane) { this.floatIdx = null; tab.classList.remove('out'); tab.style.left = ''; this.strips.forEach((st) => st.classList.remove('lift-strip')); this.box.parentElement.classList.remove('pane-lifting'); document.documentElement.classList.remove('pane-lifting'); for (const el of [pane, tab]) { el.classList.remove('pane-float', 'over-drop'); el.style.transform = ''; el.style.transformOrigin = ''; } }
      if (act?.kind === 'move') this.moveTab(i, act.g, act.slot);
      else if (act?.kind === 'split') { this.r = 0.5; this.splitTo(i, act.side); }   // ровно как показала рамка: пополам
      else if (live) { this.active[sg] = i; this.apply(true); }   // переставили вживую вдоль своей полосы — вкладка открыта, порядок запомнить
      else { if (sg >= 0 && this.groups[sg]?.includes(i)) this.active[sg] = i; this.apply(true); }   // вернули на место: вкладка открыта, как была взята
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
  // Chrome иногда не перерисовывает стекло окна (backdrop-filter + clip-path) после того, как окно прятали и
  // показывали во время перетаскивания: остаётся старая рамка поверх полосы язычков, хотя форма уже верная.
  // Мгновенно пересоздаём слой (display: none и обратно в одном кадре) — без мигания, размер окна не меняется
  repaint() {
    for (const p of this.panes) {
      if (p.el.hidden) continue;
      p.el.style.display = 'none'; void p.el.offsetWidth; p.el.style.display = '';
    }
  }
  shapeAll() {
    // парящее окно и его язычок не трогаем: их размеры искажены масштабом, форма снята до взлёта
    this.groups.forEach((g, n) => { const a = this.active[n]; if (a !== undefined && a !== this.floatIdx) this.shapePane(this.panes[a].el, this.tabs[a], this.strips[n]); });
    this.shapeTabs();
  }
  // окно с активным язычком — одна фигура: тело окна плюс язычок сверху с вогнутыми переходами у основания
  shapePane(P, tab, strip) {
    if (!P || P.hidden) return;
    const W = P.clientWidth, H = P.clientHeight; if (!W || !H) return;
    // место язычка — по раскладке (полоса + offsetLeft), а не по экрану: на экране язычок может быть посреди
    // анимации (соседи доезжают на места) или ещё парить — тогда выступ окна встал бы не туда
    const pr = P.getBoundingClientRect(), sl = strip.getBoundingClientRect().left, T = strip.offsetHeight;
    const tl = sl + tab.offsetLeft, trr = tl + tab.offsetWidth;
    const x0 = Math.max(0, tl - pr.left + (tab.classList.contains('first') ? 0 : F)), x1 = Math.min(W, trr - pr.left - F);
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
      svg.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${RIM.fade}"><stop offset="0" stop-color="${RIM.top}"/><stop offset="1" stop-color="${RIM.low}"/></linearGradient></defs><path fill="none" stroke-width="${RIM.w}" stroke="url(#${id})"/>`;
      P.appendChild(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.querySelector('path').setAttribute('d', path(RIM.w / 2));
  }
  // неактивные язычки: та же форма, только тонкое стекло; кромка гаснет книзу
  shapeTabs() {
    // соседи по полосе: со стороны соседа изгиб доходит только до середины промежутка и встречается с зеркальным
    // изгибом соседа (общая ложбинка), иначе изгибы по F налезали бы на прямой бок соседа через промежуток GUT
    const side = new Map();
    this.groups.forEach((g) => g.forEach((k, n) => side.set(k, { left: n > 0, right: n < g.length - 1 })));
    this.tabs.forEach((b, i) => {
      if (i === this.floatIdx) return;
      let svg = b.querySelector(':scope > .tab-rim');
      if (b.classList.contains('on')) { b.style.clipPath = ''; if (svg) svg.style.display = 'none'; return; }
      const w = b.offsetWidth, h = b.offsetHeight; if (!w || !h) return;
      // неактивный язычок — та же форма, что у активного (изгибы у основания), только лежит под окном: окно и изгибы
      // активного язычка его перекрывают. Ниже линии окна (T) он уходит на TUCK px под окно, внахлёст
      const T = h - TUCK, first = b.classList.contains('first'), nb = side.get(i) || {};
      // изгиб, обрезанный на расстоянии c от края кнопки: c = 0 — полный, c = F - GUT/2 — до середины промежутка
      const c = F - GUT / 2, yc = (T - F) + Math.sqrt(F * F - c * c);
      const L = first ? (k) => `M ${k} ${h} L ${k} ${TR + k} A ${TR} ${TR} 0 0 1 ${TR + k} ${k}`
        : nb.left ? (k) => `M ${c} ${h} L ${c} ${yc} A ${F} ${F} 0 0 0 ${F} ${T - F} L ${F} ${TR + k} A ${TR} ${TR} 0 0 1 ${F + TR} ${k}`
        : (k) => `M 0 ${h} L 0 ${T} A ${F} ${F} 0 0 0 ${F} ${T - F} L ${F} ${TR + k} A ${TR} ${TR} 0 0 1 ${F + TR} ${k}`;
      const R = nb.right ? ` A ${F} ${F} 0 0 0 ${w - c} ${yc} L ${w - c} ${h}` : ` A ${F} ${F} 0 0 0 ${w} ${T} L ${w} ${h}`;
      const shape = (k) => L(k) + ` L ${w - F - TR} ${k} A ${TR} ${TR} 0 0 1 ${w - F} ${TR + k} L ${w - F} ${T - F}` + R;
      b.style.clipPath = `path('${shape(0)} Z')`;
      const outline = shape(RIM.w / 2);
      if (!svg) {
        svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'tab-rim');
        svg.innerHTML = `<defs><linearGradient id="tabRimOff${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${RIM.top}"/><stop offset="0.6" stop-color="${RIM.low}"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><path fill="none" stroke-width="${RIM.w}" stroke="url(#tabRimOff${i})"/>`;
        b.appendChild(svg);
      }
      svg.style.display = '';
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.querySelector('path').setAttribute('d', outline);
    });
  }
}
