// Сверка WebAssembly-движка с нативной сборкой: node viz/web/engine/test_node.mjs model.bin "words" seed
import { readFileSync } from 'node:fs';
import { loadEngine, Engine } from './engine.js';
const [, , model, words = 'play luxury shiny', seed = '1'] = process.argv;
const e = await loadEngine(new Uint8Array(readFileSync(model)));
e.settings({ seed: Number(seed), maxNew: 200 });
const t0 = performance.now();
const run = e.run(Engine.orderPrompt(words), words);
const ms = performance.now() - t0;
const gen = run.steps.filter((s) => s.kind === 'gen');
let sum = 0;
for (const s of run.steps) for (const v of s.logitsRaw) sum += v;
console.log(gen.map((s) => s.output).join(','));
console.log('logits_sum', sum.toFixed(6));
const last = run.steps[run.steps.length - 1];
const lens = e.lens(last.resid.subarray(e.info.layers * e.info.dim));
let same = true; for (let i = 0; i < lens.length; i++) if (lens[i] !== last.logitsRaw[i]) { same = false; break; }
const text = gen.filter((s) => s.output > 2).map((s) => e.tokenText[s.output]).join('');
console.error(`шагов ${run.steps.length} (промпт ${run.nPrompt}), ответ ${gen.length} токенов, ${(1000 * run.steps.length / ms).toFixed(0)} шагов/с с записью трассы; lens == логиты: ${same}`);
console.error(`слова: ${last.words.map((w) => w.text + ':' + (w.used ? 'да' : 'нет')).join(' ')}\n${text.slice(0, 200)}...`);
