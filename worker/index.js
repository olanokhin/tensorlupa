// TensorLupa на Cloudflare: статика отдаётся сама (assets), сюда приходят только /api/*.
//   POST /api/run    {id}  — студия написала историю: +1 прогон; новый id — +1 человек
//   GET  /api/stats        — { runs, users } для главной
// Счётчик — один Durable Object: он обрабатывает запросы строго по очереди, поэтому одновременные «+1» не теряются.
// Личных данных нет: id — случайная строка из localStorage браузера, текст историй и слова не отправляются.
// Защита от накрутки: не чаще LIMIT прогонов в минуту с одного id и с одного адреса (адрес хранится только в памяти
// объекта, в виде хеша, и забывается через минуту).

import { DurableObject } from 'cloudflare:workers';

const ID_RE = /^[a-z0-9]{16,40}$/;
const LIMIT = 60;   // живой человек с кубиком до этого не доходит; ограничение только против скриптов

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const stub = env.COUNTER.get(env.COUNTER.idFromName('global'));
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      const r = await stub.stats();
      return json(r, { 'cache-control': 'public, max-age=30' });
    }
    if (url.pathname === '/api/run' && request.method === 'POST') {
      let id = '';
      try { id = String((await request.json()).id || ''); } catch { /* пустое тело */ }
      if (!ID_RE.test(id)) return json({ ok: false }, {}, 400);
      const ip = request.headers.get('cf-connecting-ip') || '';
      const ok = await stub.run(id, await hash(ip));
      return json({ ok }, {}, ok ? 200 : 429);
    }
    return json({ error: 'not found' }, {}, 404);
  },
};

export class Counter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, first INTEGER, runs INTEGER);
                   CREATE TABLE IF NOT EXISTS totals (k TEXT PRIMARY KEY, v INTEGER);
                   INSERT OR IGNORE INTO totals VALUES ('runs', 0);`);
    this.recent = new Map();                               // ключ → [минута, сколько] — только в памяти
  }
  limited(key, minute) {
    const r = this.recent.get(key);
    if (!r || r[0] !== minute) { this.recent.set(key, [minute, 1]); return false; }
    return ++r[1] > LIMIT;
  }
  async run(id, ipHash) {
    const minute = Math.floor(Date.now() / 60000);
    if (this.recent.size > 5000) for (const [k, v] of this.recent) if (v[0] !== minute) this.recent.delete(k);
    if (this.limited('u' + id, minute) || this.limited('a' + ipHash, minute)) return false;
    this.sql.exec(`INSERT INTO users VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET runs = runs + 1`, id, Date.now());
    this.sql.exec(`UPDATE totals SET v = v + 1 WHERE k = 'runs'`);
    return true;
  }
  async stats() {
    const runs = this.sql.exec(`SELECT v FROM totals WHERE k = 'runs'`).one().v;
    const users = this.sql.exec(`SELECT COUNT(*) AS n FROM users`).one().n;
    return { runs, users };
  }
}

const json = (obj, headers = {}, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tensorlupa:' + s));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
