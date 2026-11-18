// Ссылки на ещё не написанные страницы Docs. В тексте их ставим сразу — адреса глоссария зафиксированы заранее, —
// а здесь, после сборки, ссылка на страницу, которой пока нет, превращается в обычный текст. Как только страница
// появится, следующая сборка оставит все упоминания ссылками: переписывать готовые страницы не нужно.
//   node scripts/pending-links.mjs docsite/dist
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'docsite/dist');
const pages = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'index.html') pages.push(p); } };
walk(root);

// внешние адреса, которые ещё не опубликованы (наша модель): упоминания пока текстом
const unpublished = JSON.parse(readFileSync(new URL('../docsite/pending-external.json', import.meta.url), 'utf8')).unpublished;
let fixed = 0;
const missing = new Set();
for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const out = html.replace(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (m, href, rest, inner) => {
    if (unpublished.some((u) => href === u || href.startsWith(u + '/') || href.startsWith(u + '#'))) { fixed++; missing.add(href); return `<span class="tl-pending">${inner}</span>`; }
    if (/^(https?:|mailto:|#)/.test(href) || /class="[^"]*(try-link|tl-)/.test(rest)) return m;
    const target = href.startsWith('/') ? join(root, href.split('#')[0]) : resolve(dirname(file), href.split('#')[0]);
    if (!target.includes(`${root}/docs/glossary/`) && !target.includes(`${root}/ru/docs/glossary/`)) return m;
    if (existsSync(join(target, 'index.html'))) return m;
    missing.add(target.replace(root, '')); fixed++;
    return `<span class="tl-pending">${inner}</span>`;
  });
  // русские страницы, у которых пока нет перевода, показывают английский текст: ссылки в студию — на русскую студию
  const local = file.startsWith(join(root, 'ru') + '/') ? out.replace(/href="\/studio/g, 'href="/ru/studio') : out;
  if (local !== html) writeFileSync(file, local);
}
// список готовых страниц глоссария — студия по нему решает, у каких подсказок показать «Подробнее в Docs»
import { writeFileSync as wf, readdirSync as rd } from 'node:fs';
const ready = rd(join(root, 'docs', 'glossary'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
wf(join(root, 'docs', 'pages.json'), JSON.stringify({ glossary: ready }));
console.log(`готовые страницы глоссария: ${ready.join(', ')}`);
console.log(`ссылок на ещё не написанные страницы: ${fixed}${missing.size ? ' (' + [...missing].sort().join(', ') + ')' : ''}`);
