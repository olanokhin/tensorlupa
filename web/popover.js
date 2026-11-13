// Выпадающие стеклянные меню навбара (язык, модель, «О проекте»): меню живёт на верхнем уровне страницы,
// а не внутри навбара — стекло навбара иначе не дало бы размыть то, что под меню. Позиция — под кнопкой.
// Закрывается щелчком мимо, Esc или повторным щелчком по кнопке. Открытым может быть только одно меню.

const all = [];

export function popover(btn, pop, { align = 'right', onOpen } = {}) {
  pop.hidden = true;
  document.body.appendChild(pop);
  const place = () => {
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 10) + 'px';
    if (align === 'right') { pop.style.right = (innerWidth - r.right) + 'px'; pop.style.left = ''; }
    else { pop.style.left = r.left + 'px'; pop.style.right = ''; }
  };
  const api = {
    open(on) {
      if (on) { all.forEach((p) => p !== api && p.open(false)); place(); onOpen?.(); }
      pop.hidden = !on; btn.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on));
    },
    get isOpen() { return !pop.hidden; },
  };
  all.push(api);
  btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', (e) => { e.stopPropagation(); api.open(pop.hidden); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !btn.contains(e.target) && !pop.contains(e.target)) api.open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.open(false); });
  addEventListener('resize', () => { if (!pop.hidden) place(); });
  return api;
}
