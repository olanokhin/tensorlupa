// Вкладка Docs в студии. Своей копии статей у студии нет: вкладка загружает ту же страницу, что открывается на сайте
// (/docs/…, /ru/docs/…), берёт из неё заголовок и текст статьи (.sl-markdown-content Starlight) и показывает в стиле
// студии. Поэтому новая статья в Docs сразу открывается и здесь, без правок студии.
// Навигация — хлебные крошки, как в VS Code: «Docs › раздел › статья». Щелчок по звену открывает список того, что
// лежит на этом уровне: «Docs» — всё оглавление, раздел — его статьи. Оглавление берётся из боковой панели той же
// страницы Docs (nav.sidebar Starlight), так что новые статьи и разделы появляются в крошках сами.
// Ссылки внутри: на другие страницы Docs — открываются тут же (есть «назад»), якоря — прокрутка внутри вкладки,
// студия (ссылки «попробовать») — как обычная ссылка, внешние — в новой вкладке браузера.

const STORE = 'mq.docs.url';
const DOC_PATH = /^\/(?:[a-z]{2}\/)?docs(?:\/|$)/;

export class DocPane {
  // el — section.viewport с .doc-back, .doc-h, .doc-site и .doc-scroll > article.doc внутри
  constructor(el, { t, home }) {
    this.el = el; this.t = t; this.home = home;
    this.scroll = el.querySelector('.doc-scroll'); this.art = el.querySelector('.doc');
    this.crumbs = el.querySelector('.doc-crumbs'); this.toc = null; this.menu = null; this.site = el.querySelector('.doc-site'); this.backBtn = el.querySelector('.doc-back');
    this.stack = []; this.url = null; this.seq = 0;
    this.backBtn.addEventListener('click', () => { const u = this.stack.pop(); if (u) this.load(u, { push: false }); });
    this.art.addEventListener('click', (e) => this.onLink(e));
  }

  static isDoc(href) {
    try { const u = new URL(href, location.href); return u.origin === location.origin && DOC_PATH.test(u.pathname); } catch { return false; }
  }

  // последняя открытая статья (для восстановления после перезагрузки)
  last() { try { return localStorage.getItem(STORE); } catch { return null; } }

