// Демо-видео студии: сценарий для Playwright. Часы страницы подменены (page.clock): сценарий сам двигает время на
// 1/30 секунды и снимает кадр, поэтому видео ровно 30 кадров/с при любой скорости съёмки. Кадры: f_00000.jpg, …
// encode.sh собирает из них mp4, постер и gif. Запуск описан в README.md рядом.
// Сценарий (всё в режиме Лаб, окно 1440×900):
//   1. «Generate» — история проигрывается токен за токеном;
//   2. щелчок по слову « saw» в истории, затем по проигравшему кандидату в окне Model — вторая строка счёта;
//   3. наведение на голову в окне Attention (подсвечиваются оба окна), щелчок — история красится её весами;
//   4. в конец истории и ползунок temperature: 0.60 → 1.25 → 0.30 → 0.60, история переписывается на глазах.
async (page) => {
  const URL = 'http://127.0.0.1:8765/studio?w=dragon,cookie,school&seed=1111&q=8&mode=lab';
  const DIR = '.playwright-mcp/demo-take3', FPS = 30;      // DIR — пустая папка для кадров
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('mq.tour.seen', '1'); localStorage.setItem('mq.hint.seen', '1'); });
  // Время генерации в строке статистики студия меряет через performance.now(). Под подменёнными часами оно стоит на месте
  // и вышло бы «0 мс, 133000 ток/с». Поэтому настоящие часы запоминаем до подмены, а после неё прибавляем к подменённым
  // настоящую длительность каждого прогона модели: число на экране остаётся честным.
  await ctx.addInitScript(() => { const now = performance.now.bind(performance); window.__realNow = now; });
  await p.clock.install();
  await p.goto(URL); await p.waitForTimeout(5000);
  await p.clock.pauseAt(new Date(Date.now() + 2000));
  const clockOk = await p.evaluate(() => {
    const real = window.__realNow, fake = performance.now.bind(performance); let off = 0;
    const a = real(), b = fake(); for (let i = 0, x = 0; i < 3e6; i++) x += i;      // настоящие часы идут, подменённые стоят
    const ok = real() > a && fake() === b;
    performance.now = () => fake() + off;
    const e = window.__viz.engine, run = e.run.bind(e); e.run = (...args) => { const t = real(), r = run(...args); off += real() - t; return r; };
    return ok;
  });
  // курсор: на снимках экрана настоящего нет, рисуем свой
  await p.evaluate(() => {
    const c = document.createElement('div'); c.id = 'demo-cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:99999;pointer-events:none;transform:translate(-100px,-100px)';
    c.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l15 7.5-6.2 1.9L9.6 18z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    addEventListener('mousedown', () => { c.style.scale = '0.8'; }, true); addEventListener('mouseup', () => { c.style.scale = '1'; }, true);
  });
  let n = 0, mx = 720, my = 450; const t0 = Date.now();
  const tick = async (k = 1) => { for (let i = 0; i < k; i++) { await p.clock.runFor(1000 / FPS); await p.screenshot({ path: `${DIR}/f_${String(n++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 }); } };
  const wait = (ms) => tick(Math.round(ms * FPS / 1000));
  const move = async (x, y, ms = 500) => { const k = Math.max(4, Math.round(ms * FPS / 1000));
    for (let i = 1; i <= k; i++) { const u = i / k, e = u * u * (3 - 2 * u); await p.mouse.move(mx + (x - mx) * e, my + (y - my) * e); await tick(); } mx = x; my = y; };
  const center = async (sel, nth = 0) => { const b = await p.locator(sel).nth(nth).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const press = async () => { await p.mouse.down(); await tick(2); await p.mouse.up(); await tick(1); };
  const click = async (x, y, ms) => { await move(x, y, ms); await tick(3); await press(); };
  await p.mouse.move(mx, my);

  await wait(400);
  // 1. Generate
  await click(...await center('#gen'), 600); await move(900, 770, 500); await wait(5400);
  // 2. слово в истории, затем проигравший кандидат
  const saw = await p.evaluate(() => { const e = [...document.querySelectorAll('#story-text .tok')].find((x) => x.textContent === ' saw'); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  await click(...saw, 600); await wait(700);
  await click(...await center('.v3-out > a', 1), 800); await move(mx - 150, my - 110, 500); await wait(2200);
  await click(...await center('.v3-out > a', 0), 600); await wait(300);
  // 3. голова во «Внимании»
  const c = await p.locator('#attn-canvas').boundingBox(), ry = await p.evaluate(() => window.__viz.attn.geometry().rowY(1, 3) + 5);
  await move(c.x + 250, c.y + ry, 800); await wait(1300);
  await press(); await wait(1900);
  // 4. в конец истории и температура
  await click(...await center('#t-last'), 800); await wait(300);
  const r = await p.locator('.ctl-slider input[type=range]').first().boundingBox(), X = (v) => r.x + 8 + (r.width - 16) * (v - 0.05) / 1.45, Y = r.y + r.height / 2;
  await move(X(0.6), Y, 800); await tick(3); await p.mouse.down(); await tick(2);
  await move(X(1.25), Y, 1000); await wait(1400);
  await move(X(0.3), Y, 1200); await wait(1400);
  await move(X(0.6), Y, 800); await p.mouse.up(); await wait(1200);

  const stat = await p.evaluate(() => document.getElementById('story-sub').textContent);
  const temp = await p.evaluate(() => document.querySelector('.ctl-slider .ctl-v').value);
  await p.evaluate(() => localStorage.clear()); await ctx.close();
  return { frames: n, videoSeconds: n / FPS, tookSeconds: (Date.now() - t0) / 1000, temp, clockOk, stat, errs };
}
