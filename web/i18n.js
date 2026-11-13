// Локализация. Словари — обычные скрипты i18n/<код>.js (кладут себя в window.MQ_DICTS), язык выбирает
// i18n/boot.js до первой отрисовки (window.MQ_LANG). Новый язык = ещё один файл в i18n/, тег <script> в index.html
// и строка в LANGS; код не меняется.
// Значение в словаре — строка с подстановками {name} или функция (v, h) => строка (множественное число и т. п.).

const DICTS = window.MQ_DICTS || {};
const en = DICTS.en || {};
export const LANGS = [{ code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }];   // названия — на своём языке
export const lang = window.MQ_LANG || 'en';
const D = DICTS[lang] || en;
const pr = new Intl.PluralRules(lang);
const nf = new Intl.NumberFormat(lang);

export const h = {
  plural: (n, forms) => forms[pr.select(n)] ?? forms.other,       // forms: { one, few, many, other }
  num: (x) => nf.format(x),
};

export function t(key, v = {}) {
  const s = D[key] ?? en[key];
  if (s === undefined) { console.warn('i18n: нет ключа', key); return key; }
  if (typeof s === 'function') return s(v, h);
  if (typeof s !== 'string') return s;                              // массивы (например, состояния слов)
  return s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
}

export function setLang(code) {
  try { localStorage.setItem('mq.lang', code); } catch { /* без памяти — только на эту загрузку */ }
  location.reload();
}
