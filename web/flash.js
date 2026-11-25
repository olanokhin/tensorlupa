// Страница прошивки: меню языка (как на главной). Сама прошивка — кнопка ESP Web Tools (vendor/esp-web-tools):
// она открывает системное окно выбора порта и пишет firmware/micro-qwen3-esp32s3-v1.2.bin по Web Serial.
import { LANGS, langUrl } from './i18n.js';
const $ = (id) => document.getElementById(id), L = window.MQ_LANG || 'en';
const btn = $('lang'), menu = $('lang-menu');
$('lang-code').textContent = L.toUpperCase();
menu.innerHTML = LANGS.map((x) => `<a role="menuitem" href="${langUrl(x.code)}" lang="${x.code}"${x.code === L ? ' aria-current="true"' : ''}>${x.name}</a>`).join('');
const open = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); };
btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.hidden); });
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) open(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
