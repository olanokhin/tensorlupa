// TensorLupa — Copyright 2026 Alex Anokhin — Apache License 2.0 (LICENSE, NOTICE)
// Вкладка Model на телефоне: модель одной строкой слева направо, без 3D. Сверху — что вошло и что модель написала;
// под ними конвейер: эмбеддинг и три слоя, в каждом слое attention и MLP. Блок нарисован ступенькой: откуда и докуда
// он сдвинул счёт написанного слова (янтарный — вверх, лиловый — вниз), так что строка показывает сразу и устройство
// модели, и то, какой блок решил дело. Под ступеньками — счёт после каждого блока. Числа те же, что в цепочке счёта
// над 3D-моделью на большом экране (contrib.js). Нажатие на блок раскрывает под строкой его шаги (RMSNorm, GQA,
// QK-norm, RoPE…), у attention — вклад каждой головы, и ссылку в Docs.
// Счёт других кандидатов здесь не показывается: на телефоне вторая строка чисел только шумит.
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
  // cb.head({layer, head} | null) — выбрана голова; cb.doc(href) — открыть статью
  constructor(host, engine, cb = {}) {
    this.host = host; this.e = engine; this.cb = cb; this.ops = OPS(); this.open = null; this.op = null; this.head = null; this.docs = new Set();
    host.classList.add('mp');
    fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.glossary) { this.docs = new Set(j.glossary); this.draw(); } }).catch(() => {});
    host.addEventListener('click', (e) => {
      const a = e.target.closest('a.gloss-more');
      if (a) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); this.cb.doc?.(a.getAttribute('href')); return; }
      const op = e.target.closest('[data-op]'); if (op) { this.op = op.dataset.op; this.draw(); return; }
      const hd = e.target.closest('[data-head]'); if (hd) { const [l, h] = hd.dataset.head.split(':').map(Number);
        this.head = this.head && this.head.layer === l && this.head.head === h ? null : { layer: l, head: h }; this.cb.head?.(this.head); this.draw(); return; }
      const col = e.target.closest('[data-key]'); if (col) { this.open = this.open === col.dataset.key ? null : col.dataset.key; this.op = null; this.draw(); this.host.querySelector('.mm-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }   // на невысоком экране подробности ниже края окна
    });
  }
  set(step) { this.step = step; this.draw(); }

  draw() {
    const st = this.step; if (!st) return;
    const I = this.e.info, tt = this.e.tokenText, tok = st.output, c = scoreChain(this.e, st, tok);
    // блоки по порядку: эмбеддинг, затем attention и MLP каждого слоя. from/to — счёт слова до и после блока
    const cols = [{ key: 'embed', kind: 'embed', layer: -1, from: 0, to: c[0].value, name: tx('mob.emb') }];
    for (let l = 0; l < I.layers; l++) { const i = 1 + 4 * l;
      cols.push({ key: 'attn:' + l, kind: 'attn', layer: l, from: c[i - 1].value, to: c[i + 1].value, name: tx('m.score.attn') });
      cols.push({ key: 'mlp:' + l, kind: 'mlp', layer: l, from: c[i + 1].value, to: c[i + 3].value, name: 'MLP' }); }
    let lo = 0, hi = 0; for (const x of cols) { lo = Math.min(lo, x.to); hi = Math.max(hi, x.to); }
    const span = Math.max(1e-6, hi - lo), y = (v) => 100 * (hi - v) / span;       // % от верха поля ступенек
    const col = (x) => { const up = z(x.to - x.from) >= 0, top = y(Math.max(x.from, x.to)), h = 100 * Math.abs(x.to - x.from) / span;
      return `<div class="mp-col${this.open === x.key ? ' on' : ''}" data-key="${x.key}" role="button" tabindex="0">` +
        `<span class="mp-plot"><i class="mp-zero" style="top:${y(0).toFixed(2)}%"></i>` +
        `<i class="mp-bar ${up ? 'pos' : 'neg'}" style="top:${top.toFixed(2)}%;height:max(3px,${h.toFixed(2)}%)"></i>` +
        `<b class="mp-d ${up ? 'pos' : 'neg'}" style="${up ? `bottom:${(100 - top).toFixed(2)}%` : `top:${(top + h).toFixed(2)}%`}">${x.kind === 'embed' ? fmt(x.to) : sign(x.to - x.from)}</b></span>` +
        `<span class="mp-name">${esc(x.name)}</span><span class="mp-run">${fmt(x.to)}</span></div>`; };   // div, а не button: общие стили кнопок задают им высоту
    const group = (l) => `<div class="mp-layer"><small>${esc(tx('m.layer', { n: l + 1 }))}</small><div class="mp-pair">${cols.filter((x) => x.layer === l).map(col).join('')}</div></div>`;
    const top = st.topk.slice().sort((a, b) => b.p - a.p), win = top.find((x) => x.tok === tok) || { p: 0 };
    const pc = (p) => (p > 0 && p < 0.005 ? '<1' : (100 * p).toFixed(0)) + '%', pill = (t) => `<span class="tokpill">${esc(show(tt[t]))}</span>`;
    let h = `<div class="mp-io"><span class="mp-in"><small>${esc(tx('mob.in'))}</small>${pill(st.input)}</span><i class="mp-arrow"></i>` +
      `<span class="mp-out${this.open === 'out' ? ' on' : ''}" data-key="out" role="button" tabindex="0"><small>${esc(tx(st.kind === 'prompt' ? 'mob.outPrompt' : st.forced >= 0 ? 'mob.outForced' : 'mob.out'))}</small><span class="tokpill won">${esc(show(tt[tok]))}</span><em>${pc(win.p)}</em></span></div>` +
      `<div class="mp-pipe"><div class="mp-layer mp-emb"><small>&nbsp;</small><div class="mp-pair">${col(cols[0])}</div></div>${Array.from({ length: I.layers }, (_, l) => group(l)).join('')}</div>` +
      `<div class="mp-cap">${esc(tx('mob.scoreOf'))} ${pill(tok)}</div>`;
    // подробности выбранного блока
    // выход — тоже блок конвейера: последняя норма и сравнение потока со словарём
    const cur = this.open === 'out' ? { key: 'out', kind: 'out' } : cols.find((x) => x.key === this.open);
    if (!cur) h += `<p class="mp-hint">${esc(tx('mob.model.hint'))}</p>`;
    else {
      const ids = STEPS[cur.kind], op = ids.includes(this.op) ? this.op : ids[0], slug = this.ops[op][1], pre = window.MQ_PREFIX ? '/' + window.MQ_PREFIX : '/';
      const title = cur.kind === 'embed' ? tx('m.op.embed.h') : cur.kind === 'out' ? tx('m.op.final.h') : `${cur.kind === 'attn' ? 'attention' : 'MLP'} · ${tx('m.layer', { n: cur.layer + 1 })}`;
      h += `<div class="mm-detail"><div class="mp-dt">${esc(title)}</div>` +
        (cur.kind === 'attn' ? `<div class="mm-heads">${Array.from({ length: I.heads }, (_, k) => { const v = headPart(this.e, st, cur.layer, k, tok);
          return `<button data-head="${cur.layer}:${k}" class="${this.head && this.head.layer === cur.layer && this.head.head === k ? 'on' : ''}"><small>${esc(tx('m.head'))} ${k + 1}</small><b class="${z(v) >= 0 ? 'pos' : 'neg'}">${sign(v)}</b></button>`; }).join('')}</div>` : '') +
        (ids.length > 1 ? `<div class="mm-ops">${ids.map((id) => `<button data-op="${id}" class="${id === op ? 'on' : ''}">${esc(this.ops[id][0])}</button>`).join('<i>→</i>')}</div>` : '') +
        (ids.length > 1 ? `<b>${esc(tx('m.op.' + op + '.h'))}</b>` : '') + `<p>${esc(tx('m.op.' + op + '.t', { d: I.dim, n: I.inter, h: I.heads, kv: I.kvHeads, v: I.vocab }))}</p>` +
        (this.docs.has(slug) ? `<a class="gloss-more" href="${pre}docs/glossary/${slug}/" target="_blank" rel="noopener">${esc(tx('gl.more'))}</a>` : '') + '</div>';
    }
    this.host.innerHTML = h;
  }
}
