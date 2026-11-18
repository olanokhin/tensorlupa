// Перед публикацией: вписывает английские тексты прямо в HTML (dist/), чтобы поисковики и превью в соцсетях
// видели настоящие слова, а не пустые теги. В браузере скрипт страницы всё равно ставит выбранный язык.
//   node scripts/prerender.mjs dist/index.html dist/studio.html …
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const ctx = { window: {} };
vm.runInNewContext(readFileSync(root + 'web/i18n/en.js', 'utf8'), ctx);
const EN = ctx.window.MQ_DICTS.en;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

for (const file of process.argv.slice(2)) {
  let html = readFileSync(file, 'utf8'), n = 0;
  // <tag … data-i18n="key" …></tag> — только пустые элементы
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)(<\/\2>)/g, (m, open, tag, key, close) => {
    const v = EN[key]; if (typeof v !== 'string') return m; n++; return open + esc(v) + close;
  });
  // подсказки и плейсхолдеры: title="…" / placeholder="…", если их ещё нет
  for (const [data, name] of [['data-i18n-title', 'title'], ['data-i18n-ph', 'placeholder']]) {
    html = html.replace(new RegExp(`<[a-z0-9]+\\b[^>]*\\s${data}="([^"]+)"[^>]*>`, 'g'), (m, key) => {
      const v = EN[key]; if (typeof v !== 'string' || new RegExp(`\\s${name}=`).test(m)) return m;
      n++; return m.replace(`${data}="${key}"`, `${data}="${key}" ${name}="${attr(v)}"`);
    });
  }
  writeFileSync(file, html);
  console.log(`${file}: вписано ${n} текстов`);
}
