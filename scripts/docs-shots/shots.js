// Скриншоты для Docs: один сценарий для всех статей и всех языков. Запуск описан в README.md рядом.
// Функция для Playwright: открывает студию на языке LANG в окне 1440×900 (×2), для каждой статьи ставит нужный шаг,
// режим и выбор, обводит то, о чём статья (остальное приглушает) и сохраняет PNG в .playwright-mcp/shots-<язык>/.
// convert.sh превращает их в WebP в docsite/src/assets (английские) или docsite/src/assets/<язык>/.
// Новая статья со скриншотом = новая строка в SHOTS. Ссылка здесь та же, что в статье, но без настроек, которые статья
// предлагает выключить (у min-p и штрафа за повторы снимок сделан с включённой настройкой).
async (page) => {
  const LANG = '__LANG__', ONLY = '__ONLY__';          // подставляет run.sh; ONLY — имена через запятую или пусто (все)
  const D = 'w=dragon,cookie,school&seed=1111';
  // [имя файла, запрос, режим, выбор, что обвести]
  // выбор: ['plate', группа пластин, слой с нуля, плитка] или ['head', слой с нуля, голова с нуля]
  // обвести: model, attn, logits, story, player, field (режим и поле слов), dice, card:sampling, card:order, card:lead, card:sel
  const SHOTS = [
    ['language-model', `${D}&s=70`, 'lab', null, ['model', 'story', 'player']],
    ['token', `${D}&s=62`, 'lab', null, ['story']],
    ['prompt', `${D}&s=28`, 'lab', null, ['field', 'story']],
    ['special-tokens', `${D}&s=160`, 'lab', null, ['model', 'story']],
    ['completion', 'p=Once%20upon%20a%20time%2C%20a%20little%20dog&seed=1149&s=7', 'lab', null, ['field', 'story']],
    ['instruct', `${D}&s=28`, 'lab', null, ['field', 'story']],
    ['transformer', `${D}&s=32`, 'guide', null, ['model']],
    ['residual-stream', `${D}&s=47`, 'lab', ['plate', 'res', 2, 56], ['model', 'card:sel']],
    ['attention', `${D}&s=66`, 'lab', null, []],
    ['attention-head', `${D}&s=66`, 'lab', ['head', 2, 3], []],
    ['mlp', `${D}&s=58`, 'lab', ['plate', 'mlp', 2, 178], ['model', 'card:sel']],
    ['logit-lens', `${D}&s=65`, 'lab', ['plate', 'res', 2, 56], ['model', 'card:sel']],
    ['logits', `${D}&s=49`, 'guide', null, ['logits']],
    ['sampling', `${D}&s=67`, 'lab', null, ['card:sampling', 'logits']],
    ['entropy', `${D}&s=93`, 'guide', null, ['logits', 'card:lead']],
    ['temperature', `${D}&s=49`, 'guide', null, ['card:sampling', 'logits']],
    ['top-k', `${D}&s=67`, 'lab', null, ['card:sampling', 'logits']],
    ['seed', 'w=dragon,cookie,school&seed=147&s=60', 'guide', null, ['dice', 'card:sampling']],
    ['max-new-tokens', `${D}&n=30&s=57`, 'lab', null, ['card:sampling', 'story']],
    ['logit-bias', `${D}&s=58`, 'lab', null, ['logits', 'card:order']],
    ['fsm', 'w=play,luxury,shiny&seed=2&s=49', 'lab', null, ['model', 'logits']],
    ['min-p', 'w=shoot,zigzag,mighty&seed=7001&s=81', 'lab', null, ['card:sampling', 'logits']],
    ['repetition-penalty', 'w=tall,tree,climb&seed=264&s=63', 'guide', null, ['card:sampling', 'card:lead']],
  ];
  const only = ONLY && !ONLY.startsWith('__') ? ONLY.split(',') : null, base = `http://127.0.0.1:8765/${LANG === 'en' ? '' : LANG + '/'}studio`;
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = [], done = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('mq.tour.seen', '1'); localStorage.setItem('mq.hint.seen', '1'); });
  for (const [name, q, mode, sel, frames] of SHOTS) {
    if (only && !only.includes(name)) continue;
    await p.goto(`${base}?${q}&q=8&mode=${mode}`); await p.waitForTimeout(4500);
    const info = await p.evaluate(async ([sel, frames]) => {
      const S = window.__viz, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (sel && sel[0] === 'plate') { S.v3d.select(S.v3d[sel[1]][sel[2]], sel[3]); await wait(1600); }
      if (sel && sel[0] === 'head') { S.attn.sel = { layer: sel[1], head: sel[2] }; S.attn.draw(); S.attn.onSelect(S.attn.sel); await wait(400); }
      const card = (k) => { const cs = S.deck.cards.filter((c) => c.el.offsetHeight > 0);
        const c = k === 'lead' ? cs[0] : k === 'sel' ? cs.find((x) => x.key.includes('#d')) : cs.find((x) => x.key === k); if (c) c.el.scrollIntoView({ block: 'nearest' }); return c && c.el; };
      const el = (f) => f.startsWith('card:') ? card(f.slice(5)) : f === 'field' ? document.querySelector('.order .field') : f === 'dice' ? document.getElementById('reroll')
        : document.getElementById({ model: 'view-model', attn: 'view-attn', logits: 'logits', story: 'story', player: 'player' }[f]);
      const els = frames.map(el); await wait(200);
      const boxes = els.map((e, i) => { if (!e) return null; const r = e.getBoundingClientRect(), pad = frames[i] === 'dice' || frames[i] === 'field' ? 5 : 0;
        return { x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: Math.min(r.height, innerHeight - r.top - 2) + 2 * pad }; });
      const missing = frames.filter((f, i) => !boxes[i]), bs = boxes.filter(Boolean);
      if (bs.length) { const W = innerWidth, H = innerHeight, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99998;pointer-events:none');
        svg.innerHTML = `<defs><mask id="dm"><rect width="${W}" height="${H}" fill="#fff"/>${bs.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="#000"/>`).join('')}</mask></defs>` +
          `<rect width="${W}" height="${H}" fill="rgba(8,9,11,0.55)" mask="url(#dm)"/>` + bs.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="none" stroke="#f2b33d" stroke-width="2"/>`).join('');
        document.body.appendChild(svg); }
      return { missing, v3d: !!S.v3d, step: S.cur }; }, [sel, frames]);
    await p.mouse.move(720, 896); await p.waitForTimeout(400);
    await p.screenshot({ path: `.playwright-mcp/shots-${LANG}/${name}-studio.png` });
    done.push(name + (info.missing.length ? ' (не найдено: ' + info.missing.join(',') + ')' : '') + (info.v3d ? '' : ' (нет 3D)'));
  }
  await p.evaluate(() => localStorage.clear()); await ctx.close();
  return { lang: LANG, shots: done.length, done, errs };
}
