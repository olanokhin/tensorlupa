// Картинка превью для соцсетей (web/media/og.png, 1200×630). Запуск: локальный сайт на 8765, эта функция — в Playwright;
// снимок сохраняется в .playwright-mcp/og.png, его копируют в web/media/og.png.
// Пример на карточке настоящий: история по умолчанию (dragon, cookie, school; seed 1111; 8 бит), шаг 75,
// «…and Lily wanted to [be] friends with it.» Шансы кандидатов сняты со студии: play 50, be 27, touch 22, see 2.
// Если история по умолчанию изменится, пример нужно снять заново.
async (page) => {
  const ROWS = [['play', 50], ['be', 27, true], ['touch', 22], ['see', 2]];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 1200px; height: 630px; overflow: hidden; background: #17191d; color: #f1f2f4;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      background-image: radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1.2px); background-size: 22px 22px; }
    .left { position: absolute; left: 72px; top: 98px; width: 500px; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 28px; font-weight: 650; letter-spacing: -0.01em; }
    .brand img { width: 44px; height: 44px; }
    h1 { margin-top: 38px; font-size: 67px; line-height: 1.04; font-weight: 700; letter-spacing: -0.03em; }
    .sub { margin-top: 30px; font-size: 24px; line-height: 1.42; color: #b4b9c2; }
    .url { margin-top: 34px; font: 600 21px ui-monospace, SFMono-Regular, Menlo, monospace; color: #f2b33d; }
    .card { position: absolute; left: 608px; top: 143px; width: 520px; padding: 30px 32px 28px; border-radius: 24px; background: #24262b;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.13), 0 30px 60px rgba(0,0,0,0.35); }
    .lab { font-size: 15px; color: #8a909a; }
    .line { margin-top: 16px; font: 26px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
    .line b { font-weight: 500; background: #e9a93a; color: #1b1c1f; border-radius: 6px; padding: 2px 6px; }
    .line i { font-style: normal; color: #8a909a; }
    .rows { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.09); }
    .row { display: grid; grid-template-columns: 112px 1fr 64px; align-items: center; height: 34px; font: 22px ui-monospace, SFMono-Regular, Menlo, monospace; color: #c9cdd4; }
    .row .t { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.07); overflow: hidden; }
    .row .t span { display: block; height: 100%; border-radius: 4px; background: #9a7fd6; }
    .row .p { text-align: right; color: #b4b9c2; }
    .row.on, .row.on .p { color: #f2b33d; } .row.on .t span { background: #f2b33d; }
  </style></head><body>
    <div class="left">
      <div class="brand"><img src="/media/logo.svg" alt="">TensorLupa</div>
      <h1>A magnifying glass for neural networks</h1>
      <p class="sub">A real language model runs in your browser.<br>See every word it weighs and picks.</p>
      <p class="url">tensorlupa.com</p>
    </div>
    <div class="card">
      <div class="lab">The model chose between</div>
      <div class="line">Lily wanted to <b>be</b><i> friends\nwith it.</i></div>
      <div class="rows">${ROWS.map(([w, p, on]) => `<div class="row${on ? ' on' : ''}"><span>·${w}</span><span class="t"><span style="width:${p}%"></span></span><span class="p">${p}%</span></div>`).join('')}</div>
    </div>
  </body></html>`;
  const ctx = await page.context().browser().newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/404.html'); await p.setContent(html); await p.waitForTimeout(600);
  await p.screenshot({ path: '.playwright-mcp/og.png' });
  await ctx.close(); return 'ok';
}
