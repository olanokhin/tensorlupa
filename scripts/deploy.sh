#!/bin/sh
# Публикация на Cloudflare: чистая копия web/ без служебных файлов → dist/ → wrangler deploy (wrangler.jsonc).
#   sh scripts/deploy.sh             — опубликовать
#   WRANGLER=/путь/к/wrangler sh scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
rsync -a --exclude '.*' --exclude '*.md' --exclude 'engine/test_*.mjs' web/ dist/
(cd docsite && ./node_modules/.bin/astro build --silent) && cp -R docsite/dist/. dist/   # Docs: /docs/… и /ru/docs/…
node scripts/localize.mjs dist   # страницы на каждом языке (/, /studio, /ru/, /ru/studio) с текстами в HTML
${WRANGLER:-wrangler} deploy
