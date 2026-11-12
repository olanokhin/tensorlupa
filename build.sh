#!/bin/sh
# Сборка движка визуализации: WebAssembly для браузера + нативная программа проверки, затем проверки.
#   sh viz/build.sh            — собрать
#   sh viz/build.sh check      — собрать и проверить (нужна модель esp/models/tsim900-sft-x-w4r.bin и node)
set -e
cd "$(dirname "$0")"
MODEL=../esp/models/tsim900-sft-x-w4r.bin
SRC="engine/viz.c ../esp/microqwen.c"
FUNCS=$(grep -oE "^[a-z].* \*?(viz_[a-z_]+)\(" engine/viz.h | grep -oE "viz_[a-z_]+" | sed "s/.*/'_&'/" | paste -sd, -)

emcc -O2 -std=c11 -DMQ_TRACE $SRC -o web/engine/mqviz.js \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createMQViz -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web,node \
  -s "EXPORTED_FUNCTIONS=[$FUNCS,'_malloc','_free']" \
  -s "EXPORTED_RUNTIME_METHODS=['cwrap','HEAPU8','HEAP32','HEAPF32','UTF8ToString']"
cc -O2 -Wall -Wextra -std=c11 -DMQ_TRACE -o engine/cli engine/cli.c $SRC -lm
cp "$MODEL" web/model.bin
echo "собрано: web/engine/mqviz.{js,wasm}, engine/cli, web/model.bin"

if [ "$1" = check ]; then
  engine/cli "$MODEL" | tail -1
  T=$(mktemp)
  for o in "play luxury shiny:1" "swim octopus funny:2" "moon:1"; do
    w=${o%:*}; seed=${o##*:}
    engine/cli "$MODEL" --dump "$w" "$seed" "$T" > /dev/null
    printf '[%s, %s] ' "$w" "$seed"; node web/engine/test_replay.mjs "$MODEL" "$w" "$T"
  done
  rm -f "$T"
fi
