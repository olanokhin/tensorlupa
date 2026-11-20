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
