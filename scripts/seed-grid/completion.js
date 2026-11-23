// Перебор seed для режима Completion (8 бит, настройки студии по умолчанию). Критерии — как у заказов Instruct:
// история закончилась сама, мало повторов; дальше лучшие читаются глазами.
async (page) => {
  const PROMPTS = { a: 'Once upon a time', b: 'Once upon a time, a little dog', c: 'Write a short story. Use the words: dragon, cookie, school.' };
  const FROM = 1, TO = 1500, CHUNK = 150;
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/'); await p.evaluate(() => { localStorage.setItem('mq.tour.seen', '1'); localStorage.setItem('mq.hint.seen', '1'); });
  await p.goto('http://127.0.0.1:8765/studio?p=Once%20upon%20a%20time&seed=1111&q=8&mode=lab'); await p.waitForTimeout(5000);
  const ready = await p.evaluate(() => !!window.__viz.engine.corpus);
  const out = { ready };
  for (const [key, prompt] of Object.entries(PROMPTS)) {
    const all = [];
    for (let s0 = FROM; s0 <= TO; s0 += CHUNK) {
      const part = await p.evaluate(([prompt, s0, s1]) => { const e = window.__viz.engine, T = e.tokenText, res = [];
        for (let seed = s0; seed <= s1; seed++) {
          e.settings({ temperature: 0.6, topK: 40, seed, wbBase: 2, wbTau: 100, wbStart: 0.5, fsm: true, corpusPenalty: true, minP: 0.02, maxNew: 200 });
          const run = e.run(prompt, ''), gen = run.steps.filter((x) => x.kind === 'gen'), last = gen[gen.length - 1];
          const ended = last && last.output <= 2, text = gen.filter((x) => x.output > 2).map((x) => T[x.output]).join('');
          const w = text.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean), tri = new Map(); let rep = 0;
          for (let i = 0; i + 2 < w.length; i++) { const k = w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]; tri.set(k, (tri.get(k) || 0) + 1); }
          for (const v of tri.values()) if (v > 1) rep += v - 1;
          const sents = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean), dupSent = sents.length - new Set(sents).size;
          res.push([seed, ended ? 1 : 0, gen.length, rep, dupSent, text]);
        }
        return res; }, [prompt, s0, Math.min(TO, s0 + CHUNK - 1)]);
      all.push(...part);
    }
    const ended = all.filter((r) => r[1]).length;
    const good = all.filter((r) => r[1] && r[3] <= 2 && r[4] === 0 && r[2] >= 70 && r[2] <= 150).sort((a, b) => a[3] - b[3] || Math.abs(a[2] - 110) - Math.abs(b[2] - 110));
    out[key] = { n: all.length, ended, good: good.length, repMedian: all.map((r) => r[3]).sort((x, y) => x - y)[all.length >> 1], cur: all.find((r) => r[0] === 1111).slice(0, 5), top: good.slice(0, 14).map((r) => [r[0], r[2], r[3], r[5]]) };
  }
  await ctx.close(); return out;
}
