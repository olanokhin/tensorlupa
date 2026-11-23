// Сверка перевода статьи Docs с английским оригиналом. Перевод меняет слова, а числа, ссылки, таблицы и картинки должны
// остаться теми же.   node scripts/docs-i18n-check.mjs ru [имя-статьи ...]   (без имён — все переведённые статьи)
// Проверяет: числа (с поправкой на запись: 4,096 → 4096, 0.6 → 0,6), адреса ссылок (ссылки в студию получают префикс
// языка), число заголовков, строк таблиц, блоков кода и картинок, путь картинок (assets/<язык>/), отсутствие длинных тире.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const [lang, ...names] = process.argv.slice(2);
if (!lang) { console.error('язык?'); process.exit(2); }
const root = new URL('../docsite/src/content/docs/', import.meta.url).pathname;
const walk = (d, pre = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`, `${pre}${e.name}/`) : e.name.endsWith('.mdx') ? [pre + e.name] : []);
const files = (names.length ? names.map((n) => n.replace(/^\.\//, '').replace(/\.mdx$/, '')).map((n) => (n.includes('/') || n === 'index' ? n : `glossary/${n}`) + '.mdx') : walk(`${root}${lang}/docs`)).filter((f) => f !== 'terms.mdx');
const body = (s) => s.replace(/^---[\s\S]*?---/, '');
const nums = (s, l) => { let t = body(s).replace(/\]\([^)]*\)/g, ' ').replace(/href="[^"]*"/g, ' ').replace(/`[^`]*`/g, ' ').replace(/[−–]/g, '-');
  t = l === 'en' ? t.replace(/(\d),(?=\d{3}\b)/g, '$1') : t.replace(/(\d)[  ](?=\d{3}\b)/g, '$1').replace(/(\d),(?=\d)/g, '$1.');
  return (t.match(/\d+(?:\.\d+)?/g) || []).map(Number).sort((a, b) => a - b); };
const links = (s, l) => [...body(s).matchAll(/\]\(([^)\s]+)\)|href="([^"]+)"/g)].map((m) => m[1] || m[2]).filter((u) => !/\.webp$/.test(u))
  .map((u) => u.replace(new RegExp(`^/${l}/studio`), '/studio').replace(/^https:\/\/[a-z]{2}\.wikipedia\.org\/wiki\/.*/, 'wikipedia')).sort();
const count = (s, re) => (body(s).match(re) || []).length;
let bad = 0;
for (const f of files) {
  const pe = `${root}docs/${f}`, pl = `${root}${lang}/docs/${f}`, out = [];
  if (!existsSync(pl)) { console.log(`— ${f}: перевода нет`); continue; }
  if (!existsSync(pe)) { console.log(`✗ ${f}: нет английского оригинала`); bad++; continue; }
  const en = readFileSync(pe, 'utf8'), tr = readFileSync(pl, 'utf8');
  const a = nums(en, 'en'), b = nums(tr, lang), miss = [...a], extra = [];
  for (const x of b) { const i = miss.indexOf(x); if (i >= 0) miss.splice(i, 1); else extra.push(x); }
  if (miss.length || extra.length) out.push(`числа: нет в переводе [${miss.join(', ')}], лишние [${extra.join(', ')}]`);
  const la = links(en, 'en'), lb = links(tr, lang);
  if (la.join('\n') !== lb.join('\n')) out.push(`ссылки: нет [${la.filter((x) => !lb.includes(x)).join(' ')}], лишние [${lb.filter((x) => !la.includes(x)).join(' ')}]`);
  for (const [name, re] of [['заголовки', /^#{2,3} /gm], ['строки таблиц', /^\|/gm], ['картинки', /!\[/g], ['блоки кода', /^```/gm]])
    if (count(en, re) !== count(tr, re)) out.push(`${name}: ${count(en, re)} в оригинале, ${count(tr, re)} в переводе`);
  if (/—/.test(tr)) out.push('есть длинное тире');
  for (const m of tr.matchAll(/\]\(([^)]*\.webp)\)/g)) if (!m[1].includes(`/assets/${lang}/`)) out.push(`картинка не из assets/${lang}/: ${m[1]}`);
  if (!/^---\ntitle: .+\ndescription: .+\n---/.test(tr)) out.push('нет заголовка title/description');
  for (const m of tr.slice(0, tr.indexOf('\n---', 4)).matchAll(/^(title|description): (.*)$/gm))       // двоеточие в YAML без кавычек ломает сборку
    if (!/^["']/.test(m[2]) && /: /.test(m[2])) out.push(`${m[1]}: двоеточие с пробелом без кавычек, возьмите значение в кавычки`);
  if (out.length) { bad++; console.log(`✗ ${f}\n   - ${out.join('\n   - ')}`); } else console.log(`✓ ${f}`);
}
process.exit(bad ? 1 : 0);
