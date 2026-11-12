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
    const padL = 34, padR = 8, padT = 8, labH = 44, chartH = H - padT - labH;
    const n = this.bars.length + 1, bw = (W - padL - padR) / n;
    const y = (p) => padT + chartH * (1 - Math.max(0, (Math.log10(Math.max(p, 1e-12)) - LOG_MIN) / -LOG_MIN));
    // сетка
    g.font = '10px ' + css('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let e = 0; e >= LOG_MIN; e--) {          // бледная сетка; подписи только 1, 1e-3, 1e-6
      const yy = Math.round(y(10 ** e)) + 0.5;
      g.strokeStyle = e === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'; g.beginPath(); g.moveTo(padL, yy); g.lineTo(W - padR, yy); g.stroke();
      if (e % 3 === 0) { g.fillStyle = 'rgba(235,238,243,0.32)'; g.fillText(e === 0 ? '1' : '1e' + e, padL - 5, yy); }
    }
    const cAcc = css('--accent'), cDim = '#4a5059', cCh = css('--chosen'), cBias = css('--bias'), cForced = css('--forced');
    this.layout = [];
    this.bars.forEach((b, i) => {
      // стеклянная колонна: тоньше шага, цвет насыщен сверху и тает книзу, скруглённая верхушка;
      // ярко — только выбранный токен (со свечением), кандидаты top-k — приглушённо, остальные — едва видны
      const w = Math.max(1, Math.min(bw * 0.58, 14)), x0 = padL + i * bw + (bw - w) / 2, x = padL + i * bw, top = y(b.p);
      const col = this.forcedView ? (b.chosen ? cForced : '#6b5f8f') : b.chosen ? cCh : b.inTopk ? cAcc : '#8a93a3';
      const a1 = b.chosen ? 0.95 : b.inTopk ? 0.55 : 0.22, a0 = b.chosen ? 0.35 : b.inTopk ? 0.10 : 0.04;
      glassBar(g, x0, top, w, padT + chartH - top, col, a1, a0, b.chosen);
      if (b.bias > 0 && b.bias < 1e8) { g.fillStyle = cBias; g.globalAlpha = 0.9; rr(g, x0, top - 3, w, 2, 1); g.fill(); g.globalAlpha = 1; }
      const yr = y(b.pRaw);
      if (Math.abs(yr - top) > 1.5) { g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 - 1, yr); g.lineTo(x0 + w + 1, yr); g.stroke(); }
      this.layout.push({ x, w: bw, b });
      // подпись токена — вертикально
      g.save(); g.translate(x + bw / 2 + 3, padT + chartH + 4); g.rotate(-Math.PI / 2);
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = b.chosen ? cCh : b.inTopk ? 'rgba(235,238,243,0.62)' : 'rgba(235,238,243,0.28)';
      g.font = (bw > 13 ? '10px ' : '9px ') + css('--mono');
      g.fillText(show(this.tokenText[b.tok]).slice(0, 7), 0, 0); g.restore();
    });
    // хвост
    const x = padL + this.bars.length * bw, top = y(this.tail);
    { const w = Math.max(1, Math.min(bw * 0.58, 14)); glassBar(g, x + (bw - w) / 2, top, w, padT + chartH - top, '#8a93a3', 0.3, 0.05, false); }
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

// скруглённый прямоугольник (только верхние углы)
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h); g.closePath();
}
// стеклянная колонна: вертикальный градиент цвета (a1 сверху → a0 снизу) и светлый блик по верхней кромке
function glassBar(g, x, y, w, h, color, a1, a0, glow) {
  if (h <= 0) return;
  const [r, gg, b] = hex(color), gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, `rgba(${r},${gg},${b},${a1})`); gr.addColorStop(1, `rgba(${r},${gg},${b},${a0})`);
  g.save();
  if (glow) { g.shadowColor = `rgba(${r},${gg},${b},0.55)`; g.shadowBlur = 10; }
  g.fillStyle = gr; rr(g, x, y, w, h, 3); g.fill();
  g.restore();
  g.fillStyle = `rgba(255,255,255,${glow ? 0.55 : 0.18})`; rr(g, x, y, w, Math.min(1.5, h), 1.5); g.fill();
}
function hex(c) {
  c = c.trim();
  if (c.startsWith('#')) { const v = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); }
  const m = c.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [200, 200, 200];
}
