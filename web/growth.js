import { t as tx } from './i18n.js';
// Полоска «рост внимания»: почему длинный контекст дорогой. Матрицы модели — постоянная работа на токен (~1.06 млн
// умножений), attention — L·H·(pos+1)·2·head_dim: растёт с каждым токеном, а накопленная работа — как n².
// Всё считается из размеров модели (info), а не вписано руками.

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (x) => x >= 1e9 ? (x / 1e9).toFixed(2) + tx('num.B') : x >= 1e6 ? (x / 1e6).toFixed(1) + tx('num.M') : x >= 1e3 ? (x / 1e3).toFixed(1) + tx('num.k') : String(Math.round(x));

export class GrowthChart {
  constructor(canvas, info) {
    this.cv = canvas; this.info = info; this.pos = 0;
    const { dim: d, inter: I, layers: L, heads: H, kvHeads: KV, headDim: hd, vocab: V } = info;
    // умножений на токен в матрицах: q, k, v, o, gate, up, down в каждом слое + выходной слой
    this.M = L * (d * H * hd + 2 * d * KV * hd + H * hd * d + 3 * d * I) + V * d;
    this.A1 = L * H * 2 * hd;                       // attention: на каждую пару «запрос–ключ» q·k и вклад в сумму по V
    this.cross = Math.ceil(this.M / this.A1);        // позиция, где attention на токен сравнялся бы с матрицами
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set(pos) { this.pos = pos; this.draw(); }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = cv.clientHeight;
    if (!W || !Hh) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    const { layers: L, heads: H, maxPos: P } = this.info, n = this.pos + 1;
    const mono = css('--mono'), Y = '#f2b33d', Li = '#a98cf0';
    // текст слева
    const pairs = n * (n + 1) / 2, attnTok = this.A1 * n, share = attnTok / (attnTok + this.M);
    const shareEnd = this.A1 * P / (this.A1 * P + this.M);
    const xc = Math.ceil(2 * this.M / this.A1);     // накопленная работа attention обгоняет матрицы
    g.textBaseline = 'top'; g.textAlign = 'left';
    // Одна мысль: чем длиннее история, тем дороже каждый новый токен. Сравнений столько, сколько записей в кэше,
    // а остальные слои стоят одинаково на любом шаге. (Раньше здесь были пять строк с MAC и парами «запрос–ключ».)
    const lines = [
      [tx('gr2.title'), css('--ink-1') || css('--text')],
      [tx('gr2.now', { n, all: fmt(n * L * H), cmp: n * L * H, heads: L * H }), css('--ink-2') || css('--text')],
      [tx('gr2.share', { share: (100 * share).toFixed(0) }), Y],
      [tx('gr2.rest', { rest: (100 * (1 - share)).toFixed(0) }), Li],
      [tx('gr2.end', { P, share: (100 * shareEnd).toFixed(0) }), css('--muted')],
    ];
    g.font = '11px ' + (css('--ui') || mono);
    while (lines.length > 2 && 7 + lines.length * 16 + 10 > Hh) lines.pop();      // низкая панель: последние строки не помещаются
    lines.forEach(([t, c], i) => { g.fillStyle = c; g.font = (i === 0 ? '600 ' : '') + '11px ' + (css('--ui') || mono); g.fillText(t, 10, 7 + i * 16); });
    // доля внимания в работе над этим токеном: полоска с отметкой «на последнем токене контекста»
    const bw = Math.min(260, W * 0.42), by = 7 + lines.length * 16 + 3;
    if (by + 6 < Hh) { g.fillStyle = Li + '88'; g.fillRect(10, by, bw, 5); g.fillStyle = Y; g.fillRect(10, by, Math.max(2, bw * share), 5);
      g.fillStyle = css('--muted'); g.fillRect(10 + bw * shareEnd, by - 2, 1, 9); }
    // график накопленной работы: ось продлена за контекст модели, чтобы была видна вся парабола
    const textW = Math.max(...lines.map(([s]) => g.measureText(s).width)) + 10;
    const x0 = Math.round(Math.max(W * 0.55, textW + 24)), x1 = W - 12, y0 = Hh - 15, y1 = 8, K = Math.ceil(xc * 1.15);
    if (x1 - x0 < 80) return;
    const cumA = (k) => this.A1 * k * (k + 1) / 2, cumM = (k) => this.M * k;
    const top = Math.max(cumA(K), cumM(K));
    const X = (k) => x0 + (x1 - x0) * k / K, Yv = (v) => y0 - (y0 - y1) * v / top;
    g.strokeStyle = '#2a2f36'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.moveTo(x0, y0); g.lineTo(x0, y1); g.stroke();
    // граница контекста модели
    g.strokeStyle = '#4a505a'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(P), y0); g.lineTo(X(P), y1); g.stroke(); g.setLineDash([]);
    const curve = (f, color, from, to, dash) => {
      g.strokeStyle = color; g.lineWidth = 2; g.setLineDash(dash ? [4, 4] : []);
      g.beginPath();
      const step = Math.max(1, Math.floor((to - from) / 200));
      for (let k = from; k <= to; k += step) { const px = X(k), py = Yv(f(k)); k === from ? g.moveTo(px, py) : g.lineTo(px, py); }
      g.lineTo(X(to), Yv(f(to)));
      g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    };
    curve(cumM, Li + '77', n, K, true); curve(cumA, Y + '77', n, K, true);
    curve(cumM, Li, 0, n, false); curve(cumA, Y, 0, n, false);
    g.fillStyle = css('--chosen'); g.beginPath(); g.arc(X(n), Yv(cumA(n)), 3.5, 0, 7); g.fill();
    g.font = '10px ' + mono; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.fillStyle = Y; g.textAlign = 'right'; g.fillText(tx('gr2.attnLabel'), X(K * 0.97), Yv(cumA(K * 0.97)) + 10);
    g.fillStyle = Li; g.textAlign = 'right'; g.fillText(tx('gr.matLabel'), x1, Yv(cumM(K * 0.6)) + 12);     // от правого края: в узкой панели подпись не обрезается
    g.fillStyle = css('--dim'); g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(tx('gr.ctx', { n: P }), X(P), y0 + 2);
    if (x1 - X(P) > 110) { g.textAlign = 'right'; g.fillText(tx('gr.tokens', { x: fmt(K) }), x1, y0 + 2); }   // иначе наезжает на подпись контекста
  }
}
