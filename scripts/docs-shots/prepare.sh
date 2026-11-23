#!/bin/sh
# Копия сценария с подставленным языком (и, если нужно, списком имён): sh scripts/docs-shots/prepare.sh ru [имена,через,запятую] [куда]
set -e
L="${1:-en}"; ONLY="${2:-}"; OUT="${3:-shots-$L.js}"
sed -e "s/__LANG__/$L/" -e "s/__ONLY__/$ONLY/" "$(dirname "$0")/shots.js" > "$OUT"
echo "$OUT"
