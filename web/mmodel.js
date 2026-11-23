// TensorLupa — Copyright 2026 Alex Anokhin — Apache License 2.0 (LICENSE, NOTICE)
// Вкладка Model на телефоне: остаточный поток сверху вниз, без 3D. Те же числа, что в цепочке счёта над 3D-моделью
// на большом экране (contrib.js): счёт слова после эмбеддинга, затем у каждого блока его вклад и счёт после него.
// Строка блока раскрывается: шаги внутри блока (RMSNorm, GQA, QK-norm, RoPE…), пояснение и ссылка в Docs.
// Внизу — что модель написала и между чем выбирала; нажатие на кандидата показывает его счёт вторым числом.
import { t as tx } from './i18n.js';
import { scoreChain, headPart } from './contrib.js';

const show = (s) => (s === undefined ? '' : String(s).replace(/\n/g, '↵').replace(/ /g, '·'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ноль без знака минус: «−0.0» читается как ошибка
const z = (x) => (Math.abs(x) < 0.05 ? 0 : x), fmt = (x) => (z(x) < 0 ? '−' : '') + Math.abs(x).toFixed(1), sign = (x) => (z(x) >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
// id шага → [подпись, статья Docs]; какие шаги в каком блоке — как в 3D-окне (view3d.js, buildFormula)
const OPS = () => ({ embed: [tx('m.op.embed'), 'residual-stream'], norm: ['RMSNorm', 'rmsnorm'], gqa: ['Q, K, V · GQA', 'grouped-query-attention'], qk: ['QK-norm', 'qk-norm'],
  rope: ['RoPE', 'rope'], attn: [tx('m.op.attn'), 'attention'], add: [tx('m.op.add'), 'residual-stream'], swiglu: ['SwiGLU', 'swiglu'], final: [tx('m.op.final'), 'logits'] });
const STEPS = { embed: ['embed'], attn: ['norm', 'gqa', 'qk', 'rope', 'attn', 'add'], mlp: ['norm', 'swiglu', 'add'], out: ['final'] };

export class MModel {
  // cb.track(tok | null) — следить за кандидатом; cb.head(layer, head) — выбрана голова; cb.doc(href) — открыть статью
  constructor(host, engine, cb = {}) {
    this.host = host; this.e = engine; this.cb = cb; this.ops = OPS(); this.open = null; this.op = null; this.head = null; this.docs = new Set();
    host.classList.add('mm');
    fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.glossary) { this.docs = new Set(j.glossary); this.draw(); } }).catch(() => {});
    host.addEventListener('click', (e) => {
      const a = e.target.closest('a.gloss-more');
      if (a) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); this.cb.doc?.(a.getAttribute('href')); return; }
      const op = e.target.closest('[data-op]'); if (op) { this.op = op.dataset.op; this.draw(); return; }
      const hd = e.target.closest('[data-head]'); if (hd) { const [l, h] = hd.dataset.head.split(':').map(Number);
        this.head = this.head && this.head.layer === l && this.head.head === h ? null : { layer: l, head: h }; this.cb.head?.(this.head); this.draw(); return; }
      const tk = e.target.closest('[data-tok]'); if (tk) { const v = Number(tk.dataset.tok); this.cb.track?.(v === this.step.output ? null : v); return; }
      const row = e.target.closest('[data-key]'); if (row) { this.open = this.open === row.dataset.key ? null : row.dataset.key; this.op = null; this.draw(); }
    });
  }
  set(step, track = null) { this.step = step; this.track = track; this.draw(); }

  draw() {
    const st = this.step; if (!st) return;
    const I = this.e.info, tt = this.e.tokenText, tok = st.output, alt = this.track, q = (x) => `«${esc(show(tt[x]))}»`;
    const a = scoreChain(this.e, st, tok), b = alt == null ? null : scoreChain(this.e, st, alt);
    const num = (i, delta) => { const f = delta ? sign : fmt, cls = (v) => (delta ? (z(v) >= 0 ? ' pos' : ' neg') : '');
      return `<span class="mm-n${cls(a[i].value)}">${f(a[i].value)}${b ? `<i class="${cls(b[i].value).trim()}">${f(b[i].value)}</i>` : ''}</span>`; };
    const detail = (key, kind) => {
      if (this.open !== key) return '';
      const ids = STEPS[kind], cur = ids.includes(this.op) ? this.op : ids[0], slug = this.ops[cur][1], pre = window.MQ_PREFIX ? '/' + window.MQ_PREFIX : '/';
      const text = tx('m.op.' + cur + '.t', { d: I.dim, n: I.inter, h: I.heads, kv: I.kvHeads, v: I.vocab });
      return `<div class="mm-detail">` + (ids.length > 1 ? `<div class="mm-ops">${ids.map((id) => `<button data-op="${id}" class="${id === cur ? 'on' : ''}">${esc(this.ops[id][0])}</button>`).join('<i>→</i>')}</div>` : '') +
        `<b>${esc(tx('m.op.' + cur + '.h'))}</b><p>${esc(text)}</p>` +
        (this.docs.has(slug) ? `<a class="gloss-more" href="${pre}docs/glossary/${slug}/" target="_blank" rel="noopener">${esc(tx('gl.more'))}</a>` : '') + '</div>';
    };
    const row = (key, kind, name, iDelta, iRun) => `<button class="mm-row${this.open === key ? ' on' : ''}" data-key="${key}"><span class="mm-name">${esc(name)}</span>` +
      (iDelta == null ? '<span class="mm-n"></span>' : num(iDelta, true)) + num(iRun, false) + '</button>';
    let h = `<div class="mm-head"><span>${esc(tx('m.score.what'))}</span><b>${q(tok)}</b>${alt == null ? '' : `<b class="alt">${q(alt)}</b>`}</div>` +
      `<div class="mm-io"><small>${esc(tx('m.io.in'))}</small><span class="tokpill">${esc(show(tt[st.input]))}</span></div>` +
      row('embed', 'embed', tx('m.embedding'), null, 0) + detail('embed', 'embed');
    for (let l = 0; l < I.layers; l++) {
      const i = 1 + 4 * l;
      h += `<div class="mm-layer">${esc(tx('m.layer', { n: l + 1 }))}</div>` + row('attn:' + l, 'attn', 'attention', i, i + 1) +
        `<div class="mm-heads">${Array.from({ length: I.heads }, (_, k) => { const v = headPart(this.e, st, l, k, alt == null ? tok : alt);
          return `<button data-head="${l}:${k}" class="${this.head && this.head.layer === l && this.head.head === k ? 'on' : ''}"><small>${esc(tx('m.head'))} ${k + 1}</small><b class="${z(v) >= 0 ? 'pos' : 'neg'}">${sign(v)}</b></button>`; }).join('')}</div>` +
        detail('attn:' + l, 'attn') + row('mlp:' + l, 'mlp', 'MLP', i + 2, i + 3) + detail('mlp:' + l, 'mlp');
    }
    // выход: написанное слово и те, между которыми модель выбирала
    const top = st.topk.slice().sort((x, y) => y.p - x.p), win = top.find((c) => c.tok === tok) || { tok, p: 0 }, rest = top.filter((c) => c.tok !== tok && c.p > 0).slice(0, 4);
    const pc = (p) => (p > 0 && p < 0.005 ? '<1' : (100 * p).toFixed(0)) + '%';
    const cand = (c, won) => `<button data-tok="${c.tok}" class="${(alt == null ? tok : alt) === c.tok ? 'on' : ''}${won ? ' won' : ''}"><em>${esc(show(tt[c.tok]))}</em><i>${pc(c.p)}</i></button>`;
    h += `<button class="mm-row mm-last${this.open === 'out' ? ' on' : ''}" data-key="out"><span class="mm-name">${esc(tx('m.op.final.h'))}</span><span class="mm-n"></span>${num(a.length - 1, false)}</button>` + detail('out', 'out') +
      `<div class="mm-out"><small>${esc(tx(st.forced >= 0 ? 'm.io.forced' : 'm.io.out'))}</small>${cand(win, true)}` +
      (rest.length ? `<small>${esc(tx('m.io.rest'))}</small>${rest.map((c) => cand(c, false)).join('')}<small class="mm-pick">${esc(tx(alt == null ? 'mob.pick' : 'mob.back'))}</small>` : '') + '</div>';
    this.host.innerHTML = h;
  }
}
