#!/bin/sh
# Сборка демо-видео из кадров record.js (f_00000.jpg, f_00001.jpg, … по 30 в секунду).
#   sh scripts/demo-video/encode.sh <папка с кадрами>
# Результат: web/media/demo.mp4 (1440×900, 30 кадров/с), web/media/demo-poster.jpg, docs/demo.gif (720 по ширине).
set -e
FR="$1"; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ffmpeg -y -loglevel error -framerate 30 -i "$FR/f_%05d.jpg" -vf "format=yuv420p" -c:v libx264 -preset slow -crf 28 -movflags +faststart -an "$ROOT/web/media/demo.mp4"
ffmpeg -y -loglevel error -ss "${POSTER_AT:-10}" -i "$ROOT/web/media/demo.mp4" -frames:v 1 -q:v 3 "$ROOT/web/media/demo-poster.jpg"
ffmpeg -y -loglevel error -i "$ROOT/web/media/demo.mp4" -vf "fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "$ROOT/docs/demo.gif"
ls -la "$ROOT/web/media/demo.mp4" "$ROOT/web/media/demo-poster.jpg" "$ROOT/docs/demo.gif"
