# TensorLupa Docs

Astro + Starlight. English pages live in `src/content/docs/docs/`, Russian in `src/content/docs/ru/docs/`;
on the site they are `/docs/…` and `/ru/docs/…`. Build: `./node_modules/.bin/astro build` (the deploy script
does it and copies the result next to the landing and the studio).

## Glossary addresses

Every term has one fixed address, `/docs/glossary/<slug>/`. Link to a term every time it is mentioned, even if
its page is not written yet: `scripts/pending-links.mjs` turns links to missing pages into plain text after the
build, and they become links by themselves once the page exists.

| Section | Slugs |
| --- | --- |
| Basics (in this order) | `language-model`, `token`, `prompt`, `completion`, `instruct`, `transformer`, `residual-stream`, `attention`, `mlp`, `logits`, `sampling` |
| Settings and inspector | `temperature`, `top-k`, `seed`, `max-new-tokens`, `repetition-penalty`, `logit-bias`, `fsm`, `entropy`, `logit-lens`, `attention-head` |

A new page also goes into the sidebar in `astro.config.mjs`, and into `DOCS` in `web/editor.js` so the studio
tooltip for that term gets a "Read more in Docs" link.

## Page outline

In one sentence (the same text as the studio tooltip) · how it works · a real step of micro-qwen3 with real
numbers · where it is in the studio (screenshot) · try it (a link that opens the studio at that step) ·
in micro-qwen3 · a bit of history (2–3 sentences, where the idea comes from, when it is interesting) ·
related or next. No em dashes in the text.

## Languages

English first. A Russian page is the same slug under `src/content/docs/ru/docs/`; until it exists, Starlight
shows the English text with a notice, and `scripts/pending-links.mjs` points its studio links to `/ru/studio`.

## Planned passes

- **FAQ** at the end of every page: 3–5 questions in the exact wording people search for (Bing Webmaster
  keyword research API, Yandex Wordstat, later Google Search Console), with FAQPage JSON-LD.
- **Model links**: the micro-qwen3 repository will live at `github.com/olanokhin/micro-qwen3` and
  `huggingface.co/olanokhin/micro-qwen3`; link to them from the pages once they are published.
