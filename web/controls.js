// Настройки в стиле панели камеры (Пункт управления macOS): подпись сверху, значение справа от неё (редактируемое),
// под ними тонкая белая дорожка с белой ручкой; флажки — переключатели; кнопка — стеклянная пилюля.
// Заменяет Tweakpane: стиль целиком наш, без внешней библиотеки.

export class Controls {
  constructor(host, obj, onChange) { this.host = host; this.obj = obj; this.onChange = onChange; this.items = []; }

  slider(key, label, min, max, step) {
    const dec = (String(step).split('.')[1] || '').length;          // знаков после точки — как у шага (0.25 → 2)
    const fmt = (v) => Number(v).toFixed(dec);
    const el = document.createElement('div'); el.className = 'ctl ctl-slider';
    el.innerHTML = `<div class="ctl-h"><span class="ctl-l">${label}</span><input class="ctl-v" inputmode="decimal" spellcheck="false"></div>` +
      `<div class="cc-track"><input type="range" min="${min}" max="${max}" step="${step}"></div>`;
    const rng = el.querySelector('input[type=range]'), val = el.querySelector('.ctl-v');
    const paint = () => rng.style.setProperty('--f', (rng.value - min) / (max - min));
    const sync = () => { rng.value = this.obj[key]; val.value = fmt(this.obj[key]); paint(); };
    rng.addEventListener('input', () => { this.obj[key] = Number(rng.value); val.value = fmt(rng.value); paint(); this.onChange?.(key); });
    const commit = () => {
      let v = Number(String(val.value).replace(',', '.'));
      if (!Number.isFinite(v)) v = this.obj[key];
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      this.obj[key] = Number(v.toFixed(dec)); sync(); this.onChange?.(key);
    };
    val.addEventListener('change', commit);
    val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); val.blur(); } if (e.key === 'Escape') { sync(); val.blur(); } });
    val.addEventListener('focus', () => val.select());
    sync(); this.items.push(sync); this.host.appendChild(el);
    return this;
  }

  toggle(key, label) {
    const el = document.createElement('label'); el.className = 'ctl ctl-toggle';
    el.innerHTML = `<span class="ctl-l">${label}</span><input type="checkbox" class="ctl-sw">`;
    const cb = el.querySelector('input');
    const sync = () => { cb.checked = !!this.obj[key]; };
    cb.addEventListener('change', () => { this.obj[key] = cb.checked; this.onChange?.(key); });
    sync(); this.items.push(sync); this.host.appendChild(el);
    return this;
  }

  button(label, fn) {
    const b = document.createElement('button'); b.className = 'ctl-btn'; b.textContent = label;
    b.addEventListener('click', fn); this.host.appendChild(b);
    return this;
  }

  refresh() { this.items.forEach((f) => f()); }
}
