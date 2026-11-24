// TensorLupa — Copyright 2026 Alex Anokhin — Apache License 2.0 (LICENSE, NOTICE)
// Общее для обеих раскладок студии (editor.js для большого экрана, mobile.js для телефона): умолчания, ссылка на
// эксперимент, проверенные seed, версии весов, разбор слов заказа, счётчик прогонов.

// ссылка на эксперимент: слова (или текст), seed, шаг и настройки, отличные от умолчаний, — в адресе страницы.
// Прогон детерминирован, поэтому по ссылке у получателя ровно та же история и тот же шаг.
export const DEF = { temperature: 0.6, topK: 40, minP: 0.02, wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, loopPenalty: true, maxNew: 200 };
export const QK = { temperature: 't', topK: 'k', minP: 'mp', wbBase: 'wb', wbTau: 'tau', wbStart: 'cs', fsm: 'fsm', loopPenalty: 'rp', maxNew: 'n' };

// Ссылка без q — из времён одной 4-битной версии без штрафа и min-p (ими записаны примеры в Docs): для неё
// умолчания тех времён, чтобы история осталась прежней. Новые ссылки всегда пишут q.
export const legacyLink = (q) => q.has('seed') && !q.has('q');
export function linkDefaults(q) { return legacyLink(q) ? { ...DEF, loopPenalty: false, minP: 0 } : DEF; }

export const DEMO_SEED = { 8: 1111, 4: 3 };

// То же для режима Completion с началом по умолчанию «Once upon a time»: перебор 1500 seed на каждую версию весов
// (история закончилась сама, без повторов трёх слов подряд и одинаковых предложений), лучшие прочитаны глазами.
export const COMPLETION_SEED = { 8: 1246, 4: 633 };

// одна модель, две версии весов: 8 бит — по умолчанию, качество как у полных весов; 4 бит (W4R) — сжатая, как на плате
// ESP32. Выбор версии хранится в браузере и попадает в ссылку на эксперимент (q=8 / q=4): получатель увидит ту же
// историю. Старые ссылки без q сделаны на 4-битной версии — она для них и остаётся
export const MODELS = [
  { id: 'micro-qwen3', bits: 8, file: 'model-8bit.bin', params: 1056656 },
  { id: 'micro-qwen3', bits: 4, file: 'model.bin', params: 1056656 },
];

// Ключевые слова: движок понимает до трёх английских слов (a–z, дефис, апостроф, до 23 букв), разделители — пробел
// или запятая. Лишние и неанглийские слова не уходят ни в движок, ни в промпт (иначе модель просят то, что не подталкивают),
// а под полем появляется тихая подсказка.
const WORD_RE = /^[a-z][a-z'-]{0,22}$/i;
export function parseWords(raw) {
  const all = raw.split(/[ ,]+/).filter(Boolean);
  const ok = all.filter((w) => WORD_RE.test(w)).map((w) => w.toLowerCase());
  return { words: ok.slice(0, 3), foreign: ok.length < all.length, extra: ok.length > 3 };
}

// Проверенные заказы: слова + seed, отобранные перебором 600 seed на комбинацию и чтением историй
// (все слова на месте, история закончилась сама, мало повторов). Клик — вписать и сгенерировать.
// готовые заказы: лучший seed для каждой версии весов — [слова, seed для 4 бит, seed для 8 бит]
// (подобраны под штраф с учётом корпуса и min-p 0.02: перебор 1500 seed, все слова, конец сам, без повторов и обломков)
export const PICKS_ALL = [
  ['dragon, cookie, school', 3, 1111], ['share, toy, kind', 147, 1238], ['find, treasure, brave', 319, 705],
  ['run, dog, fast', 1158, 1339], ['fly, kite, red', 670, 1409], ['play, ball, happy', 273, 711], ['robot, moon', 1002, 474],
];

// Счётчик прогонов на главной: после каждой готовой истории — анонимный «+1» на наш же сервер (tensorlupa.com/api/run).
// Отправляется только случайный номер браузера (localStorage), без текста и слов. Пересчёты от ползунков не считаются —
// иначе одно движение дало бы сотню «прогонов». На локальном сервере разработки не отправляется.
export function countRun() {
  // не считаем локальный сервер разработки, адреса домашней сети (студию смотрят с телефона по Wi-Fi) и
  // предварительные версии на workers.dev: в счётчике только прогоны на самом сайте
  if (/^(127\.0\.0\.1|localhost|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.*\.local|.*\.workers\.dev)$/.test(location.hostname)) return;
  // браузер под управлением программы (автоматические проверки сайта, роботы): это не посетитель
  if (navigator.webdriver) return;
  // Счётчик не должен мешать истории ни при каких условиях. crypto.randomUUID есть только на https: без него
  // вызов бросал исключение и обрывал генерацию до показа первого шага.
  try {
    const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''));
    let id = null;
    try { id = localStorage.getItem('mq.uid'); if (!id) { id = uid(); localStorage.setItem('mq.uid', id); } }
    catch { id = (countRun.tmp ||= uid()); }   // без хранилища — номер только на эту загрузку
    fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {});
  } catch (e) { console.warn(e); }
}

// вероятности из логитов при температуре T (по всему словарю, как полоса логитов в Лабе)
export function softmaxT(l, T) {
  let m = -Infinity; for (const x of l) if (x > m) m = x;
  const p = new Float64Array(l.length); let z = 0;
  for (let i = 0; i < l.length; i++) { const e = l[i] <= -1e29 ? 0 : Math.exp((l[i] - m) / T); p[i] = e; z += e; }
  for (let i = 0; i < l.length; i++) p[i] /= z;
  return p;
}

// термин подсказки → страница Docs (/docs/glossary/<slug>/). Какие страницы уже написаны, студия узнаёт из
// /docs/pages.json (его пишет сборка Docs); у остальных терминов — только подсказка, без ссылки.
export const DOC_SLUG = {
  languageModel: 'language-model', token: 'token', prompt: 'prompt', specialTokens: 'special-tokens', mode: 'instruct', model: 'transformer',
  embedding: 'residual-stream', residualStream: 'residual-stream', attention: 'attention', head: 'attention-head',
  weights: 'attention-head', valueWeighted: 'attention-head', mlp: 'mlp', logits: 'logits', logitLens: 'logit-lens',
  sampling: 'sampling', sampleDraw: 'sampling', pOut: 'sampling', temperature: 'temperature', topK: 'top-k', minP: 'min-p', seed: 'seed',
  maxNew: 'max-new-tokens', loopPenalty: 'repetition-penalty', wbBase: 'logit-bias', wbTau: 'logit-bias',
  wbStart: 'logit-bias', logitBias: 'logit-bias', keywords: 'logit-bias', fsm: 'fsm', entropy: 'entropy',
};
