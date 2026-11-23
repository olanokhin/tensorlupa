# micro-qwen3

The model built into TensorLupa, in two versions of the same trained weights:

| File | Weights | Size | Used |
|---|---|---|---|
| `web/model-8bit.bin` | 8-bit, as precise as the original | 1,140,806 bytes (1.14 MB) | the studio's default |
| `web/model.bin` | 4-bit (W4R: one scale per row, found by a per-row search) | 676,934 bytes (0.68 MB) | the option "4-bit", the version that runs on an ESP32-S3 |

- Architecture: Qwen3 (RoPE, grouped-query attention with 4 query / 2 key-value heads, QK-norm, SwiGLU),
  3 layers × 112 dimensions, 4096-token vocabulary, 1,056,656 parameters.
- Tokenizer: byte-level BPE with Qwen3's splitting rule, trained on TinyStories V2.
- Pretraining: from scratch on TinyStories V2, next-token prediction, 124M tokens.
- Instruction tuning: 900,000 dialogues from TinyStoriesInstruct in the Qwen chat format, 150M tokens, with
  quantization-aware training for the 4-bit format from the first step. The 4-bit version loses about 2% of quality
  against 8 bits (0.762 against 0.747 bits per byte).
- On an ESP32-S3 the 4-bit version writes about 60 tokens per second in real use (74 in the bare benchmark).
- Contains no Qwen weights.

`web/corpus-4grams.bin` (2.3 MB) is not part of the model: it holds the four-token phrases seen at least 50 times
in TinyStories V2 with their counts. The studio's repetition penalty uses it to tell a loop from a natural repeat.

How it was made, with every branch that was tried: https://tensorlupa.com/docs/model/how-it-was-made/

Source, training and firmware: the micro-qwen3 project by Alex Anokhin.
