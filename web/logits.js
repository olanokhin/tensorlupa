// Полоса логитов: 64 лучших кандидата шага + один столбик «хвоста». Высота — вероятность на логарифмической шкале
// (после доплаты, маски и температуры, до отсечения top-k). Цвет: в top-k / за чертой top-k / выбран.
// Белая черта — вероятность того же токена БЕЗ вмешательств (по исходным логитам модели): видно, куда сдвинула доплата.

const N_SHOW = 64;
const LOG_MIN = -6;           // 1e-6 внизу шкалы

function softmax(logits, T) {
  const V = logits.length, out = new Float32Array(V);
  let mx = -Infinity;
  for (let i = 0; i < V; i++) if (logits[i] > mx) mx = logits[i];
  let s = 0;
  for (let i = 0; i < V; i++) { const v = logits[i] <= -1e29 ? 0 : Math.exp((logits[i] - mx) / T); out[i] = v; s += v; }
  for (let i = 0; i < V; i++) out[i] /= s;
  return out;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class LogitStrip {
  constructor(canvas, tip, tokenText) {
    this.cv = canvas; this.tip = tip; this.tokenText = tokenText;
    this.bars = []; this.step = null;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('mousemove', (e) => this.hover(e));
    canvas.addEventListener('mouseleave', () => { this.tip.hidden = true; });
  }

  set(step, T) {
    this.step = step; this.T = T;
    if (!step) { this.draw(); return; }
    const pRaw = softmax(step.logitsRaw, T);
    // кусок задан автоматом: показываем, что выбрала бы модель сама (исходные логиты), заданный кусок подсвечен
    this.forcedView = step.forced >= 0;
    const pFinal = this.forcedView ? pRaw : softmax(step.logitsFinal, T);
    const order = Array.from(pFinal.keys()).sort((a, b) => pFinal[b] - pFinal[a]);
    const top = order.slice(0, N_SHOW);
    const inTopk = new Map(step.topk.map((c) => [c.tok, c.p]));
    const bias = new Map(step.bias.map((b) => [b.tok, b.val]));
    let tail = 0, masked = 0;
    for (let i = N_SHOW; i < order.length; i++) tail += pFinal[order[i]];
    for (let i = 0; i < step.logitsFinal.length; i++) if (step.logitsFinal[i] <= -1e29) masked++;
    this.bars = top.map((t) => ({ tok: t, p: pFinal[t], pRaw: pRaw[t], raw: step.logitsRaw[t], fin: step.logitsFinal[t],
      bias: this.forcedView ? 0 : bias.get(t) || 0, inTopk: this.forcedView || inTopk.has(t), pTopk: inTopk.get(t) || 0,
      chosen: t === step.output }));
    this.tail = tail; this.tailCount = order.length - N_SHOW - masked; this.masked = masked;
    this.chosenOutside = !top.includes(step.output);
    this.draw();
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!this.step) return;
    const padL = 38, padR = 8, padT = 10, labH = 58, chartH = H - padT - labH;
    const n = this.bars.length + 1, bw = (W - padL - padR) / n;
    const y = (p) => padT + chartH * (1 - Math.max(0, (Math.log10(Math.max(p, 1e-12)) - LOG_MIN) / -LOG_MIN));
    // сетка
    g.font = '10px ' + css('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let e = 0; e >= LOG_MIN; e--) {
      const yy = y(10 ** e);
      g.strokeStyle = e === 0 ? '#3a4049' : '#2a2f36'; g.beginPath(); g.moveTo(padL, yy); g.lineTo(W - padR, yy); g.stroke();
      g.fillStyle = css('--dim'); g.fillText(e === 0 ? '1' : '1e' + e, padL - 5, yy);
    }
    const cAcc = css('--accent'), cDim = '#4a5059', cCh = css('--chosen'), cBias = css('--bias'), cForced = css('--forced');
    this.layout = [];
    this.bars.forEach((b, i) => {
      const x = padL + i * bw, top = y(b.p), w = Math.max(1, bw - 2);
      g.fillStyle = this.forcedView ? (b.chosen ? cForced : '#6b5f8f') : b.chosen ? cCh : b.inTopk ? cAcc : cDim;
      g.fillRect(x + 1, top, w, padT + chartH - top);
      if (b.bias > 0 && b.bias < 1e8) { g.fillStyle = cBias; g.fillRect(x + 1, top - 3, w, 3); }
      const yr = y(b.pRaw);
      if (Math.abs(yr - top) > 1.5) { g.strokeStyle = '#ffffffcc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 1, yr); g.lineTo(x + 1 + w, yr); g.stroke(); }
      this.layout.push({ x, w: bw, b });
      // подпись токена — вертикально
      g.save(); g.translate(x + bw / 2 + 3, padT + chartH + 4); g.rotate(-Math.PI / 2);
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = b.chosen ? cCh : b.inTopk ? '#c9ced6' : css('--dim');
      g.font = (bw > 13 ? '11px ' : '9px ') + css('--mono');
      g.fillText(show(this.tokenText[b.tok]).slice(0, 9), 0, 0); g.restore();
    });
    // хвост
    const x = padL + this.bars.length * bw, top = y(this.tail);
    g.fillStyle = '#39404a'; g.fillRect(x + 1, top, Math.max(1, bw - 2), padT + chartH - top);
    g.save(); g.translate(x + bw / 2 + 3, padT + chartH + 4); g.rotate(-Math.PI / 2); g.textAlign = 'right';
    g.textBaseline = 'middle'; g.fillStyle = css('--dim'); g.font = '9px ' + css('--mono'); g.fillText('хвост', 0, 0); g.restore();
    this.layout.push({ x, w: bw, tail: true });
  }

  hover(e) {
    if (!this.layout) return;
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left;
    const it = this.layout.find((l) => mx >= l.x && mx < l.x + l.w);
    if (!it) { this.tip.hidden = true; return; }
    let s;
    if (it.tail) {
      s = `хвост: ещё ${this.tailCount} токенов\nсуммарно p = ${fmtP(this.tail)}` + (this.masked ? `\nзапрещено автоматом: ${this.masked}` : '');
    } else {
      const b = it.b;
      s = `«${show(this.tokenText[b.tok])}»  #${b.tok}${b.chosen ? '   ← выбран' : ''}\n` +
        `логит модели      ${b.raw.toFixed(2)}\n` +
        (this.forcedView ? (b.chosen ? `автомат           этот кусок задан\n` : `автомат           запрещён: собирается слово\n`) :
          b.bias ? `доплата          +${b.bias.toFixed(2)}\n` : '') +
        `p без вмешательств ${fmtP(b.pRaw)}\n` +
        `p после них       ${fmtP(b.p)}\n` +
        (this.forcedView ? '' : b.inTopk ? `p в top-k         ${fmtP(b.pTopk)}` : `за чертой top-k — не может быть выбран`);
    }
    this.tip.textContent = s; this.tip.hidden = false;
    const tx = Math.min(mx + 14, r.width - this.tip.offsetWidth - 6);
    this.tip.style.left = Math.max(4, tx) + 'px'; this.tip.style.top = '8px';
  }
}

export function show(t) { return t === undefined ? '' : t.replace(/\n/g, '↵').replace(/ /g, '·'); }
function fmtP(p) { return p >= 0.01 ? (100 * p).toFixed(1) + '%' : p.toExponential(1); }
