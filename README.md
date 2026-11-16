# TensorLupa

A magnifying glass for neural networks: a real language model running in your browser, with every step of its
work laid out — the story token by token, the logits it chose from, where attention looks, and what flows
through each layer. Scrub back to any token, move a slider and watch the story rewrite itself.

The built-in model is [micro-qwen3](models/README.md): the Qwen3 architecture at about one million parameters,
trained from scratch. The engine is the same C code that runs it on an ESP32-S3 microcontroller, compiled to
WebAssembly with tracing turned on.

Live preview: https://tensorlupa.vercel.app

## Run locally

```bash
sh build.sh          # WebAssembly engine (needs emcc) + native check tool + copies the model to web/model.bin
sh build.sh check    # …and run the checks (needs node)
python3 serve.py     # http://127.0.0.1:8765 (no-cache dev server)
```

The engine sources in `engine/microqwen.{c,h}` are a copy from micro-qwen3; refresh them with
`sh scripts/sync-engine.sh <path to micro-qwen3>`. The trace format is described in [TRACE.md](TRACE.md).

## License

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). TensorLupa by Alex Anokhin.
