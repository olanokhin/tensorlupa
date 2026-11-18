# micro-qwen3

`web/model.bin` is the model built into TensorLupa (676,934 bytes, 0.68 MB).

- Architecture: Qwen3 (RoPE, grouped-query attention with 4 query / 2 key-value heads, QK-norm, SwiGLU),
  3 layers × 112 dimensions, 4096-token vocabulary, 1,056,656 parameters.
- Trained from scratch on TinyStories, then fine-tuned to write a short story that uses up to three given words.
- Weights quantized to 4 bits; the same file runs on an ESP32-S3 microcontroller at about 60 tokens per second.
- Contains no Qwen weights.

Source, training and firmware: the micro-qwen3 project by Alex Anokhin.
