import { t as tx } from './i18n.js';
// Карты внимания: 3 слоя × 4 головы. Строка = позиция токена-запроса (шаг), столбец = позиция, на которую он смотрит.
// Показаны все шаги до текущего; текущая строка обведена. Щелчок по голове выбирает её для подсветки истории.

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export class AttentionView {
  constructor(canvas, onSelect) {
    this.cv = canvas; this.onSelect = onSelect;
    this.sel = { layer: -1, head: -1 };           // -1 — среднее по всем головам последнего слоя не выбрано
    this.steps = null; this.cur = 0;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('mousemove', (e) => { this.hoverCell = this.cellAt(e); this.draw(); });
    canvas.addEventListener('mouseleave', () => { this.hoverCell = null; this.draw(); });
  }

  set(steps, cur, info) { this.steps = steps; this.cur = cur; this.info = info; this.draw(); }

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
    const W = this.cv.clientWidth, H = this.cv.clientHeight, L = this.info.layers, NH = this.info.heads;
    const padL = 52, padT = 18, gap = 10, labelH = 14;
    const cw = (W - padL - gap * (NH - 1) - 8) / NH, ch = (H - padT - gap * (L - 1) - 8) / L;
    const side = Math.max(20, Math.min(cw, ch - labelH));
    return { W, H, L, NH, padL, padT, gap, labelH, side, cw, ch };
  }

  cellAt(e) {
    if (!this.info) return null;
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = this.geometry();
    for (let l = 0; l < g.L; l++) for (let h = 0; h < g.NH; h++) {
      const cx = g.padL + h * (g.cw + g.gap), cy = g.padT + l * (g.ch + g.gap) + g.labelH;
      if (x >= cx && x < cx + g.side && y >= cy && y < cy + g.side) return { layer: l, head: h };
    }
    return null;
  }

  click(e) {
    const c = this.cellAt(e);
    if (!c) return;
    this.sel = (c.layer === this.sel.layer && c.head === this.sel.head) ? { layer: -1, head: -1 } : c;
    this.draw();
    if (this.onSelect) this.onSelect(this.sel);
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g2 = cv.getContext('2d');
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, W, H);
    if (!this.steps || !this.info) return;
    const g = this.geometry(), n = this.cur + 1;
    const acc = css('--accent'), mono = css('--mono');
    g2.font = '10px ' + mono; g2.textBaseline = 'middle';
    for (let l = 0; l < g.L; l++) {
      g2.fillStyle = css('--muted'); g2.textAlign = 'right';
      g2.fillText(tx('a.layer', { n: l + 1 }), g.padL - 6, g.padT + l * (g.ch + g.gap) + g.labelH + g.side / 2);
      for (let h = 0; h < g.NH; h++) {
        const cx = g.padL + h * (g.cw + g.gap), cy = g.padT + l * (g.ch + g.gap) + g.labelH;
        if (l === 0) {
          g2.fillStyle = css('--muted'); g2.textAlign = 'left';
          g2.fillText(tx('a.head', { n: h + 1 }) + (this.info.kvHeads < this.info.heads ? ` · kv ${Math.floor(h / (this.info.heads / this.info.kvHeads)) + 1}` : ''), cx, g.padT + 4);
        }
        // карта: n×n пикселей, затем масштаб
        const img = new ImageData(n, n), d = img.data;
        for (let s = 0; s < n; s++) {
          const w = this.row(s, l, h);
          for (let t = 0; t <= s; t++) {
            const v = Math.sqrt(w[t]), o = (s * n + t) * 4;
            d[o] = 30 + 225 * v; d[o + 1] = 32 + 135 * v; d[o + 2] = 38 + 40 * v; d[o + 3] = 255;
          }
          for (let t = s + 1; t < n; t++) { const o = (s * n + t) * 4; d[o] = 22; d[o + 1] = 24; d[o + 2] = 28; d[o + 3] = 255; }
        }
        const tmp = document.createElement('canvas'); tmp.width = n; tmp.height = n;
        tmp.getContext('2d').putImageData(img, 0, 0);
        g2.imageSmoothingEnabled = n > g.side;
        g2.drawImage(tmp, cx, cy, g.side, g.side);
        // текущая строка
        const ry = cy + (this.cur / n) * g.side, rh = Math.max(1.5, g.side / n);
        g2.strokeStyle = '#ffe08acc'; g2.lineWidth = 1; g2.strokeRect(cx + 0.5, ry, g.side - 1, rh);
        const sel = this.sel.layer === l && this.sel.head === h, hov = this.hoverCell && this.hoverCell.layer === l && this.hoverCell.head === h;
        g2.strokeStyle = sel ? acc : hov ? '#8a919c' : '#31363e'; g2.lineWidth = sel ? 2 : 1;
        g2.strokeRect(cx - 0.5, cy - 0.5, g.side + 1, g.side + 1);
      }
    }
  }
}
