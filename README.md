# micro-qwen3 editor

An interactive, desktop-first editor that runs the same C engine as the ESP32-S3 firmware in the browser
(WebAssembly), records every step of a run and lets you scrub back to any token.

```bash
sh viz/build.sh          # WebAssembly engine + native check tool + copies the demo model to viz/web/model.bin
sh viz/build.sh check    # …and run the checks (needs node)
python3 viz/serve.py     # http://127.0.0.1:8765 (no-cache dev server)
```

Panels: 3D model view (residual stream plates, attention heads, MLP neurons, strongest flow lines; click a plate
to see its values, logit lens and neuron effects), attention (3D stack or 2D grid, "where it looks" vs
"contribution", quadratic growth chart), logits strip (all decoding stages), story with timeline, settings and
inspector. The trace format is described in [TRACE.md](TRACE.md).

The firmware is unaffected: tracing code in `esp/microqwen.c` is compiled only with `-DMQ_TRACE`.
