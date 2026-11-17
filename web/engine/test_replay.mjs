// Та же модель с точностью до округления? node test_replay.mjs model.bin "words" dump.bin
// dump.bin — от нативной сборки (cli --dump): её токены ответа и логиты каждого шага. Здесь WebAssembly проходит
// тот же текст (viz_force) и сравнивает логиты шаг за шагом.
import { readFileSync } from 'node:fs';
import { loadEngine, Engine } from './engine.js';
const [, , model, words, dump] = process.argv;
const buf = readFileSync(dump), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let o = 0; const nt = dv.getInt32(o, true); o += 4;
const toks = []; for (let i = 0; i < nt; i++) { toks.push(dv.getInt32(o, true)); o += 4; }
const n = dv.getInt32(o, true); o += 4;
const e = await loadEngine(new Uint8Array(readFileSync(model)));
const V = e.info.vocab;
e.settings({ maxNew: 200 });
e.begin(Engine.orderPrompt(words), words);
e.force(toks);
let s = 0, maxAbs = 0, maxLogit = 0, argmaxSame = 0, outSame = 0;
for (let r; (r = e.step()) && s < n; s++) {
  let a1 = 0, a2 = 0;
  for (let i = 0; i < V; i++) {
    const nat = dv.getFloat32(o + (s * V + i) * 4, true), w = r.logitsRaw[i];
    maxAbs = Math.max(maxAbs, Math.abs(nat - w)); maxLogit = Math.max(maxLogit, Math.abs(nat));
    if (nat > dv.getFloat32(o + (s * V + a1) * 4, true)) a1 = i;
    if (w > r.logitsRaw[a2]) a2 = i;
  }
  argmaxSame += a1 === a2;
  if (r.kind === 'gen') outSame += r.output === toks[r.genIndex];
}
console.log(`${s} шагов из ${n}: макс. |разница логитов| ${maxAbs.toExponential(2)} (логиты до ${maxLogit.toFixed(1)}), ` +
  `лидер совпал на ${argmaxSame}/${s} шагах, заданный текст пройден: ${outSame}/${nt}`);
// порог: браузер и нативная сборка — один код без FMA, расхождение логитов должно быть на уровне округления
if (maxAbs > 1e-3 || argmaxSame !== s || outSame !== nt) { console.log('РАСХОЖДЕНИЕ'); process.exit(1); }
