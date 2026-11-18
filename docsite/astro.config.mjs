// TensorLupa Docs: Astro + Starlight. Адреса как у всего сайта: /docs/… (английский) и /ru/docs/… (русский);
// scripts/deploy.sh кладёт сборку в корень dist/ рядом с лендингом и студией.
// Лендинг и студия живут в web/ отдельно и не зависят от этой сборки.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://tensorlupa.com',
  outDir: './dist',
  integrations: [
    starlight({
      title: 'TensorLupa Docs',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: { root: { label: 'English', lang: 'en' }, ru: { label: 'Русский', lang: 'ru' } },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/olanokhin/tensorlupa' }],
      customCss: ['./src/styles/tensorlupa.css'],
      components: { SocialIcons: './src/components/HeaderLinks.astro', SiteTitle: './src/components/SiteTitle.astro' },
      disable404Route: true,   // страница 404 — общая для сайта (web/404.html)
      sidebar: [
        { label: 'Start here', translations: { ru: 'С чего начать' }, items: [{ slug: 'docs', label: 'About the docs', translations: { ru: 'О документации' } }] },
        // адреса страниц плоские и стабильные (/docs/glossary/<термин>/ — на них ссылаются подсказки студии),
        // а меню делится на «Основы» (порядок обучения) и «Настройки»
        {
          label: 'Basics', translations: { ru: 'Основы' },
          items: [
            { slug: 'docs/glossary/language-model' },
            { slug: 'docs/glossary/token' },
            { slug: 'docs/glossary/prompt' },
            { slug: 'docs/glossary/completion' },
            { slug: 'docs/glossary/instruct' },
          ],
        },
        {
          label: 'Settings', translations: { ru: 'Настройки' },
          items: [
            { slug: 'docs/glossary/temperature' },
          ],
        },
      ],
      head: [{ tag: 'meta', attrs: { property: 'og:image', content: 'https://tensorlupa.com/media/og.png' } }],
    }),
  ],
});
