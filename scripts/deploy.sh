#!/bin/sh
# Публикация на Cloudflare: чистая копия web/ без служебных файлов → dist/ → wrangler deploy (wrangler.jsonc).
#   sh scripts/deploy.sh             — опубликовать
#   WRANGLER=/путь/к/wrangler sh scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
rsync -a --exclude '.*' --exclude '*.md' --exclude 'engine/test_*.mjs' web/ dist/
${WRANGLER:-wrangler} deploy
