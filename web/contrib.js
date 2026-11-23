// TensorLupa — Copyright 2026 Alex Anokhin — Apache License 2.0 (LICENSE, NOTICE)
// Точное разложение логита по частям модели. Считается одинаково во всех видах: в 3D-окне «Модель», в окне «Внимание»
// и в колонке «Модель» на телефоне, поэтому числа в них совпадают.
//
// Финальная норма делит весь остаточный поток на его rms, поэтому вклад части потока в логит токена — это её
// проекция через норму и словарь (engine.lens) в масштабе фактического потока. Вклады эмбеддинга, attention и MLP
// всех слоёв в сумме дают логит модели (расхождение в сотых).

const rms = (a) => { let q = 0; for (const x of a) q += x * x; return Math.sqrt(q / a.length); };

// сколько очков вектор v (часть остаточного потока шага step) добавил логиту токена tok
export function partLogit(engine, step, v, tok) {
  const { layers: L, dim: d } = engine.info, xf = step.resid.subarray(L * d, (L + 1) * d);
  const rv = rms(v); return rv < 1e-9 ? 0 : engine.lens(v)[tok] * rv / rms(xf);
}

// вклад головы h слоя l: её выход через W_o, прочитанный логит-линзой. Четыре головы слоя в сумме дают вклад attention
export function headPart(engine, step, l, h, tok) {
  const { dim: d, heads: H, headDim: hd } = engine.info, Wo = engine.weights(l, 'o'), ho = step.headOut, v = new Float32Array(d);
  for (let i = 0; i < d; i++) { let y = 0; const row = i * H * hd + h * hd; for (let j = 0; j < hd; j++) y += Wo[row + j] * ho[(l * H + h) * hd + j]; v[i] = y; }
  return partLogit(engine, step, v, tok);
}

// Цепочка счёта токена по ходу потока: счёт после эмбеддинга, затем для каждого слоя вклад attention, счёт после
// него, вклад MLP и счёт на выходе слоя. Элементы: { kind: 'run' | 'attn' | 'mlp', layer, mid, value }.
export function scoreChain(engine, step, tok) {
  const { layers: L, dim: d } = engine.info, vec = new Float32Array(d), out = [];
  const total = (l, mid) => { for (let i = 0; i < d; i++) vec[i] = step.resid[l * d + i] + (mid ? step.attnOut[l * d + i] : 0); return partLogit(engine, step, vec, tok); };
  const delta = (arr, l) => partLogit(engine, step, Float32Array.from(arr.subarray(l * d, (l + 1) * d)), tok);
  out.push({ kind: 'run', layer: -1, mid: false, value: total(0, false) });
  for (let l = 0; l < L; l++) {
    out.push({ kind: 'attn', layer: l, value: delta(step.attnOut, l) });
    out.push({ kind: 'run', layer: l, mid: true, value: total(l, true) });
    out.push({ kind: 'mlp', layer: l, value: delta(step.mlpOut, l) });
    out.push({ kind: 'run', layer: l, mid: false, value: total(l + 1, false) });
  }
  return out;
}
