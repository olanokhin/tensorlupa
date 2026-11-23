#!/bin/sh
# PNG из сценария → WebP в ассеты Docs: sh scripts/docs-shots/convert.sh <язык> <папка с PNG>
set -e
L="$1"; FR="$2"; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$L" = "en" ]; then OUT="$ROOT/docsite/src/assets"; else OUT="$ROOT/docsite/src/assets/$L"; fi
mkdir -p "$OUT"; n=0
for f in "$FR"/*-studio.png; do cwebp -quiet -q 82 "$f" -o "$OUT/$(basename "${f%.png}").webp"; n=$((n+1)); done
echo "$n → $OUT"
