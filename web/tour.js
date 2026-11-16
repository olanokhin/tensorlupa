// Тур по Гайду: по одной панели за раз — подсветка панели (остальное затемнено) и стеклянная карточка с текстом.
// Шаги — глубины 1–3: что это, история, выбор токена, температура, attention, модель. Esc или «Пропустить» — выход.

export function startTour(steps, t, { onEnd } = {}) {
  let i = 0;
  const shade = document.createElement('div'); shade.className = 'tour-shade';
  const card = document.createElement('div'); card.className = 'cc-mod tour-card';
  document.body.append(shade, card);

  const place = () => {
    const s = steps[i], el = s.anchor ? document.querySelector(s.anchor) : null;
    s.before?.();
    const r = el ? el.getBoundingClientRect() : null;
    if (r) Object.assign(shade.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
    else Object.assign(shade.style, { left: '50%', top: '50%', width: '0px', height: '0px' });
    card.innerHTML = `<div class="tc-n">${i + 1} / ${steps.length}</div><div class="tc-title">${t(s.key + '.title')}</div>` +
      `<p>${t(s.key + '.body')}</p><div class="tc-btns"><button class="tc-skip">${t('tour.skip')}</button>` +
      `<span class="tc-sp"></span>${i ? `<button class="tc-back">${t('tour.back')}</button>` : ''}` +
      `<button class="tc-next">${t(i === steps.length - 1 ? 'tour.done' : 'tour.next')}</button></div>`;
    // карточка — рядом с панелью: справа, слева, снизу или сверху, где помещается; иначе по центру
    const w = card.offsetWidth, h = card.offsetHeight, m = 16;
    let x = innerWidth / 2 - w / 2, y = innerHeight / 2 - h / 2;
    if (r) {
      if (r.right + m + w < innerWidth) { x = r.right + m; y = r.top; }
      else if (r.left - m - w > 0) { x = r.left - m - w; y = r.top; }
      else if (r.bottom + m + h < innerHeight) { x = r.left; y = r.bottom + m; }
      else if (r.top - m - h > 0) { x = r.left; y = r.top - m - h; }
    }
    card.style.left = Math.max(m, Math.min(innerWidth - w - m, x)) + 'px';
    card.style.top = Math.max(m, Math.min(innerHeight - h - m, y)) + 'px';
    card.querySelector('.tc-next').onclick = () => (i === steps.length - 1 ? end() : go(i + 1));
    card.querySelector('.tc-skip').onclick = end;
    const b = card.querySelector('.tc-back'); if (b) b.onclick = () => go(i - 1);
    card.querySelector('.tc-next').focus({ preventScroll: true });
  };
  const go = (k) => { i = k; place(); };
  // клавиши тура не должны заодно листать плеер — стрелки у него свои
  const key = (e) => {
    const k = e.key; if (k !== 'Escape' && k !== 'ArrowRight' && k !== 'ArrowLeft') return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'Escape') end(); else if (k === 'ArrowRight') card.querySelector('.tc-next')?.click(); else if (i) go(i - 1);
  };
  const end = () => { shade.remove(); card.remove(); removeEventListener('keydown', key, true); removeEventListener('resize', place); onEnd?.(); };
  addEventListener('keydown', key, true); addEventListener('resize', place);
  place();
}
