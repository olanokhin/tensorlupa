// Обёртка над WebAssembly-движком micro-qwen3 (viz/engine/viz.c). Каждый шаг возвращается как запись трассы —
// обычный JS-объект с копиями массивов, так что по записанному прогону можно ходить назад без пересчёта.
// Формат записи описан в viz/TRACE.md.
import createMQViz from './mqviz.js';

export async function loadEngine(modelBytes, wasmOptions = {}) {
  const M = await createMQViz(wasmOptions);
  const e = new Engine(M);
  e.load(modelBytes);
  return e;
}


// Статистика корпуса: 4-граммы токенов TinyStories V2, встреченные ≥ 50 раз (web/corpus-4grams.bin, ~2,3 МБ).
// Один файл на две задачи: штраф за повторы с учётом корпуса и (позже) черновик спекулятивного декодирования.
// Формат: uint32 N, N ключей по 6 байт (4 токена по 12 бит, big-endian, по возрастанию), N байт q ≈ 10·log2(счётчик);
// q ≥ 100 ровно тогда, когда 4-грамма встречалась ≥ 1000 раз.
export class Corpus {
  constructor(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), n = dv.getUint32(0, true);
    this.keys = new Float64Array(n); this.q = buf.subarray(4 + 6 * n, 4 + 7 * n);
    for (let i = 0, o = 4; i < n; i++, o += 6) this.keys[i] = dv.getUint16(o) * 2 ** 32 + dv.getUint32(o + 2);
    this.n = n;
  }
  static key(a, b, c, d) { return ((a * 4096 + b) * 4096 + c) * 4096 + d; }
  // q или -1, если 4-граммы нет в таблице (встречалась < 50 раз)
  q4(a, b, c, d) {
    const k = Corpus.key(a, b, c, d), K = this.keys; let lo = 0, hi = this.n - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (K[m] === k) return this.q[m]; if (K[m] < k) lo = m + 1; else hi = m - 1; }
    return -1;
  }
}

