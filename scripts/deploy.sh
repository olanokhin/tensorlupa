#!/bin/sh
# Публикация на Cloudflare: чистая копия web/ без служебных файлов → dist/ → wrangler deploy (wrangler.jsonc).
#   sh scripts/deploy.sh             — опубликовать
#   WRANGLER=/путь/к/wrangler sh scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
rsync -a --exclude '.*' --exclude '*.md' --exclude 'engine/test_*.mjs' web/ dist/
node scripts/glossary.mjs   # таблица терминов и страница-словарик Docs из web/i18n/glossary.js; при расхождениях выкатка останавливается
# Docs: /docs/… и /ru/docs/…. Каждый шаг отдельной строкой: в цепочке через && упавшая сборка Docs не останавливала
# выкладку (set -e на такие цепочки не действует), и сайт уходил без Docs. Последняя проверка — на тот же случай.
(cd docsite && ./node_modules/.bin/astro build --silent)
node scripts/pending-links.mjs docsite/dist
cp -R docsite/dist/. dist/
test -f dist/docs/index.html || { echo "deploy: в сборке нет Docs, выкладка остановлена" >&2; exit 1; }
node scripts/localize.mjs dist   # страницы на каждом языке (/, /studio, /ru/, /ru/studio) с текстами в HTML
${WRANGLER:-wrangler} deploy
