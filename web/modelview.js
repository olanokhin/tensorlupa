import { t as tx } from './i18n.js';
// Схема модели (2D, до 3D-вида): путь текущего токена сверху вниз. Каждый вектор — полоса клеток (сиреневый < 0 < жёлтый,
// нормировка по самому вектору), справа — logit lens: что модель предсказала бы, если остановиться здесь.

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function softTop(logits, k = 3) {
  let mx = -Infinity;
  for (const v of logits) if (v > mx) mx = v;
  let s = 0;
  const p = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) { p[i] = Math.exp(logits[i] - mx); s += p[i]; }
  const idx = Array.from(p.keys()).sort((a, b) => p[b] - p[a]).slice(0, k);
  return idx.map((i) => ({ tok: i, p: p[i] / s }));
}

const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));

export class ModelView {
  constructor(canvas, engine) {
    this.cv = canvas; this.e = engine; this.step = null;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('mousemove', (e) => this.hover(e));
    canvas.addEventListener('mouseleave', () => { this.hov = null; this.draw(); });
  }

  set(step) {
    this.step = step;
    if (step) {
      const { layers: L, dim: d } = this.e.info;
      this.lens = [];
      for (let l = 0; l <= L; l++) this.lens.push(softTop(this.e.lens(step.resid.subarray(l * d, (l + 1) * d))));
    }
    this.draw();
  }

  rows() {
    const { layers: L, dim: d, inter: I } = this.e.info, s = this.step, out = [];
    out.push({ name: tx('s.embedding'), sub: `«${show(this.e.tokenText[s.input])}»`, v: s.resid.subarray(0, d), lens: 0, kind: 'resid' });
    for (let l = 0; l < L; l++) {
      out.push({ name: tx('s.attn', { n: l + 1 }), v: s.attnOut.subarray(l * d, (l + 1) * d), kind: 'attn', layer: l });
      out.push({ name: tx('s.mlp', { n: l + 1 }), sub: `${I}`, v: s.mlpAct.subarray(l * I, (l + 1) * I), kind: 'mlp', layer: l, wide: true });
      out.push({ name: tx('s.mlpOut', { n: l + 1 }), v: s.mlpOut.subarray(l * d, (l + 1) * d), kind: 'mlpout', layer: l });
      out.push({ name: tx('s.res', { n: l + 1 }), v: s.resid.subarray((l + 1) * d, (l + 2) * d), lens: l + 1, kind: 'resid' });
    }
    return out;
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!this.step) return;
    const rows = this.rows(), mono = css('--mono');
    const labW = 150, lensW = 200, cellsW = W - labW - lensW - 24, x0 = labW + 8;
    const rowH = Math.min(30, (H - 16) / rows.length), cellH = Math.max(6, rowH - 10);
    this.layout = [];
    rows.forEach((r, i) => {
      const y = 8 + i * rowH, cy = y + (rowH - cellH) / 2;
      if (r.kind === 'resid' && i > 0) { g.strokeStyle = '#2a2f36'; g.beginPath(); g.moveTo(8, y - 1); g.lineTo(W - 8, y - 1); g.stroke(); }
      g.font = '11px ' + css('--sans'); g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillStyle = r.kind === 'resid' ? css('--text') : css('--muted');
      g.fillText(r.name, 10, y + rowH / 2);
      // клетки
      const n = r.v.length, cw = cellsW / n;
      let mx = 1e-9;
      for (const x of r.v) mx = Math.max(mx, Math.abs(x));
      for (let j = 0; j < n; j++) {
        const t = r.v[j] / mx, a = Math.min(1, Math.abs(t)) ** 0.7;
        g.fillStyle = t >= 0 ? `rgba(242,179,61,${a})` : `rgba(169,140,240,${a})`;
        g.fillRect(x0 + j * cw, cy, Math.max(0.6, cw - (cw > 3 ? 0.6 : 0)), cellH);
      }
      g.strokeStyle = '#31363e'; g.strokeRect(x0 - 0.5, cy - 0.5, cellsW + 1, cellH + 1);
      // норма и logit lens
      g.font = '11px ' + mono; g.fillStyle = css('--dim'); g.textAlign = 'left';
      const lx = x0 + cellsW + 10;
      if (r.lens !== undefined) {
        const top = this.lens[r.lens];
        let x = lx;
        top.forEach((c, k) => {
          const txt = `${show(this.e.tokenText[c.tok])} ${(100 * c.p).toFixed(0)}%`;
          g.fillStyle = k === 0 ? (c.tok === this.step.output ? css('--chosen') : css('--text')) : css('--dim');
          g.fillText(txt, x, y + rowH / 2);
          x += g.measureText(txt).width + 10;
        });
      } else {
        g.fillText(`‖·‖ ${norm(r.v).toFixed(1)}`, lx, y + rowH / 2);
      }
      this.layout.push({ y: cy, h: cellH, x0, cw, r });
    });
    // заголовок колонки lens
    g.font = '10px ' + css('--sans'); g.fillStyle = css('--dim'); g.textAlign = 'left';
    if (this.hov) {
      const { r, j } = this.hov, txt = `${r.name} · #${j}: ${r.v[j].toFixed(3)}`;
      g.font = '11px ' + mono; const w = g.measureText(txt).width + 12;
      g.fillStyle = '#0f1114ee'; g.fillRect(Math.min(W - w - 4, this.hov.mx + 10), this.hov.my + 10, w, 20);
      g.fillStyle = css('--text'); g.fillText(txt, Math.min(W - w - 4, this.hov.mx + 10) + 6, this.hov.my + 20);
    }
  }

  hover(e) {
    if (!this.layout) return;
    const rc = this.cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
    const it = this.layout.find((l) => my >= l.y && my < l.y + l.h && mx >= l.x0 && mx < l.x0 + l.cw * l.r.v.length);
    this.hov = it ? { r: it.r, j: Math.floor((mx - it.x0) / it.cw), mx, my } : null;
    this.draw();
  }
}

function show(t) { return t === undefined ? '' : t.replace(/\n/g, '↵').replace(/ /g, '·'); }
