# TensorLupa design system

All tokens live in one block at the top of `editor.css` (`:root`, "ДИЗАЙН-СИСТЕМА"). New styles use tokens, not raw numbers. Scripts that draw shapes (`split.js`, `stage.js`, `cards.js`) read the same tokens with `getComputedStyle`, so a change in CSS reaches them too.

## Look

Monochrome dark glass. Colour belongs to data only:
- amber (`--pos`, #f2b33d): attention and the chosen token;
- lilac (`--neg`, #a98cf0): contribution and logit bias.

No decorative colour glows in backgrounds.

## Text

| Token | Use |
|---|---|
| `--ink-1` | primary: values, active items |
| `--ink-2` | secondary: titles, labels |
| `--ink-3` | tertiary: status, notes, inactive |

Type scale:

| Token | Size | Use |
|---|---|---|
| `--fs-1` | 11px | small notes under settings, table heads |
| `--fs-2` | 12px | labels, status, breadcrumbs, tabs |
| `--fs-3` | 12.5px | panel and card titles |
| `--fs-4` | 13px | menu items, card text, brand |
| `--fs-5` | 14px | article text, tour card title |
| `--fs-6` | 17px | headings inside Docs articles |

UI text uses `--ui`. Tokens, numbers and the story text use `--mono`.

## Spacing

- Steps: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16.
- `--gap` (6px) is the space between large surfaces: columns, windows side by side, the screen edge. It is the only gap at that level:
  - it includes the draggable border between windows, which has a wider invisible grab zone;
  - it includes the space between neighbouring tabs.

  Every tab has the same shape and width, with 10px concave flares at the base, so nothing jumps on switching.
  - Inactive tabs lie under the window: the window and the active tab's flares cover their flares.
  - Inactive tabs tuck 6px under the window edge, so they are overlapped rather than cut off.
  - The label and the close button sit on the same line in both states. Tabbed windows have no backdrop blur: Chrome would paint the blur over the whole rectangle and ignore the tab shape.
- `--pad` (12px) is the inner padding from the edge of any surface to its content. It applies to:
  - tab labels (a non-first tab adds its 10px concave flare);
  - window rows such as "3D / 2D";
  - panel and card titles, setting labels, card arrows;
  - the top bar on all four sides;
  - Docs articles.

  Text starts 12px from the edge everywhere.
- `--head` (34px) is the height of every header: panel titles, side cards, the tab strip.
- `--bar-h` is the height of the top bar: `--ctl-h` plus `--pad` above and below.
- `--ctl-h` (32px) is the height of controls in the top bar.
- Stacked panels and cards overlap by 8px (`OVERLAP` in `stage.js` and `cards.js`).

## Radii

Nested shapes are rounded less than the shape around them.

| Token | Size | Use |
|---|---|---|
| `--r-surface` | 16px | windows, panels, cards, top bar, menus |
| `--r-tab` | 12px | top corners of window tabs |
| `--r-control` | 10px | buttons, fields, code blocks, images in articles |
| `--r-chip` | 6px | tokens, breadcrumbs, number fields, inline code |
| circle | 50% | icon buttons, slider knobs, switches |

The window area (`#stage`) rounds only its bottom corners. Its top corners would cut the first tab's corner.

## Controls

Three kinds of control, and nothing else. The tokens are at the end of `editor.css` ("НАВБАР: ТРИ ВИДА ЭЛЕМЕНТОВ").

| Kind | What it is for | Look |
|---|---|---|
| Field | something the person sets: the model, the mode, the words, Guide / Lab | dark and inset: `--field-bg`, `--field-shadow` |
| Button | an action: Tour, Docs, Share, another story, About, language | one glass for all: `--btn-bg`, `--btn-shadow`, the lens rim `--btn-rim` |
| Primary button | the one main action, Generate | the bright top rim and the light inside |

Rules:
- Every control is `--ctl-h` (32px) high with radius `--r-control`. An icon-only button is the same 32 × 32 square,
  never a circle. Circles are for knobs, switches and the round buttons inside the 3D views.
- One font for all controls: `--ctl-font` (12.5px, weight 500). The primary button is weight 600. Mono is only for
  what the person types as tokens (the words, the story start).
- Parts of one input join into one field with hairline dividers: model · mode · words. The focus ring goes around
  the whole field.
- A choice between two modes is a segmented control inside a field, not an on/off switch.
- Groups: `--gap` (6px) between controls of one group, `--s4` (16px) between groups. The top bar has four groups:
  the brand; what to generate (the field, Generate, another story); how to look (Guide / Lab); help and links
  (Tour, Docs, Share, About, language).
- The top bar has the same controls in Guide and in Lab, in the same places. Nothing appears, disappears or moves
  when the mode changes, so a control never slides from under the pointer. Reference text (layers, heads,
  vocabulary) belongs in the model menu, not in the bar; the status line shows only loading and errors.

Dropdown menus are separate glass tiles on the top level of the page. The entrance animation goes on the tiles,
never on their container: while a container is translucent or scaled, the tiles inside cannot blur the page behind
them, and the blur would pop in at the end.

## Links to Docs

Every place in the studio that points to a Docs article does it the same way: a glossary tooltip, the card of a
step in the 3D model view, anything added later.

- **Look:** the class `.gloss-more`. Amber `#f2b33d`, weight 600, on its own line under the explanation, underline
  only on hover. Do not restyle it per place.
- **Text:** the key `gl.more` ("Read more in Docs"). Do not write a new wording for a new place.
- **Behaviour:** a plain click opens the article in the studio's own Docs tab next to the story (`openDoc(href)` in
  `editor.js`; from another module, dispatch `mq-open-doc` on `window` with the address). With Ctrl, ⌘ or Shift it
  opens as an ordinary link in a new browser tab, so keep `href`, `target="_blank"` and `rel="noopener"` on it.
- **Address:** `/docs/glossary/<slug>/`, with the language prefix (`/ru/…`) for other languages.
- **Only for written articles:** show the link only if the slug is in `/docs/pages.json`, which the Docs build
  writes. A term without an article gets the explanation and no link.

## Glass rim

| Token | Value |
|---|---|
| `--rim-w` | 1px |
| `--rim-top` | 42% white at the top edge |
| `--rim-low` | 8% white |
| `--rim-fade` | 48px |

The rim fades from `--rim-top` to `--rim-low` over `--rim-fade`. The fade is in pixels, so tall and short surfaces look the same. Tabbed windows draw the same rim in SVG.

Deliberate exceptions:
- an inactive tab fades to zero at the bottom, because it is open towards its window;
- "What just happened" (Guide) adds an amber highlight from the centre of its top edge.

## Motion

- Dragged pieces (cards, bottom panels, windows) follow the pointer, and the others slide aside in about 200 to 340 ms.
- Text that changes on a new step fades in once, and not during fast playback.