  async load(href, { push = true } = {}) {
    const u = new URL(href || this.home, location.href);
    const path = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
    const key = path + u.hash;
    if (this.url && path === new URL(this.url, location.href).pathname) { this.jump(u.hash); this.url = key; return; }
    const my = ++this.seq;
    this.el.classList.add('doc-loading');
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error(r.status);
      const html = await r.text();
      if (my !== this.seq) return;                 // пока грузили, открыли другую статью
      const page = new DOMParser().parseFromString(html, 'text/html');
      const body = page.querySelector('.sl-markdown-content');
      if (!body) throw new Error('no content');
      this.clean(body, path);
      if (push && this.url) this.stack.push(this.url);
      this.url = key;
      const title = page.querySelector('main h1, h1')?.textContent.trim() || 'Docs';
      this.toc = this.parseToc(page) || this.toc;
      this.path = path; this.title = title;
      this.renderCrumbs();
      this.art.replaceChildren(...body.childNodes);
      this.site.href = path;
      this.scroll.scrollTop = 0;
      this.jump(u.hash);
      try { localStorage.setItem(STORE, key); } catch { /* только на эту загрузку */ }
    } catch {
      if (my !== this.seq) return;
      this.path = path; this.title = 'Docs'; this.renderCrumbs();
      this.art.replaceChildren();
      const p = document.createElement('p'); p.className = 'doc-err'; p.textContent = this.t('docs.error');
      const a = document.createElement('a'); a.href = path; a.target = '_blank'; a.rel = 'noopener'; a.textContent = this.t('docs.site');
      p.append(' ', a); this.art.append(p);
      this.site.href = path;
    } finally {
      if (my === this.seq) { this.el.classList.remove('doc-loading'); this.backBtn.disabled = !this.stack.length; }
    }
  }

  // оглавление из боковой панели страницы: [{ label, href } | { label, items: [...] }]
  parseToc(page) {
    const top = page.querySelector('nav.sidebar ul.top-level'); if (!top) return null;
    const walk = (ul) => [...ul.children].map((li) => {
      const det = li.querySelector(':scope > details');
      if (det) return { label: det.querySelector('summary .group-label, summary')?.textContent.trim() || '', items: walk(det.querySelector(':scope > ul') || document.createElement('ul')) };
      const a = li.querySelector(':scope > a'); if (!a) return null;
      return { label: a.textContent.trim(), href: new URL(a.getAttribute('href'), location.origin).pathname };
    }).filter(Boolean);
    return walk(top);
  }
  // цепочка групп до текущей страницы
  trail(items = this.toc || [], path = this.path, up = []) {
    for (const it of items) {
      if (it.href && it.href === path) return up;
      if (it.items) { const r = this.trail(it.items, path, [...up, it]); if (r) return r; }
    }
    return null;
  }
  renderCrumbs() {
    const c = this.crumbs; c.replaceChildren();
    const btn = (label, onOpen, cls = '') => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'doc-crumb ' + cls; b.textContent = label;
      b.setAttribute('aria-haspopup', 'menu'); b.addEventListener('click', (e) => { e.stopPropagation(); this.openMenu(b, onOpen()); });
      c.append(b); return b;
    };
    const sep = () => { const s = document.createElement('span'); s.className = 'doc-sep'; s.textContent = '›'; c.append(s); };
    const root = this.toc || [];
    btn('Docs', () => ({ kind: 'root' }), 'doc-root');
    const up = this.trail() || [];
    const isHome = root[0]?.items?.[0]?.href === this.path || root[0]?.href === this.path;
    // группа «Start here» с одной страницей — это сама главная Docs: в крошках её не повторяем
    if (isHome) return;
    up.forEach((g) => { sep(); btn(g.label, () => ({ kind: 'list', items: g.items })); });
    sep();
    const h = btn(this.title, () => ({ kind: 'page' }), 'doc-h'); h.title = this.title;
  }
  // выпадающий список звена: «Docs» — разделы (щелчок — спуститься в раздел, «‹ Docs» — обратно),
  // раздел — его статьи, статья — её подзаголовки. Высота — до края экрана, дальше прокрутка внутри.
  openMenu(anchor, what) {
    const same = this.menu && this.menu.anchor === anchor;
    this.closeMenu(); if (same) return;
    const m = document.createElement('div'); m.className = 'doc-menu'; m.setAttribute('role', 'menu');
    const row = (label, onPick, { cls = '', meta = '', current = false } = {}) => {
      const a = document.createElement('a'); a.href = '#'; a.setAttribute('role', 'menuitem'); a.className = cls + (current ? ' on' : '');
      const l = document.createElement('span'); l.className = 'dm-l'; l.textContent = label; a.append(l);
      if (meta) { const x = document.createElement('span'); x.className = 'dm-meta'; x.textContent = meta; a.append(x); }
      if (current) a.setAttribute('aria-current', 'true');
      a.addEventListener('click', (e) => { e.preventDefault(); onPick(e); });
      m.append(a); return a;
    };
    const page = (it) => row(it.label, (e) => { if (e.metaKey || e.ctrlKey) { open(it.href, '_blank'); return; } this.closeMenu(); this.load(it.href); }, { current: it.href === this.path });
    const count = (g) => g.items.reduce((n, x) => n + (x.items ? count(x) : 1), 0);
    const hasPath = (g) => g.items.some((x) => (x.items ? hasPath(x) : x.href === this.path));
    const show = (view) => {
      m.replaceChildren();
      if (view.kind === 'root') {
        for (const it of this.toc || []) {
          if (it.items && it.items.length === 1 && !it.items[0].items) page(it.items[0]);    // раздел из одной страницы — сразу она
          else if (it.items) row(it.label, () => show({ kind: 'list', items: it.items, back: true, title: it.label }), { cls: 'dm-group', meta: count(it) + ' ›', current: hasPath(it) });
          else page(it);
        }
      } else if (view.kind === 'list') {
        if (view.back) row('‹ Docs', () => show({ kind: 'root' }), { cls: 'dm-back' });
        if (view.title) { const g = document.createElement('div'); g.className = 'doc-menu-g'; g.textContent = view.title; m.append(g); }
        for (const it of view.items) {
          if (it.items) row(it.label, () => show({ kind: 'list', items: it.items, back: true, title: it.label }), { cls: 'dm-group', meta: count(it) + ' ›' });
          else page(it);
        }
      } else {
        const hs = [...this.art.querySelectorAll('h2[id], h3[id]')];
        if (!hs.length) { const g = document.createElement('div'); g.className = 'doc-menu-g'; g.textContent = this.title; m.append(g); }
        for (const h of hs) row(h.textContent.trim(), () => { this.closeMenu(); this.jump('#' + h.id.replace(/^doc-/, '')); }, { cls: h.tagName === 'H3' ? 'dm-sub' : '' });
      }
      m.querySelector('a.on, a')?.focus({ preventScroll: true });
      m.querySelector('a.on')?.scrollIntoView({ block: 'nearest' });
    };
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    m.style.maxHeight = Math.max(160, innerHeight - r.bottom - 20) + 'px';
    show(what);
    m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    anchor.classList.add('open');
    this.menu = { el: m, anchor };
    const off = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) this.closeMenu(); };
    const key = (e) => {
      if (e.key === 'Escape') { this.closeMenu(); anchor.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const as = [...m.querySelectorAll('a')], k = as.indexOf(document.activeElement);
        as[(k + (e.key === 'ArrowDown' ? 1 : -1) + as.length) % as.length]?.focus();
      }
    };
    addEventListener('pointerdown', off, true); addEventListener('keydown', key, true);
    this.menu.off = () => { removeEventListener('pointerdown', off, true); removeEventListener('keydown', key, true); };
  }
  closeMenu() { if (!this.menu) return; this.menu.off?.(); this.menu.el.remove(); this.menu.anchor.classList.remove('open'); this.menu = null; }

  // убрать из статьи то, что работает только на сайте, и привести адреса к абсолютным
  clean(body, path) {
    body.querySelectorAll('.sl-anchor-link, script, link, style, button, .sr-only').forEach((n) => n.remove());
    const base = location.origin + path;
    body.querySelectorAll('img[src]').forEach((img) => { img.src = new URL(img.getAttribute('src'), base).href; img.loading = 'lazy'; img.removeAttribute('srcset'); });
    body.querySelectorAll('a[href]').forEach((a) => {
      const raw = a.getAttribute('href');
      if (raw.startsWith('#')) { a.dataset.anchor = raw; return; }
      const u = new URL(raw, base);
      a.href = u.href;
      if (u.origin === location.origin && DOC_PATH.test(u.pathname)) a.dataset.doc = '1';
      else if (u.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener'; }
    });
    // id заголовков у Starlight уникальны в пределах страницы — оставляем, но с префиксом, чтобы не задеть студию
    body.querySelectorAll('[id]').forEach((n) => { n.id = 'doc-' + n.id; });
  }

  jump(hash) {
    if (!hash) return;
    const n = this.art.querySelector('#' + CSS.escape('doc-' + decodeURIComponent(hash.slice(1))));
    if (n) this.scroll.scrollTop = n.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top + this.scroll.scrollTop - 8;
  }

  onLink(e) {
    const a = e.target.closest('a'); if (!a) return;
    if (a.dataset.anchor) { e.preventDefault(); this.jump(a.dataset.anchor); return; }
    if (!a.dataset.doc || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // с модификатором — как обычно
    e.preventDefault(); this.load(a.href);
  }
}
