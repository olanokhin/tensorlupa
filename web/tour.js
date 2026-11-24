// Тур по Гайду: подсветка одной или нескольких панелей (остальное затемнено) и стеклянная карточка с текстом.
// Шаг: { key, anchor: селектор, функция (возвращает элемент) или их массив, before(), actions: [{ label, fn }] } — у последнего шага действия
// («впишите свои слова», «бросьте кубик», «откройте Лаб»): тур заканчивается следующим шагом, а не ничем.
// Ещё у шага могут быть: leave() — вызывается при уходе с шага (вернуть то, что шаг подвигал); live: true — подсветка
// следит за элементами всё время шага, а не только первую секунду (шаг сам двигает окна); place(w, h) → { x, y } —
// своё место карточки.
// Esc или «Пропустить» — выход; стрелки листают тур, а не плеер.

export function startTour(steps, t, { onEnd } = {}) {
  let i = 0;
  const NS = 'http://www.w3.org/2000/svg';
  const shade = document.createElementNS(NS, 'svg'); shade.setAttribute('class', 'tour-shade-svg');
  const path = document.createElementNS(NS, 'path'); path.setAttribute('fill-rule', 'evenodd'); shade.appendChild(path);
  const rings = document.createElement('div'); rings.className = 'tour-rings';
  const card = document.createElement('div'); card.className = 'cc-mod tour-card';
  document.body.append(shade, rings, card);

  // затемнение с «окнами»: внешний прямоугольник + скруглённые прямоугольники панелей (evenodd вырезает их)
  const rr = (x, y, w, h, r) => `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}` +
    `H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
  // Где сейчас подсвечиваемые элементы. Окна студии можно переставлять, сворачивать и складывать во вкладки, поэтому
  // место каждый раз берётся у самого элемента, а скрытые и пустые элементы пропускаются.
  const measure = () => {
    const s = steps[i], list = s.anchor ? [].concat(s.anchor) : [];
    return list.map((q) => (typeof q === 'function' ? q() : document.querySelector(q))).filter((el) => el && !el.closest('[hidden]'))
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight)
      .map((r) => ({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 }));
  };
  let acts = [], follow = 0, last = '';
  // подсветка и место карточки по текущему положению элементов; вызывается много раз, пока окна доезжают
  const fit = () => {
    const rects = measure(), key = JSON.stringify(rects) + innerWidth + 'x' + innerHeight;
    if (key === last) return; last = key;
    shade.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    path.setAttribute('d', `M0,0H${innerWidth}V${innerHeight}H0Z` + rects.map((r) => rr(r.x, r.y, r.w, r.h, 16)).join(''));
    rings.innerHTML = rects.map((r) => `<i style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></i>`).join('');
    position(rects);
  };
  const place = () => {
    const s = steps[i];
    s.before?.();
    acts = s.actions || []; last = '';
    card.innerHTML = `<div class="tc-n">${i + 1} / ${steps.length}</div><div class="tc-title">${t(s.key + '.title')}</div><p>${t(s.key + '.body')}</p>` +
      (acts.length ? `<div class="tc-acts">${acts.map((a, k) => `<button class="tc-act" data-k="${k}">${a.label}</button>`).join('')}</div>` : '') +
      `<div class="tc-btns"><button class="tc-skip">${t(i === steps.length - 1 ? 'tour.close' : 'tour.skip')}</button><span class="tc-sp"></span>` +
      `${i ? `<button class="tc-back">${t('tour.back')}</button>` : ''}` +
      (i === steps.length - 1 ? '' : `<button class="tc-next">${t('tour.next')}</button>`) + '</div>';
    card.querySelector('.tc-next')?.addEventListener('click', () => go(i + 1));
    card.querySelector('.tc-skip').onclick = end;
    const b = card.querySelector('.tc-back'); if (b) b.onclick = () => go(i - 1);
    card.querySelectorAll('.tc-act').forEach((el) => { el.onclick = () => { end(); acts[Number(el.dataset.k)].fn(); }; });
    (card.querySelector('.tc-next') || card.querySelector('.tc-act'))?.focus({ preventScroll: true });
    fit();
    // before() часто раскрывает панель или переключает вкладку, и окна ещё едут на место: подсветка идёт за ними
    cancelAnimationFrame(follow); const until = performance.now() + 900;
    const loop = () => { fit(); if (s.live || performance.now() < until) follow = requestAnimationFrame(loop); };
    follow = requestAnimationFrame(loop);
  };
  const position = (rects) => {
    // карточка — рядом с первой панелью: справа, слева, снизу или сверху, где помещается; иначе по центру
    const r = rects[0], w = card.offsetWidth, h = card.offsetHeight, m = 16;
    let x = innerWidth / 2 - w / 2, y = innerHeight / 2 - h / 2;
    const own = steps[i].place?.(w, h);
    if (own) { x = own.x; y = own.y; }
    else if (r && rects.length === 1) {
      if (r.x + r.w + m + w < innerWidth) { x = r.x + r.w + m; y = r.y; }
      else if (r.x - m - w > 0) { x = r.x - m - w; y = r.y; }
      else if (r.y + r.h + m + h < innerHeight) { x = r.x; y = r.y + r.h + m; }
      else if (r.y - m - h > 0) { x = r.x; y = r.y - m - h; }
    } else if (rects.length > 1) {                          // несколько окон — в свободном месте между ними, не поверх
      const free = [{ x: innerWidth / 2 - w / 2, y: m }, { x: innerWidth / 2 - w / 2, y: innerHeight / 2 - h / 2 }, { x: m, y: m }];
      const hit = (p) => rects.some((q) => !(p.x + w <= q.x || p.x >= q.x + q.w || p.y + h <= q.y || p.y >= q.y + q.h));
      const p = free.find((f) => !hit(f)) || free[1]; x = p.x; y = p.y;
    }
    card.style.left = Math.max(m, Math.min(innerWidth - w - m, x)) + 'px';
    card.style.top = Math.max(m, Math.min(innerHeight - h - m, y)) + 'px';
  };
  const go = (k) => { steps[i].leave?.(); i = k; place(); };
  // клавиши тура не должны заодно листать плеер — стрелки у него свои
  const key = (e) => {
    const k = e.key; if (k !== 'Escape' && k !== 'ArrowRight' && k !== 'ArrowLeft') return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'Escape') end(); else if (k === 'ArrowRight') { if (i < steps.length - 1) go(i + 1); } else if (i) go(i - 1);
  };
  const refit = () => { last = ''; fit(); };
  const end = () => { steps[i].leave?.(); cancelAnimationFrame(follow); shade.remove(); rings.remove(); card.remove(); removeEventListener('keydown', key, true); removeEventListener('resize', refit); onEnd?.(); };
  addEventListener('keydown', key, true); addEventListener('resize', refit);
  place();
}
