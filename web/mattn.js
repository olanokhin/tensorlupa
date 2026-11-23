// TensorLupa — Copyright 2026 Alex Anokhin — Apache License 2.0 (LICENSE, NOTICE)
// Вкладка Attention на телефоне: те же 12 полос, что в окне «Внимание» на большом экране (по одной на голову, слева
// направо все прошлые токены, высота и яркость столбика — вес attention текущего токена на этот прошлый), но под палец.
//   нажатие на полосу — выбрать голову: история красится её весами, под полосами карточка головы;
//   провести по полосе — над пальцем токен и его вес, тот же токен обведён в истории. Это обзор, а не точный выбор:
//     на 130 токенов и ширину телефона выходит меньше трёх пикселей на токен. Точно токен выбирается в списке
//     «на что смотрит» под полосами.
// Полка KV-кэша и скобки GQA здесь — одна строка-пояснение: пары голов с общими ключами и значениями стоят рядом.
import { t as tx } from './i18n.js';
import { headPart } from './contrib.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v) => (v < 0.005 ? '<1' : Math.round(v * 100)) + '%';

export class MAttn {
  // cb.head({layer, head} | null) — выбрана голова; cb.pos(t | -1) — выбран прошлый токен; cb.doc(href) — статья Docs
  constructor(host, engine, cb = {}) {
    this.host = host; this.e = engine; this.cb = cb; this.head = null; this.pos = -1; this.docs = new Set();
    const { layers: L, heads: H, kvHeads: KV } = engine.info, G = H / KV;
    host.classList.add('ma');
    let h = '<div class="ma-axis"><span class="ma-past"></span><span class="ma-now"></span></div><div class="ma-strips">';
    for (let l = 0; l < L; l++) {
      h += `<div class="ma-layer">${esc(tx('a.layer', { n: l + 1 }))}</div>`;
      for (let k = 0; k < H; k++) h += `<button class="ma-row${G > 1 && k % G === 0 ? ' pair-a' : G > 1 ? ' pair-b' : ''}" data-head="${l}:${k}"><small>${k + 1}</small><canvas></canvas></button>`;
    }
    h += '<div class="ma-bubble" hidden></div></div><div class="ma-gqa"></div><div class="ma-card"></div>';
    host.innerHTML = h;
    this.rows = [...host.querySelectorAll('.ma-row')]; this.bubble = host.querySelector('.ma-bubble'); this.card = host.querySelector('.ma-card');
    fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.glossary) { this.docs = new Set(j.glossary); this.note(); } }).catch(() => {});
    this.note(); this.bind();
    new ResizeObserver(() => this.draw()).observe(host);
  }
  note() {
    const pre = window.MQ_PREFIX ? '/' + window.MQ_PREFIX : '/';
    this.host.querySelector('.ma-gqa').innerHTML = `<i></i><span>${esc(tx('a.gqa'))}</span>` +
      (this.docs.has('grouped-query-attention') ? ` <a class="gloss-more" href="${pre}docs/glossary/grouped-query-attention/" target="_blank" rel="noopener">${esc(tx('gl.more'))}</a>` : '');
  }
  tok(t) { return String(this.e.tokenText[this.steps[t].input]).replace(/ /g, '·').replace(/\n/g, '⏎'); }
  // веса attention текущего шага для головы (layer, head): Float32Array(pos + 1)
  w(l, k) { const st = this.steps[this.cur], n = st.pos + 1, H = this.e.info.heads; return st.attnP.subarray((l * H + k) * n, (l * H + k + 1) * n); }
  // чем красить историю: выбранная голова или все головы вместе (в сумме 1)
  weights() {
    if (!this.steps) return null;
    if (this.head) return this.w(this.head.layer, this.head.head);
    const { layers: L, heads: H } = this.e.info, n = this.steps[this.cur].pos + 1, out = new Float32Array(n);
    for (let l = 0; l < L; l++) for (let k = 0; k < H; k++) { const w = this.w(l, k); for (let t = 0; t < n; t++) out[t] += w[t] / (L * H); }
    return out;
  }
  set(steps, cur, head, track, pos = -1) { this.steps = steps; this.cur = cur; this.head = head; this.track = track; this.pos = pos <= cur ? pos : -1; this.draw(); }

  bind() {
    const strips = this.host.querySelector('.ma-strips'); let down = null;
    const at = (e) => { const row = e.target.closest('.ma-row'); if (!row) return null; const c = row.querySelector('canvas').getBoundingClientRect(), n = this.steps[this.cur].pos + 1;
      const [l, k] = row.dataset.head.split(':').map(Number); return { l, k, t: Math.max(0, Math.min(n - 1, Math.floor((e.clientX - c.left) / c.width * n))), row, c }; };
    const peek = (e) => { const a = at(e); if (!a) return; const v = this.w(a.l, a.k)[a.t], box = strips.getBoundingClientRect(), r = a.row.getBoundingClientRect();
      this.bubble.hidden = false; this.bubble.innerHTML = `<b>«${esc(this.tok(a.t))}»</b> ${pct(v)}`;
      const bw = this.bubble.offsetWidth; this.bubble.style.left = Math.max(0, Math.min(box.width - bw, e.clientX - box.left - bw / 2)) + 'px'; this.bubble.style.top = (r.top - box.top - 30) + 'px';
      if (a.t !== this.pos) { this.pos = a.t; this.cb.pos?.(a.t); this.paint(); } };
    strips.addEventListener('pointerdown', (e) => { if (!this.steps || !e.target.closest('.ma-row')) return; down = { x: e.clientX, y: e.clientY, moved: false }; });
    strips.addEventListener('pointermove', (e) => { if (!down) return; if (!down.moved && Math.abs(e.clientX - down.x) < 8) return; down.moved = true; peek(e); });
    const end = (e, cancel) => { if (!down) return; const d = down; down = null; this.bubble.hidden = true;
      if (cancel || d.moved) return;                 // провели по полосе — это обзор, голову не меняем
      const a = at(e); if (!a) return;
      this.head = this.head && this.head.layer === a.l && this.head.head === a.k ? null : { layer: a.l, head: a.k }; this.cb.head?.(this.head); this.draw(); };
    strips.addEventListener('pointerup', (e) => end(e, false)); strips.addEventListener('pointercancel', (e) => end(e, true));
    this.host.addEventListener('click', (e) => {
      const a = e.target.closest('a.gloss-more'); if (a) { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); this.cb.doc?.(a.getAttribute('href')); return; }
      const b = e.target.closest('[data-pos]'); if (b) { const t = Number(b.dataset.pos); this.pos = this.pos === t ? -1 : t; this.cb.pos?.(this.pos, true); this.draw(); }
    });
  }

  draw() {
    if (!this.steps || !this.host.clientWidth) return;
    const n = this.steps[this.cur].pos + 1;
    this.host.querySelector('.ma-past').textContent = tx('a.axis.past', { n });
    this.host.querySelector('.ma-now').innerHTML = `${esc(tx('a.axis.now'))} <b>«${esc(this.tok(this.cur))}»</b>`;
    this.paint(); this.drawCard();
  }
  paint() {
    const n = this.steps[this.cur].pos + 1, dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const row of this.rows) {
      const [l, k] = row.dataset.head.split(':').map(Number), cv = row.querySelector('canvas'), W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
      const on = this.head && this.head.layer === l && this.head.head === k; row.classList.toggle('on', !!on); row.classList.toggle('dim', !!this.head && !on);
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const w = this.w(l, k), cw = W / n;
      if (this.pos >= 0 && this.pos < n) { g.fillStyle = 'rgba(242,179,61,0.16)'; g.fillRect(this.pos * cw, 0, Math.max(1.5, cw), H); }
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, H - 1, W, 1);
      for (let t = 0; t < n; t++) { const v = w[t]; if (v < 0.004) continue; const s = Math.sqrt(v), bh = Math.max(1.5, s * (H - 2));
        g.fillStyle = `rgba(242,179,61,${(0.3 + 0.7 * s).toFixed(3)})`; g.fillRect(t * cw, H - 1 - bh, Math.max(1, cw - (cw > 3 ? 0.6 : 0)), bh); }
    }
  }
  drawCard() {
    const hd = this.head, { heads: H, kvHeads: KV } = this.e.info;
    if (!hd) { this.card.innerHTML = `<p class="ma-hint">${esc(tx('mob.attn.hint'))}</p>`; return; }
    const w = this.w(hd.layer, hd.head), G = H / KV, g0 = Math.floor(hd.head / G) * G, mates = [];
    for (let k = g0; k < g0 + G; k++) if (k !== hd.head) mates.push(k + 1);
    const top = Array.from(w, (v, t) => [v, t]).sort((a, b) => b[0] - a[0]).slice(0, 5).filter((x) => x[0] >= 0.01);
    const st = this.steps[this.cur], tok = this.track == null ? st.output : this.track, sg = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
    let sum = 0, mine = 0; for (let k = 0; k < H; k++) { const c = headPart(this.e, st, hd.layer, k, tok); sum += c; if (k === hd.head) mine = c; }
    this.card.innerHTML = `<b>${esc(tx('a.card.head.h', { layer: hd.layer + 1, head: hd.head + 1 }))}</b>` +
      (mates.length ? `<p>${esc(tx('a.card.head.gqa', { mate: mates.join(', ') }))}</p>` : '') +
      `<p class="ma-look">${esc(tx('a.card.head.look'))}</p><div class="ma-top">${top.map(([v, t]) => `<button data-pos="${t}" class="${t === this.pos ? 'on' : ''}"><em>«${esc(this.tok(t))}»</em><i>${pct(v)}</i></button>`).join('')}</div>` +
      `<p>${esc(tx('a.card.head.score'))} <i class="ma-tok">«${esc(String(this.e.tokenText[tok]).replace(/ /g, '·'))}»</i>: <b class="${mine >= 0 ? 'pos' : 'neg'}">${sg(mine)}</b> ${esc(tx('a.card.head.of', { sum: sg(sum), layer: hd.layer + 1 }))}</p>`;
  }
}
