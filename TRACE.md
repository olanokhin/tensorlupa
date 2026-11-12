# Trace format

The browser engine (`web/engine/engine.js` over `engine/viz.c` compiled to WebAssembly) records every step of a run
as a plain JS object. The editor only reads these records, so scrubbing back in time never recomputes anything.

A **step** = one input token at position `pos` → one forward pass → logits → (for answer tokens) word bias, automaton,
suffix mask, optional loop penalty → the chosen token. Prompt steps are recorded too (their next token is known).

```js
run = { prompt, words, nPrompt, settings, steps: [step, …] }

step = {
  kind: 'prompt' | 'gen',   pos, input, output,       // token ids; output of the last gen step may be a stop token (≤ 2)
  genIndex,                 // index of this token in the answer (gen steps)
  // model internals (L layers, d = 112, I = 336, H = 4 heads)
  resid:     Float32Array((L+1)·d),   // residual stream before each layer and after the last
  attnOut:   Float32Array(L·d),       // attention contribution of each layer (after o_proj)
  mlpOut:    Float32Array(L·d),       // MLP contribution (after down_proj);  resid[l+1] = resid[l] + attnOut[l] + mlpOut[l]
  mlpAct:    Float32Array(L·I),       // SwiGLU "neurons": silu(gate)·up
  attnP:     Float32Array(L·H·(pos+1)),  // attention weights of this token over positions 0..pos, per layer and head
  finalNorm: Float32Array(d),         // input of the output layer
  headOut:   Float32Array(L·H·hd),    // attention head outputs (before o_proj)
  vOut:      Float32Array(L·KV·hd),   // value vector of this token (what later tokens read from it)
  // decoding, stage by stage
  logitsRaw:   Float32Array(V),       // model output
  logitsFinal: Float32Array(V),       // after bias, automaton mask, loop penalty; masked tokens = -1e30
  bias:    [{tok, val}],              // word bias (incl. the automaton's +4 to a second piece); forced piece: val = 1e9
  loop:    [{tok, val}],              // loop penalty (off by default)
  forced:  token | -1,                // automaton forced this piece (no sampling)
  form:    index | -1,                // a normal form of a requested word just ended → letter-continuations banned
  allowed: [token],                   // …except these (continuations to other normal forms)
  topk:    [{tok, p}],                // sampling candidates and probabilities after temperature and top-k
  entropy,                            // bits, of that distribution
  sampleR,                            // where the random draw landed, as a share of the probability mass
  words:   [{text, state, k, pieces, used}],  // state: 0 waiting, 1 started (k = 1), 2 assembling (k ≥ lock),
                                              //        3 form just completed, 4 used
  wordsUsed,
  wb: {base, u0, u, t, tau},          // word bias now: base · (u + u0 + 1) · (1 + t / tau)
}
```

Logit lens: `engine.lens(step.resid.subarray(l·d, (l+1)·d))` → Float32Array(V) — what the model would predict from the
residual stream after layer `l` (final RMSNorm + output layer). For `l = L` it equals `logitsRaw` exactly.

"Same text" mode (for comparing settings later): `engine.begin(prompt, words); engine.force(answerTokens)` — every
stage is computed as usual, but the answer tokens are taken from the list instead of being sampled.

## Checks

- `engine/cli model.bin` (native): lens(resid[L]) == logits, residual stream adds up, attention sums to 1, and the
  tokens equal a copy of the firmware loop for the same seed (12 runs).
- `web/engine/test_node.mjs`, `test_replay.mjs` (WebAssembly in Node): on the same text, logits match the native build
  to ~4·10⁻⁶ (float rounding in `expf`/`sqrtf` between libm's); where an int8 KV-cache value sits on a rounding edge,
  up to ~0.2 with the same leading token. Free runs match token for token in 16 of 20 stories.
- Speed in Node: ~1500 steps per second with full tracing.
