#!/bin/sh
# Refresh the engine copy from a micro-qwen3 checkout: sh scripts/sync-engine.sh ../micro-qwen3
set -e
SRC=${1:-../micro-qwen3}
cd "$(dirname "$0")/.."
REV=$(git -C "$SRC" rev-parse --short HEAD)
for f in microqwen.c microqwen.h; do
  { printf '// Copy of esp/%s from micro-qwen3 (commit %s) — the same C engine as the ESP32-S3 firmware.\n// Update with scripts/sync-engine.sh; do not edit here.\n' "$f" "$REV"; cat "$SRC/esp/$f"; } > "engine/$f"
done
echo "engine synced from micro-qwen3 $REV"
