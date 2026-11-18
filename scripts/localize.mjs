// Перед публикацией: делает готовые страницы на каждом языке с текстами прямо в HTML (для поисковиков и превью).
// Английский — без префикса (dist/index.html, dist/studio.html), остальные — dist/<язык>/… (dist/ru/studio.html).
// В браузере язык всё равно определяется адресом, так что страницы и без этого шага работают (локальный сервер).
//   node scripts/localize.mjs dist
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] || 'dist';
const ctx = { window: {} };
for (const l of ['en', 'ru']) vm.runInNewContext(readFileSync(`${root}web/i18n/${l}.js`, 'utf8'), ctx);
const D = ctx.window.MQ_DICTS, LANGS = ['en', 'ru'], SITE = 'https://tensorlupa.com/';
const LOCALE = { en: 'en_US', ru: 'ru_RU' };
// страница → путь на сайте и ключи заголовка/описания
const PAGES = { 'index.html': { path: '', title: 'meta.land.title', desc: 'meta.land.desc' }, 'studio.html': { path: 'studio', title: 'meta.studio.title', desc: 'meta.studio.desc' } };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const url = (l, path) => SITE + (l === 'en' ? '' : l + '/') + path;

for (const [file, page] of Object.entries(PAGES)) {
  const src = readFileSync(`${root}web/${file}`, 'utf8');
  for (const l of LANGS) {
    const g = (k) => { const v = D[l][k] ?? D.en[k]; return typeof v === 'string' ? v : null; };
    let html = src, n = 0;
    html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)(<\/\2>)/g, (m, open, tag, key, close) => {
      const v = g(key); if (v == null) return m; n++; return open + esc(v) + close;
    });
    for (const [data, name] of [['data-i18n-title', 'title'], ['data-i18n-ph', 'placeholder']]) {
      html = html.replace(new RegExp(`<[a-z0-9]+\\b[^>]*\\s${data}="([^"]+)"[^>]*>`, 'g'), (m, key) => {
        const v = g(key); if (v == null || new RegExp(`\\s${name}=`).test(m)) return m;
        n++; return m.replace(`${data}="${key}"`, `${data}="${key}" ${name}="${attr(v)}"`);
      });
    }
    const pre = l === 'en' ? '' : l + '/';
    html = html.replace(/<html lang="[^"]*">/, `<html lang="${l}">`)
      .replace(/(<a\b[^>]*\shref=")(\.\/|studio)("[^>]*\sdata-local)/g, (m, a, href, b) => a + pre + (href === './' ? '' : href) + b)
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(g(page.title))}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(g(page.desc))}">`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(g(page.title))}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(g(page.desc))}">`)
      .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url(l, page.path)}">\n` +
        LANGS.map((x) => `<link rel="alternate" hreflang="${x}" href="${url(x, page.path)}">`).join('\n') +
        `\n<link rel="alternate" hreflang="x-default" href="${url('en', page.path)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url(l, page.path)}">\n<meta property="og:locale" content="${LOCALE[l]}">`);
    const dir = l === 'en' ? out : `${out}/${l}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${file}`, html);
    console.log(`${dir}/${file}: ${n} текстов`);
  }
}