export class Engine {
  constructor(M) {
    this.M = M;
    const c = (name, ret, args) => M.cwrap(name, ret, args);
    this.f = {
      load: c('viz_load', 'number', ['number', 'number']),
      settings: c('viz_settings', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number',
        'number', 'number', 'number', 'number']),
      begin: c('viz_begin', 'number', ['string', 'string']),
      force: c('viz_force', null, ['number', 'number']),
      extra: c('viz_extra', 'number', []),             // добавка к логитам шага (эксперименты)
      extraOn: c('viz_extra_on', null, ['number']),
      sampling: c('viz_sampling', null, ['number', 'number']),   // min-p, top-p (эксперимент)
      step: c('viz_step', 'number', []),
      lens: c('viz_lens', null, ['number']),
      info: c('viz_info', 'number', ['number']),
      tokLen: c('viz_token_len', 'number', ['number']),
      tokPtr: c('viz_token_ptr', 'number', ['number']),
      si: c('viz_step_int', 'number', ['number']),
      sf: c('viz_step_float', 'number', ['number']),
      wordInt: c('viz_word_int', 'number', ['number', 'number']),
      wordText: c('viz_word_text', 'number', ['number']),
      wb: c('viz_wb', 'number', ['number']),
      weights: c('viz_weights', 'number', ['number', 'number']),
    };
    for (const n of ['tr_resid', 'tr_attn_out', 'tr_mlp_act', 'tr_mlp_out', 'tr_attn_p', 'tr_final_norm', 'tr_head_out', 'tr_v_out', 'logits_raw',
      'logits_final', 'lens_out', 'bias_tok', 'bias_val', 'loop_tok', 'loop_val', 'allowed', 'topk_tok', 'topk_p']) {
      this.f[n] = c('viz_' + n, 'number', []);
    }
  }

  load(bytes) {
    const M = this.M, p = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, p);
    const rc = this.f.load(p, bytes.length);
    M._free(p);
    if (rc) throw new Error('model failed to load: ' + rc);
    const i = (k) => this.f.info(k);
    this.info = { vocab: i(0), dim: i(1), inter: i(2), layers: i(3), heads: i(4), kvHeads: i(5), headDim: i(6), maxPos: i(7) };
    // словарь: байты и текст каждого токена (кусок многобайтового символа покажется как �)
    const dec = new TextDecoder('utf-8');
    this.tokenBytes = []; this.tokenText = [];
    for (let t = 0; t < this.info.vocab; t++) {
      const n = this.f.tokLen(t), ptr = this.f.tokPtr(t);
      const b = M.HEAPU8.slice(ptr, ptr + n);
      this.tokenBytes.push(b);
      this.tokenText.push(t === 0 ? '<|endoftext|>' : t === 1 ? '<|im_start|>' : t === 2 ? '<|im_end|>' : dec.decode(b));
    }
  }

  settings(s = {}) {
    const d = { temperature: 0.6, topK: 40, seed: 1, wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, fsmLock: 2,
      fsmBonus: 4, loopImm: 0, loopMult: 0, maxNew: 240, corpusPenalty: false, minP: 0.02, ...s };
    this.cfg = d;
    this.f.settings(d.temperature, d.topK, d.seed >>> 0, d.wbBase, d.wbTau, d.wbStart, d.fsm ? 1 : 0, d.fsmLock,
      d.fsmBonus, d.loopImm, d.loopMult, d.maxNew);
    this.f.sampling(d.minP, 1);                       // min-p: отсечение хвоста после top-k
  }

  // prompt — текст для модели; words — заказанные слова ('' — без заказа). Возвращает число токенов промпта.
  begin(prompt, words = '') {
    if (!this.cfg) this.settings();
    this.gen = [];
    this.reqWords = words.split(/[ ,]+/).filter(Boolean).map((w) => w.toLowerCase());
    return this.f.begin(prompt, words);
  }

  // «На том же тексте»: после begin() задать токены ответа (массив id); [] — обычный режим.
  force(answer) {
    const M = this.M, p = M._malloc(Math.max(1, answer.length) * 4);
    M.HEAP32.set(answer, p >> 2);
    this.f.force(p, answer.length);
    M._free(p);
  }

  static orderPrompt(words) {
    return `<|im_start|>user\nWrite a short story. Use the words: ${words.split(/[ ,]+/).filter(Boolean).join(', ')}.` +
      '<|im_end|>\n<|im_start|>assistant\n';
  }

  f32(ptrFn, n) { const p = ptrFn() >> 2; return this.M.HEAPF32.slice(p, p + n); }
  i32(ptrFn, n) { const p = ptrFn() >> 2; return Array.from(this.M.HEAP32.subarray(p, p + n)); }

  // Один шаг. Возвращает запись трассы или null, если прогон закончен.
  // Штраф за повторы с учётом корпуса (измерен в micro-qwen3, experiments/ngram): если следующий токен повторил бы
  // 4-грамму, уже написанную в этой истории, он получает −β за каждый такой повтор — кроме естественных повторов,
  // частых в детских историях (≥ 1000 раз в корпусе: «Once upon a time»). Куски внутри слова не штрафуются.
  // Возвращает список штрафов [{tok, val, gram}] и кладёт их в добавку к логитам движка.
  // Исключения: первый кусок заказанного слова (заказанный предмет в истории и должен повторяться — иначе модель
  // дописывает его хвост к другому началу: «playrobe»). Двойник куска без пробела («B» для « B») получает тот же
  // штраф — иначе модель приклеивает слово к предыдущему: «HappyBree».
  corpusPenaltyStep(beta = 4) {
    const g = this.gen, n = g.length, out = [];
    if (!this.corpus || n < 3) return out;
    if (!this.byText) { this.byText = new Map(); this.tokenText.forEach((x, i) => { if (!this.byText.has(x)) this.byText.set(x, i); }); }
    const req = (t) => { const x = this.tokenText[t].trim().toLowerCase();
      return /^[a-z]/.test(x) && (this.reqWords || []).some((w) => w.startsWith(x) && (x.length >= 2 || x === w)); };
    const a = g[n - 3], b = g[n - 2], c = g[n - 1], seen = new Map();
    for (let i = 0; i + 3 < n; i++) if (g[i] === a && g[i + 1] === b && g[i + 2] === c) seen.set(g[i + 3], (seen.get(g[i + 3]) || 0) + 1);
    const T = this.tokenText, letter = (ch) => /[A-Za-z]/.test(ch || '');
    for (const [t, k] of seen) {
      if (letter(T[t][0]) && letter(T[c].slice(-1))) continue;         // продолжение слова — не трогаем
      if (this.corpus.q4(a, b, c, t) >= 100) continue;                 // естественный повтор
      if (req(t)) continue;                                            // заказанное слово
      out.push({ tok: t, val: -beta * k, gram: [a, b, c, t], times: k });
      const tw = T[t][0] === ' ' ? this.byText.get(T[t].slice(1)) : undefined;   // двойник без пробела
      if (tw !== undefined && !seen.has(tw)) out.push({ tok: tw, val: -beta * k, gram: [a, b, c, t], times: k, twin: true });
    }
    return out;
  }

  step() {
    let cp = null;
    if (this.cfg.corpusPenalty && this.corpus) {
      cp = this.corpusPenaltyStep();
      const ex = new Float32Array(this.M.HEAPF32.buffer, this.f.extra(), this.info.vocab);
      ex.fill(0); for (const x of cp) ex[x.tok] += x.val;
      this.f.extraOn(cp.length ? 1 : 0);
    } else this.f.extraOn(0);
    const k = this.f.step();
    if (k <= 0) return null;
    const { vocab: V, dim: d, inter: I, layers: L, heads: H, maxPos: P } = this.info;
    const si = (i) => this.f.si(i), pos = si(0);
    // внимание: только позиции 0..pos каждой головы
    const ap = this.f.tr_attn_p() >> 2, attnP = new Float32Array(L * H * (pos + 1));
    for (let x = 0; x < L * H; x++) attnP.set(this.M.HEAPF32.subarray(ap + x * P, ap + x * P + pos + 1), x * (pos + 1));
    const nb = si(6), nl = si(7), na = si(8), nk = si(9), nw = si(11);
    const bt = this.i32(this.f.bias_tok, nb), bv = this.f32(this.f.bias_val, nb);
    const lt = this.i32(this.f.loop_tok, nl), lv = this.f32(this.f.loop_val, nl);
    const kt = this.i32(this.f.topk_tok, nk), kp = this.f32(this.f.topk_p, nk);
    const words = [];
    for (let w = 0; w < nw; w++) {
      words.push({ text: this.M.UTF8ToString(this.f.wordText(w)), state: this.f.wordInt(w, 0), k: this.f.wordInt(w, 1),
        pieces: this.f.wordInt(w, 2), used: !!this.f.wordInt(w, 3) });
    }
    return {
      kind: k === 1 ? 'prompt' : 'gen', pos, input: si(1), output: si(2), forced: si(4), form: si(5), genIndex: si(10),
      resid: this.f32(this.f.tr_resid, (L + 1) * d), attnOut: this.f32(this.f.tr_attn_out, L * d),
      mlpAct: this.f32(this.f.tr_mlp_act, L * I), mlpOut: this.f32(this.f.tr_mlp_out, L * d), attnP,
      finalNorm: this.f32(this.f.tr_final_norm, d),
      headOut: this.f32(this.f.tr_head_out, L * H * this.info.headDim),
      vOut: this.f32(this.f.tr_v_out, L * this.info.kvHeads * this.info.headDim),
      logitsRaw: this.f32(this.f.logits_raw, V), logitsFinal: this.f32(this.f.logits_final, V),
      bias: bt.map((t, i) => ({ tok: t, val: bv[i] })),
      // штраф за повторы: в студии — с учётом корпуса (cp); старое правило движка (lt/lv) — как на плате
      loop: k === 2 && cp && si(4) < 0 ? cp : lt.map((t, i) => ({ tok: t, val: lv[i] })),
      allowed: this.i32(this.f.allowed, na), topk: kt.map((t, i) => ({ tok: t, p: kp[i] })),
      sampleR: this.f.sf(0), entropy: this.f.sf(1),
      words, wordsUsed: si(12),
      wb: { base: this.f.wb(0), u0: this.f.wb(1), u: this.f.wb(2), t: this.f.wb(3), tau: this.f.wb(4) },
    };
  }

  // Весь прогон сразу: массив записей.
  run(prompt, words = '', onStep = null) {
    const nPrompt = this.begin(prompt, words), steps = [];
    for (let r; (r = this.step());) { steps.push(r); if (r.kind === 'gen' && r.output > 2) this.gen.push(r.output); if (onStep) onStep(r); }
    return { prompt, words, nPrompt, settings: { ...this.cfg }, steps };
  }

  // Веса слоя (float, строки — измерения потока): 'o' [dim × heads·headDim], 'down' [dim × inter]. Кэшируются.
  weights(layer, which) {
    this.wcache = this.wcache || {};
    const key = layer + which;
    if (!this.wcache[key]) {
      const cols = which === 'o' ? this.info.heads * this.info.headDim : this.info.inter;
      const p = this.f.weights(layer, which === 'o' ? 0 : 1) >> 2;
      this.wcache[key] = this.M.HEAPF32.slice(p, p + this.info.dim * cols);
    }
    return this.wcache[key];
  }

  // Logit lens: что предсказала бы модель по остаточному потоку x (dim чисел).
  lens(x) {
    const M = this.M, p = M._malloc(x.length * 4);
    M.HEAPF32.set(x, p >> 2);
    this.f.lens(p);
    M._free(p);
    return this.f32(this.f.lens_out, this.info.vocab);
  }
}
