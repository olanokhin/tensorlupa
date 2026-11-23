import { t as tx } from './i18n.js';
// Внимание на текущем шаге: 12 полос, по одной на голову (3 слоя × 4 головы). В полосе слева направо все прошлые
// токены; высота и яркость столбика — вес внимания текущего токена на этот прошлый. Справа — слова, на которые голова
// смотрит сильнее всего. Щелчок по полосе выбирает голову для подсветки истории.
// Раньше здесь были карты «запрос × ключ» за всю историю (треугольники): они отвечали на вопрос, который зрителю не
// задавали, и путали. Теперь окно, как и «Модель», показывает один момент генерации.

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export class AttentionView {
  constructor(canvas, onSelect) {
    this.cv = canvas; this.onSelect = onSelect;
    this.sel = { layer: -1, head: -1 };           // -1 — среднее по всем головам последнего слоя не выбрано
    this.steps = null; this.cur = 0;
    this.selTok = -1;                             // выбранная запись KV-кэша (позиция прошлого токена), -1 — нет
    // карточка-пояснение: поверх панели стоимости, пока что-то выбрано или под курсором
    this.card = document.createElement('div'); this.card.className = 'attn-card'; this.card.hidden = true; this.cardKey = '';
    (canvas.closest('.attn-body') || canvas.parentElement).appendChild(this.card);
    // Строка шагов: что происходит внутри головы, по порядку вычисления (как строка под моделью в окне «Модель»).
    // Наведение на шаг объясняет его в карточке, щелчок закрепляет и даёт ссылку на статью (правило — web/DESIGN.md).
    // Шаг, который сейчас показывают полосы, подсвечен: «веса внимания» или, с переключателем value, «смесь значений».
    this.ops = { norm: ['RMSNorm', 'rmsnorm', 'm.op.norm'], gqa: ['Q, K, V · GQA', 'grouped-query-attention', 'm.op.gqa'], qk: ['QK-norm', 'qk-norm', 'm.op.qk'],
      rope: ['RoPE', 'rope', 'm.op.rope'], attn: [tx('m.op.attn'), 'attention', 'm.op.attn'], mix: [tx('a.op.mix'), 'attention-head', 'a.op.mix'], add: [tx('m.op.add'), 'residual-stream', 'm.op.add'] };
    this.stepsEl = document.createElement('div'); this.stepsEl.className = 'attn-steps';
    this.stepsEl.innerHTML = `<small>${tx('a.steps')}</small> ` + Object.entries(this.ops).map(([id, o]) => `<a data-op="${id}">${o[0]}</a>`).join(' <i>→</i> ');
    canvas.parentElement.after(this.stepsEl);
    this.stepsEl.after(this.card);                 // карточка стоит в потоке на месте панели стоимости и не закрывает строку шагов
    this.opHov = null; this.opSel = null; this.stepsKey = '';
    this.stepsEl.addEventListener('pointerover', (e) => { const a = e.target.closest('a[data-op]'); this.opHov = a ? a.dataset.op : null; this.draw(); });
    this.stepsEl.addEventListener('pointerleave', () => { this.opHov = null; this.draw(); });
    this.stepsEl.addEventListener('click', (e) => { const a = e.target.closest('a[data-op]'); if (!a) return; this.opSel = this.opSel === a.dataset.op ? null : a.dataset.op; this.draw(); });
    this.card.addEventListener('click', (e) => { const a = e.target.closest('a.gloss-more'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); window.dispatchEvent(new CustomEvent('mq-open-doc', { detail: a.href })); });
    // закреплённый шаг сбрасывается щелчком в любое другое место (кроме самой строки шагов и карточки со ссылкой)
    document.addEventListener('pointerdown', (e) => { if (this.opSel && !this.stepsEl.contains(e.target) && !this.card.contains(e.target)) { this.opSel = null; this.draw(); } });
    // выбранная голова и запись кэша сбрасываются щелчком вне окна «Внимание» (внутри окна — щелчком по пустому месту)
    document.addEventListener('pointerdown', (e) => {
      if ((this.sel.layer < 0 && this.selTok < 0) || (e.target.closest && e.target.closest('#view-attn'))) return;
      this.sel = { layer: -1, head: -1 }; this.selTok = -1; this.draw(); if (this.onSelect) this.onSelect(this.sel);
    });
    this.docs = new Set();
    fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.glossary) { this.docs = new Set(j.glossary); this.cardKey = ''; this.draw(); } }).catch(() => {});
    // Низкое окно (ноутбук 1440×900): полосам не хватает высоты. Тогда панель стоимости и карточка ниже, легенда скобок
    // убирается, промежутки между слоями меньше; ссылка на Docs в карточке встаёт в строку заголовка, чтобы её не обрезало.
    this.body = canvas.closest('.attn-body') || canvas.parentElement; this.compact = false;
    // совсем низкое (1280×800): ещё и строка шагов уходит, иначе три слоя не помещаются
    new ResizeObserver(() => { const hh = this.body.clientHeight, c = hh < 350, tiny = hh < 280;
      if (c !== this.compact || tiny !== this.tiny) { this.compact = c; this.tiny = tiny; this.body.classList.toggle('attn-compact', c); this.body.classList.toggle('attn-tiny', tiny); } }).observe(this.body);
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('click', (e) => this.click(e));
    // link — голова или слой, на которые навели в окне «Модель» (пластина голов); onHover — обратная связь туда
    this.link = null; this.onHover = null;
    const tell = () => { const c = this.hoverCell, k = c && !c.shelf ? c.layer + '.' + c.head : ''; if (k !== this.hovKey) { this.hovKey = k; if (this.onHover) this.onHover(k ? c : null); } };
    // рука — только там, где щелчок что-то выбирает (полоса головы или ячейка кэша)
    canvas.addEventListener('mousemove', (e) => { this.hoverCell = this.cellAt(e); canvas.style.cursor = this.hoverCell ? 'pointer' : 'default'; this.draw(); tell(); });
    canvas.addEventListener('mouseleave', () => { this.hoverCell = null; canvas.style.cursor = 'default'; this.draw(); tell(); });
  }

  set(steps, cur, info) { if (steps !== this.steps || cur < this.selTok) this.selTok = -1; this.steps = steps; this.cur = cur; this.info = info; this.draw(); }

  // веса внимания шага s для (layer, head): Float32Array(pos+1)
  row(s, layer, head) {
    const st = this.steps[s], n = st.pos + 1, H = this.info.heads;
    return st.attnP.subarray((layer * H + head) * n, (layer * H + head + 1) * n);
  }

  // веса, которыми подсвечивать историю на текущем шаге
  // mode: 'look' — куда смотрит (вес внимания), 'contrib' — вклад (вес × ‖W_o · value‖ токена)
  // Возвращает доли по токенам 0..pos (в сумме 1): для выбранной головы или для всех голов вместе.
  weights(mode = this.mode || 'look', sel = this.sel) {
    if (!this.steps || !this.info) return null;
    const { layers: L, heads: H } = this.info, n = this.steps[this.cur].pos + 1, out = new Float32Array(n);
    const heads = sel.layer >= 0 ? [[sel.layer, sel.head]] : [];
    if (!heads.length) for (let l = 0; l < L; l++) for (let h = 0; h < H; h++) heads.push([l, h]);
    for (const [l, h] of heads) {
      const w = this.row(this.cur, l, h);
      for (let t = 0; t < n; t++) out[t] += mode === 'contrib' ? w[t] * this.vnorm(t, l, h) : w[t];
    }
    let s = 0; for (const x of out) s += x;
    for (let t = 0; t < n; t++) out[t] /= s || 1;
    return out;
  }

  // ‖W_o[:, голова h] · value токена t‖ — сколько голова h может забрать из токена t, если смотрит на него целиком
  vnorm(t, l, h) {
    if (this.vcacheFor !== this.steps) { this.vcache = new Map(); this.vcacheFor = this.steps; }
    const { layers: L, heads: H, kvHeads: KV, headDim: hd, dim: d } = this.info;
    let c = this.vcache.get(t);
    if (!c) {
      const G = H / KV, v = this.steps[t].vOut;
      c = new Float32Array(L * H);
      for (let ll = 0; ll < L; ll++) {
        const Wo = this.engine.weights(ll, 'o');
        for (let hh = 0; hh < H; hh++) {
          const vg = v.subarray((ll * KV + Math.floor(hh / G)) * hd, (ll * KV + Math.floor(hh / G) + 1) * hd);
          let s2 = 0;
          for (let i = 0; i < d; i++) { let y = 0; const row = i * H * hd + hh * hd; for (let j = 0; j < hd; j++) y += Wo[row + j] * vg[j]; s2 += y * y; }
          c[ll * H + hh] = Math.sqrt(s2);
        }
      }
      this.vcache.set(t, c);
    }
    return c[l * H + h];
  }

  geometry() {
    const W = this.cv.clientWidth, H = this.cv.clientHeight, L = this.info.layers, NH = this.info.heads, n = this.steps[this.cur].pos + 1;
    const padL = 74, padR = Math.min(190, Math.max(120, W * 0.3)), shelfY = 24, shelfH = 11, padT = shelfY + shelfH + (this.compact ? 8 : 20), padB = this.compact ? 4 : 8, gapL = this.compact ? 5 : 9;
    const rowH = Math.max(7, Math.min(22, (H - padT - padB - gapL * (L - 1)) / (L * NH)));
    const x0 = padL, sw = Math.max(40, W - padL - padR), cw = sw / n;
    const rowY = (l, h) => padT + l * (NH * rowH + gapL) + h * rowH;
    return { W, H, L, NH, n, padL, padR, padT, rowH, x0, sw, cw, rowY, shelfY, shelfH };
  }

  cellAt(e) {
    if (!this.info || !this.steps) return null;
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = this.geometry();
    if (y >= g.shelfY - 3 && y < g.shelfY + g.shelfH + 3 && x >= g.x0 && x < g.x0 + g.sw)        // полка KV-кэша
      return { shelf: true, layer: -1, head: -1, t: Math.min(g.n - 1, Math.floor((x - g.x0) / g.cw)), x, y };
    for (let l = 0; l < g.L; l++) for (let h = 0; h < g.NH; h++) {
      const ry = g.rowY(l, h);
      if (y >= ry && y < ry + g.rowH && x >= 52 && x < g.W - 4) {       // ровно та полоса, что подсвечивается: правее скобки слоя
        const t = x >= g.x0 && x < g.x0 + g.sw ? Math.min(g.n - 1, Math.floor((x - g.x0) / g.cw)) : -1;
        return { layer: l, head: h, t, x, y };
      }
    }
    return null;
  }

  click(e) {
    const c = this.cellAt(e);
    if (!c) {                                         // щелчок по пустому месту окна снимает выбор головы и записи кэша
      if (this.sel.layer < 0 && this.selTok < 0) return;
      this.sel = { layer: -1, head: -1 }; this.selTok = -1; this.draw(); if (this.onSelect) this.onSelect(this.sel); return;
    }
    if (c.shelf) this.selTok = this.selTok === c.t ? -1 : c.t;
    else this.sel = (c.layer === this.sel.layer && c.head === this.sel.head) ? { layer: -1, head: -1 } : { layer: c.layer, head: c.head };
    this.draw();
    if (this.onSelect) this.onSelect(this.sel);
  }

  // вес, который показывает столбик: «веса» — вес внимания; «с учётом value» — вес × сколько голова может забрать
  // из этого токена, в долях (сумма по строке 1), чтобы оба режима читались одинаково
  shown(l, h) {
    const w = this.row(this.cur, l, h), n = w.length;
    if ((this.mode || 'look') !== 'contrib') return w;
    const out = new Float32Array(n); let s = 0;
    for (let t = 0; t < n; t++) { out[t] = w[t] * this.vnorm(t, l, h); s += out[t]; }
    for (let t = 0; t < n; t++) out[t] /= s || 1;
    return out;
  }

  // вклад головы в счёт слова (то же разложение, что линия счёта в окне «Модель»): часть потока, которую голова
  // добавила через W_o, читается логит-линзой. Сумма четырёх голов слоя равна числу «вним. +x» в «Модели».
  headScore(l, h, tok) {
    const { layers: L, heads: H, headDim: hd, dim: d } = this.info, st = this.steps[this.cur], Wo = this.engine.weights(l, 'o'), v = new Float32Array(d);
    const ho = st.headOut.subarray((l * H + h) * hd, (l * H + h + 1) * hd);
    for (let i = 0; i < d; i++) { let y = 0; const row = i * H * hd + h * hd; for (let j = 0; j < hd; j++) y += Wo[row + j] * ho[j]; v[i] = y; }
    const rms = (a) => { let q = 0; for (const x of a) q += x * x; return Math.sqrt(q / a.length); }, rv = rms(v);
    return rv < 1e-9 ? 0 : this.engine.lens(v)[tok] * rv / rms(st.resid.subarray(L * d, (L + 1) * d));
  }

  tok(t) { const s = this.engine ? this.engine.tokenText[this.steps[t].input] : ''; return String(s).replace(/ /g, '·').replace(/\n/g, '⏎'); }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g2 = cv.getContext('2d');
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, W, H);
    if (!this.steps || !this.info) return;
    const g = this.geometry(), mono = css('--mono'), ui = css('--ui') || 'sans-serif', hov = this.hoverCell;
    const ink1 = css('--ink-1') || '#e8eaee', ink2 = css('--ink-2') || '#b3b9c2', ink3 = css('--ink-3') || '#7c838d';
    const rgb = (this.mode || 'look') === 'contrib' ? [169, 140, 240] : [242, 179, 61];
    g2.textBaseline = 'middle';
    // заголовок полосы: кто смотрит и на что
    g2.font = `11px ${ui}`; g2.fillStyle = ink3; g2.textAlign = 'left';
    g2.fillText(tx('a.axis.past', { n: g.n }), g.x0, 12);
    const nowTok = `«${this.tok(this.cur)}»`; g2.font = `11px ${mono}`; const nw = g2.measureText(nowTok).width;
    g2.textAlign = 'right'; g2.fillStyle = '#ffe08a'; g2.fillText(nowTok, g.x0 + g.sw, 12);
    g2.fillStyle = ink3; g2.font = `11px ${ui}`; g2.fillText(tx('a.axis.now'), g.x0 + g.sw - nw - 6, 12);
    g2.textAlign = 'left'; g2.fillText(tx('a.axis.top'), g.x0 + g.sw + 12, 12);
    // полка KV-кэша: по ячейке на прошлый токен (ключ и значение, посчитанные один раз). Промпт темнее ответа.
    const colH = g.rowY(g.L - 1, g.NH - 1) + g.rowH - g.padT + 4;
    g2.textAlign = 'right'; g2.fillStyle = ink3; g2.font = `10px ${ui}`; g2.fillText(tx('a.shelf'), g.x0 - 6, g.shelfY + g.shelfH / 2);
    for (let t = 0; t < g.n; t++) {
      const on = t === this.selTok, hv = hov && hov.shelf && hov.t === t;
      g2.fillStyle = on ? '#f2b33d' : hv ? 'rgba(255,255,255,0.55)' : this.steps[t].kind === 'prompt' ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.27)';
      g2.fillRect(g.x0 + t * g.cw, g.shelfY, Math.max(1, g.cw - (g.cw > 3 ? 1 : 0)), g.shelfH);
    }
    // легенда лиловых скобок: строкой под полкой кэша (справа от полки ей не хватало ширины)
    if (!this.compact) { const lx = g.x0, ly = g.shelfY + g.shelfH + 9; g2.strokeStyle = 'rgba(169,140,240,0.9)'; g2.beginPath();
      g2.moveTo(lx + 3, ly - 4); g2.lineTo(lx, ly - 4); g2.lineTo(lx, ly + 4); g2.lineTo(lx + 3, ly + 4); g2.stroke();
      g2.textAlign = 'left'; g2.font = `10px ${ui}`; g2.fillStyle = 'rgba(169,140,240,0.95)'; g2.fillText(tx('a.gqa'), lx + 8, ly); }
    if (this.selTok >= 0) { g2.fillStyle = 'rgba(242,179,61,0.13)'; g2.fillRect(g.x0 + this.selTok * g.cw, g.padT - 2, Math.max(1, g.cw), colH); }
    // столбец под курсором — один прошлый токен во всех головах
    if (hov && hov.t >= 0) { g2.fillStyle = 'rgba(255,255,255,0.07)'; g2.fillRect(g.x0 + hov.t * g.cw, g.padT - 2, Math.max(1, g.cw), g.rowY(g.L - 1, g.NH - 1) + g.rowH - g.padT + 4); }
    for (let l = 0; l < g.L; l++) {
      // скобка слоя, как в линии счёта «Модели»
      const y1 = g.rowY(l, 0) + 1, y2 = g.rowY(l, g.NH - 1) + g.rowH - 1, linked = this.link && this.link.layer === l;
      if (linked) { g2.fillStyle = 'rgba(242,179,61,0.07)'; g2.fillRect(44, y1 - 2, g.W - 48, y2 - y1 + 4); }      // слой под курсором в «Модели»
      g2.strokeStyle = linked ? '#f2b33d' : 'rgba(255,255,255,0.28)'; g2.lineWidth = 1; g2.beginPath();
      g2.moveTo(50, y1); g2.lineTo(46, y1); g2.lineTo(46, y2); g2.lineTo(50, y2); g2.stroke();
      g2.save(); g2.translate(36, (y1 + y2) / 2); g2.rotate(-Math.PI / 2); g2.font = `600 11px ${ui}`; g2.fillStyle = linked ? '#ffe08a' : ink2; g2.textAlign = 'center';
      g2.fillText(tx('a.layer', { n: l + 1 }), 0, 0); g2.restore();
      // GQA: головы группы читают одни и те же ключи и значения
      const G = g.NH / this.info.kvHeads;
      if (G > 1) for (let k = 0; k < this.info.kvHeads; k++) { const a = g.rowY(l, k * G) + 3, b = g.rowY(l, k * G + G - 1) + g.rowH - 3;
        g2.strokeStyle = 'rgba(169,140,240,0.55)'; g2.beginPath(); g2.moveTo(58, a); g2.lineTo(55, a); g2.lineTo(55, b); g2.lineTo(58, b); g2.stroke(); }
      for (let h = 0; h < g.NH; h++) {
        const y = g.rowY(l, h), w = this.shown(l, h), sel = this.sel.layer === l && this.sel.head === h, hot = (hov && hov.layer === l && hov.head === h) || (linked && this.link.head === h);
        const dim = this.sel.layer >= 0 && !sel;
        if (sel || hot) { g2.fillStyle = sel ? 'rgba(242,179,61,0.10)' : 'rgba(255,255,255,0.05)'; g2.fillRect(52, y, g.W - 56, g.rowH); }
        g2.font = `10px ${mono}`; g2.textAlign = 'right'; g2.fillStyle = sel ? '#ffe08a' : ink3;
        g2.fillText(String(h + 1), g.x0 - 6, y + g.rowH / 2);
        // дорожка и столбики: высота ∝ √веса (иначе слабые не видны), яркость ∝ весу
        g2.fillStyle = 'rgba(255,255,255,0.05)'; g2.fillRect(g.x0, y + g.rowH - 2, g.sw, 1);
        const bh = g.rowH - 3, bw = Math.max(1, g.cw - (g.cw > 3 ? 1 : 0));
        for (let t = 0; t < g.n; t++) {
          const v = w[t]; if (v < 0.004) continue;
          const hh = Math.max(1, Math.sqrt(v) * bh);
          g2.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(dim ? 0.35 : 1) * (0.3 + 0.7 * Math.min(1, v * 2.5))})`;
          g2.fillRect(g.x0 + t * g.cw, y + g.rowH - 2 - hh, bw, hh);
        }
        // сильнейшие слова справа
        const top = Array.from(w, (v, t) => [v, t]).sort((a, b) => b[0] - a[0]).slice(0, 2).filter((x) => x[0] >= 0.05);
        let x = g.x0 + g.sw + 12; g2.textAlign = 'left'; g2.font = `10px ${mono}`;
        for (const [v, t] of top) {
          const word = this.tok(t), pct = ` ${Math.round(v * 100)}%`;
          if (x + g2.measureText(word + pct).width > g.W - 4) break;
          g2.fillStyle = dim ? ink3 : ink1; g2.fillText(word, x, y + g.rowH / 2); x += g2.measureText(word).width;
          g2.fillStyle = ink3; g2.fillText(pct, x, y + g.rowH / 2); x += g2.measureText(pct).width + 10;
        }
      }
    }
    this.updateCard();
    // подсказка: какой это прошлый токен и сколько на него смотрит голова под курсором
    if (hov && hov.shelf) {
      const text = `${tx('a.shelf.tip', { n: hov.t + 1 })} «${this.tok(hov.t)}»`;
      g2.font = `11px ${mono}`; const tw = g2.measureText(text).width + 14, tx0 = Math.max(4, Math.min(g.W - tw - 4, hov.x + 10)), ty = g.shelfY + g.shelfH + 4;
      g2.fillStyle = 'rgba(17,19,23,0.95)'; g2.strokeStyle = 'rgba(255,255,255,0.22)'; g2.beginPath(); g2.roundRect(tx0, ty, tw, 20, 5); g2.fill(); g2.stroke();
      g2.fillStyle = '#ffe08a'; g2.textAlign = 'left'; g2.fillText(text, tx0 + 7, ty + 10.5);
    } else if (hov && hov.t >= 0) {
      const v = this.shown(hov.layer, hov.head)[hov.t];
      const text = `«${this.tok(hov.t)}» · ${tx('a.tip', { head: hov.head + 1, layer: hov.layer + 1 })} ${v < 0.005 ? '<1' : Math.round(v * 100)}%`;
      g2.font = `11px ${mono}`; const tw = g2.measureText(text).width + 14, tx0 = Math.max(4, Math.min(g.W - tw - 4, hov.x + 10)), ty = Math.max(4, hov.y - 26);
      g2.fillStyle = 'rgba(17,19,23,0.95)'; g2.strokeStyle = 'rgba(255,255,255,0.22)'; g2.beginPath(); g2.roundRect(tx0, ty, tw, 20, 5); g2.fill(); g2.stroke();
      g2.fillStyle = '#ffe08a'; g2.textAlign = 'left'; g2.fillText(text, tx0 + 7, ty + 10.5);
    }
  }

  // карточка: запись кэша (под курсором на полке или выбранная) важнее головы (под курсором или выбранной)
  updateCard() {
    const hov = this.hoverCell, esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const tokT = hov && hov.shelf ? hov.t : this.selTok, head = hov && !hov.shelf ? hov : this.link && this.link.head >= 0 ? this.link : this.sel.layer >= 0 ? this.sel : null;
    const opId = this.opHov || (!hov && this.opSel) || '', showing = (this.mode || 'look') === 'contrib' ? 'mix' : 'attn';
    const sk = opId + '|' + showing;
    if (sk !== this.stepsKey) { this.stepsKey = sk; this.stepsEl.classList.toggle('v-contrib', showing === 'mix'); for (const a of this.stepsEl.querySelectorAll('a[data-op]')) { a.classList.toggle('on', a.dataset.op === opId); a.classList.toggle('hot', a.dataset.op === showing); } }
    const key = opId ? `o${opId}:${this.opSel}:${this.docs.size}` : tokT >= 0 ? `t${tokT}:${this.selTok}` : head ? `h${head.layer}.${head.head}:${this.sel.layer}.${this.sel.head}` : '';
    const scoreTok = this.steps && this.tokFn ? this.tokFn() : -1;
    const full = key + '|' + this.cur + '|' + (this.mode || 'look') + '|' + scoreTok;
    if (full === this.cardKey) return; this.cardKey = full;
    this.card.hidden = !key; if (!key) return;
    if (opId) {                                       // шаг внутри головы
      const [, slug, k] = this.ops[opId], I = this.info, lang = document.documentElement.lang || 'en';
      const link = this.docs.has(slug) ? `<a class="gloss-more" target="_blank" rel="noopener" href="/${lang === 'en' ? '' : lang + '/'}docs/glossary/${slug}/">${esc(tx('gl.more'))}</a>` : '';
      this.card.innerHTML = `<b>${esc(tx(k + '.h'))}</b><p>${esc(tx(k + '.t', { d: I.dim, n: I.inter, h: I.heads, kv: I.kvHeads, v: I.vocab }))}` +
        (opId === showing ? ' ' + esc(tx('a.op.shown')) : '') + '</p>' + (this.opSel === opId ? link : `<p class="attn-card-hint">${esc(tx('m.op.pin'))}</p>`);
      return;
    }
    const { layers: L, heads: H, kvHeads: KV } = this.info, pct = (v) => (v < 0.005 ? '<1' : Math.round(v * 100)) + '%';
    if (tokT >= 0) {
      const who = []; for (let l = 0; l < L; l++) for (let h = 0; h < H; h++) who.push([this.shown(l, h)[tokT], l, h]);
      who.sort((a, b) => b[0] - a[0]); const top = who.filter((x) => x[0] >= 0.01).slice(0, 3);
      this.card.innerHTML = `<b>${esc(tx('a.card.tok.h', { n: tokT + 1 }))} <i>«${esc(this.tok(tokT))}»</i></b>` +
        `<p>${esc(tx('a.card.tok.t', { kv: KV }))}</p>` +
        `<p class="attn-card-list">${top.length ? esc(tx('a.card.tok.who')) + ' ' + top.map(([v, l, h]) => `<span>${esc(tx('a.card.lh', { layer: l + 1, head: h + 1 }))} <i>${pct(v)}</i></span>`).join('') : esc(tx('a.card.tok.none'))}</p>`;
      return;
    }
    const w = this.shown(head.layer, head.head), G = H / KV, g0 = Math.floor(head.head / G) * G;
    const mates = []; for (let h = g0; h < g0 + G; h++) if (h !== head.head) mates.push(h + 1);
    const top = Array.from(w, (v, t) => [v, t]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter((x) => x[0] >= 0.01);
    const selected = this.sel.layer === head.layer && this.sel.head === head.head;
    this.card.innerHTML = `<b>${esc(tx('a.card.head.h', { layer: head.layer + 1, head: head.head + 1 }))}</b>` +
      (mates.length ? `<p>${esc(tx('a.card.head.gqa', { mate: mates.join(', ') }))}</p>` : '') +
      `<p class="attn-card-list">${esc(tx('a.card.head.look'))} ${top.map(([v, t]) => `<span><i>«${esc(this.tok(t))}»</i> ${pct(v)}</span>`).join('')}</p>` +
      this.scoreLine(head, scoreTok, esc) +
      `<p class="attn-card-hint">${esc(tx(selected ? 'a.card.head.back' : 'a.card.head.hint'))}</p>`;
  }

  scoreLine(head, tok, esc) {
    if (tok == null || tok < 0 || !this.engine || !this.steps[this.cur].headOut) return '';
    const sg = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2); let sum = 0, mine = 0;
    for (let h = 0; h < this.info.heads; h++) { const c = this.headScore(head.layer, h, tok); sum += c; if (h === head.head) mine = c; }
    const word = String(this.engine.tokenText[tok]).replace(/ /g, '·').replace(/\n/g, '⏎');
    return `<p>${esc(tx('a.card.head.score'))} <i>«${esc(word)}»</i>: <i>${sg(mine)}</i> ${esc(tx('a.card.head.of', { sum: sg(sum), layer: head.layer + 1 }))}</p>`;
  }
}
