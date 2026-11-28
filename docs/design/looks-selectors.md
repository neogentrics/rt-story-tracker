---
title: "Design: our Looks beside the shared ones"
subtitle: Every selector our Solid, Metallic and Glass use, and the Reader's selector for the same part
author: Recon Towers Dev Department
date: 2026-11-27
tags: [design, themes, looks]
---

# Our Looks beside the shared ones

In 3.12, after read aloud, this app's own Metallic and Glass are to be replaced by the shared ones in `recon-theme`. The
shared looks style RT Markdown Reader's class names, so this app's names have to be added there first. This page lists ours
and maps each to the Reader selector that plays the same part.

Compared: this app's `master` at `1e2e32a`, and `recon-theme` v0.1.0 (`d0f0bcf`). It comes from reading both sets of
files. **The shared files haven't been loaded into this app,** so what's said below about their effect here is worked out,
not seen.

## Where our Looks are

| File | What's in it |
|---|---|
| `src/renderer/metallic.css` | All of Metallic |
| `src/renderer/style.css`, the block headed *Glass* | All of Glass, and one High Contrast rule after it |
| `src/renderer/look.js` | Sets the root attributes and the theme's colours |
| `src/shared/themes.js` | The themes, the three Looks, and `surfaceFor`, which says which Look a theme is drawn with |

Solid has no rules of its own. It's the app's base styles.

## Root attributes

| Attribute | Ours | Shared | Same? |
|---|---|---|---|
| `data-surface` | `solid`, `metallic`, `glass` | The same | Yes |
| `data-theme` | The shared ten, by the same names, and `slate`, `blueOrange`, `plum`, `evergreen`, `aero` | `light`, `sepia`, `mist`, `dark`, `forest`, `dusk`, `blue`, `red`, `yellow`, `contrast` | Ours has five more |
| `data-tone` | `dark` for `dark`, `forest`, `dusk`, `contrast`, `slate`, `blueOrange`, `plum`, `evergreen` | `dark` for the first four | Yes, for the shared ten |
| `data-colors` | Not set | `safe` or `normal` | No. Neither shared look file reads it |

Aero is always Glass and High Contrast always Solid. That's `surfaceFor`, not CSS. Metallic is left off, in both apps, for
forced colours, a request for more contrast, and printing. Glass is also left off for a request for less transparency.

## The map

In the tables, `…` stands for a `:not()` that leaves some out. Ours are spelled out under
[Exact selectors](#exact-selectors). In the Reader's column, `.tb-btn…` is `.tb-btn:not(.tb-primary, :disabled)`, and `input…`
leaves out tick boxes, radio buttons, sliders and colour boxes. *None* means the shared files have no selector for that part.

### Bars

| Part | Our selectors | Our Metallic | Our Glass | Reader's selector for the same part |
|---|---|---|---|---|
| Behind everything | `body` | Nothing | The theme's desk colours | `body` |
| Top bar | `.room-header`, `.library-bar` | Bar sheen over `--toolbar-fill` | Nothing | `.toolbar` |
| Icon button on the top bar | `.room-header .bar-button:not(.in-menu)`, `.library-bar .bar-button:not(.in-menu)` | Raised plate | Nothing | `.toolbar .tb-btn:not(.tb-primary, :disabled)` |
| Button with words on the top bar | `.room-header .bar-primary`, `.library-bar .bar-primary` | Plate tinted with `--bar-tint` | Nothing | `.tb-btn`. Not `.tb-primary`: ours isn't filled with the accent |
| Write and Records switch | `.room-header .mode-tabs` | Recessed groove | Nothing | `.seg` |
| The chosen view | `.room-header .mode-tab.active` | Raised plate | Nothing | `.seg button.active` |
| Formatting bar, above the page | `.toolbar` | Bar sheen over `--sidebar-fill` | Frosted | *None.* Nearest in look: `.tabstrip`. **Our name clashes** |
| Formatting buttons | `.toolbar button…` | Raised plate | Nothing | `.tb-btn…` |
| A formatting button that's on | `.toolbar button[aria-pressed='true']:not(:disabled)` | Pressed in | Nothing | *None.* Nearest: `.seg button.active` |
| Find bar | `.find-bar` | Panel sheen over `--sidebar-fill` | Frosted | `.find-bar`. **Same name, different surface** |
| Status bar: word counts and *Saved* | `.page-footer` | Bar sheen over `--sidebar-fill` | Frosted | *None.* The Reader's word count is in `.side-foot`, part of its sidebar. Nearest in look: `.tabstrip` |
| Read aloud bar | Not built yet | | | `.speak-bar`, `.speak-play`, `.audio-job` |

### Panels and the page

| Part | Our selectors | Our Metallic | Our Glass | Reader's selector for the same part |
|---|---|---|---|---|
| Books list, chapters list, kinds of record | `.column:not(.page-column)` | Panel sheen over `--sidebar-fill` | Frosted | `.sidebar` |
| Buttons at the foot of a list | `.column-actions`, `.column-actions button…` | A light line on top, and plates | Nothing | `.side-foot`, and `.tb-btn…` for the buttons |
| Comments panel | `.comments` | Panel sheen | Frosted | `.sidebar` |
| Chapter filter and other list boxes | `.column:not(.page-column) input`, `select` | Recessed | Nothing | `.side-filter`, and `.sidebar :is(input, select, textarea)` |
| The writing page | `.sheet` | Flat | Frosted: the page colour at 90% | `.page` (86%) |

`.page-column` is also a `.column`. It's left out of every rule, so that what's on the page stays flat.

### Windows and menus

| Part | Our selectors | Our Metallic | Our Glass | Reader's selector for the same part |
|---|---|---|---|---|
| Dialogs, Preferences among them | `.dialog` (a `<dialog>`) | Panel sheen over `--page` | Nothing | `dialog.shortcuts` |
| Cards on the library and lock screens | `.home-card` (not a `<dialog>`) | Panel sheen | Nothing | *None.* Nearest: `dialog.shortcuts` |
| Right-click and colour menus | `.popup-menu` | Panel sheen | Nothing | `.popover` |
| The *More* menu of the top bar | `.more-menu` | Panel sheen | Nothing | `.popover` |
| Column chooser in a table of records | `.column-menu` | Panel sheen | Nothing | `.popover` |
| Searching for a record to link | `.record-picker` | Panel sheen | Nothing | `.palette` |
| Records offered after typing @ | `.mention-pop` | Panel sheen | Nothing | `.popover` |

### Buttons and boxes inside them

| Part | Our selectors | Our Metallic | Our Glass | Reader's selector for the same part |
|---|---|---|---|---|
| Buttons of a dialog and of Preferences | `.dialog-actions button…`, `.prefs-foot button…` | Raised plate | Nothing | `.tb-btn…` |
| Buttons of the find bar | `.find-bar button…` | Raised plate | Nothing | `.tb-btn…` |
| The main button, anywhere | `button.primary:not(:disabled)` | Glossy accent | Nothing | `.big-btn` in a dialog, `.tb-primary` on a bar |
| A button with no plate | `.quiet` (left out of the plates) | Flat | Nothing | *None* |
| Text boxes and lists | See *wells* below | Recessed | Nothing | `:is(.shortcuts, .popover, .sidebar, .find-bar, .palette) :is(input…, select, textarea)`, and `.seg`. The Reader's Glass leaves `.find-bar` out of this |
| Boxes that stay plain | `.comment-text`, `.comment-box` | Left out | Nothing | *None* |

**The Reader has, and this app doesn't:** `.tabstrip`, `.tab`, `.tab.active`, and `.markdown-body` outside the look files.

**High Contrast** has one rule of ours that isn't part of a Look, `html[data-theme='contrast'] :is(button, input, select,
textarea)`, for borders. It has no shared counterpart, and stays ours.

## Exact selectors

Metallic, all of it inside `@media screen and (forced-colors: none) and (prefers-contrast: no-preference)`, and each after
`:root[data-surface='metallic']:not([data-theme='contrast'])`, except the main button and the rules that follow it, which
are nested in a block with that selector:

```text
/* which text is on the surface: --on-bar, --on-panel, --sheet-ink */
:is(.room-header, .library-bar)
:is(.column:not(.page-column), .toolbar, .page-footer, .find-bar, .comments)
:is(.dialog, .more-menu, .popup-menu, .column-menu, .record-picker, .mention-pop, .home-card, input, select, textarea)

/* surfaces */
:is(.room-header, .library-bar)
:is(.toolbar, .page-footer)
:is(.column:not(.page-column), .find-bar, .comments)
.column-actions
:is(.dialog, .more-menu, .popup-menu, .column-menu, .record-picker, .mention-pop, .home-card)

/* plates, and their hover and pressed states */
:is(.room-header, .library-bar) :is(.bar-button:not(.in-menu), .bar-primary):not(:disabled)
:is(.column-actions, .toolbar, .find-bar, .dialog-actions, .prefs-foot) button:not(.primary, .quiet, :disabled)
:is(.room-header, .library-bar) .bar-primary.bar-primary:not(:disabled)
:is(.room-header, .library-bar, .column-actions, .toolbar, .find-bar, .dialog-actions, .prefs-foot) button:not(.primary, :disabled):hover
:is(.column-actions, .toolbar, .find-bar, .dialog-actions, .prefs-foot) button:not(.primary, .quiet, :disabled):active
.toolbar button[aria-pressed='true']:not(:disabled)

/* the main button */
button.primary:not(:disabled)

/* wells */
:is(.column:not(.page-column), .toolbar, .find-bar, .dialog, .home-card)
  :is(input:not([type='checkbox'], [type='radio'], [type='range'], [type='color'], [type='file']), select, textarea)
  :not(.comment-text, .comment-box)
.room-header .mode-tabs
.room-header .mode-tab.active
```

The wells selector is one line in the file, with no space before `:not(.comment-text, .comment-box)`.

Glass, all of it inside
`@media screen and (forced-colors: none) and (prefers-contrast: no-preference) and (prefers-reduced-transparency: no-preference)`:

```text
html[data-surface='glass'] body
html[data-surface='glass'] :is(.column:not(.page-column), .toolbar, .find-bar, .page-footer, .comments)
html[data-surface='glass'] .sheet
```

Our Glass covers much less than the shared one: no top bar, dialogs, menus, buttons or boxes. All of those will look
different with it.

## What has to be dealt with

### 1. Two of our names are in the shared files already

These bite as soon as the files are loaded here, whether or not anything of ours has been added to them.

- **`.toolbar` is our formatting bar, and the shared top bar.** The shared rules would paint it with `--toolbar-fill`, the top
  bar's colours, under words in our panels' text colour. In Paper that's dark words on a dark bar. Our class has to be
  renamed in this app, to something like `.format-bar`, since the Reader's selectors can't change.
- **`.find-bar` is the same part in both, on different surfaces.** The shared rules paint it in the page's colour. Ours is a
  panel, with the panel's text colour. In Blue and Red that's light text on a light surface. Either ours is renamed, or the
  find bar here takes the page's text colour.

`.active` is shared too, but only styled together with `.tab` or `.seg`. The shared rules also reach plain elements: `body`,
every `<dialog>` (Glass frosts them all), and every `input`, `select` and `textarea`.

No other shared class name is used here.

### 2. The shared looks read colour names that some of our parts don't set

The shared rules work out their strength from `--text` or `--text-soft` **on that part**, and mix `--page`, also on that part,
into what they paint. In the Reader, `theme.css` gives its toolbar, tab strip and sidebar their own values.

- **Our top bar sets none of them.** On `.room-header` and `.library-bar`, `--text-soft` and `--heading` are the writing page's
  inks, while the bar's words are `--on-bar`. The shared strengths would come from the wrong ink, and the shared rule that
  gives bar buttons `--heading` would put dark words on a dark bar in Paper.
- **Our panels set the text names but not `--page`.** Their `--page` is still the writing page's. Shared Glass mixes 62% of
  `--page` behind a sidebar, so in Blue and Red light panel text would sit on a mostly light surface.
- **Three names don't exist here:** `--tabstrip-fill`, `--code-bg` and `--glass-desk`. A rule that reads a missing one paints
  nothing. `--accent-fill` and `--on-fill` are missing too, but the shared rules have fallbacks.

So our copy needs each of those parts to set `--text`, `--text-soft`, `--heading`, `--page` and `--chrome-border` for itself.

**Not settled:** `recon-theme` says `theme.css` is to be copied whole. Loaded here, it would also give colours to anything
called `.toolbar` or `.sidebar`, and its theme blocks would override the `--text` and `--page` we set at the root. The 3.12
item replaces our look code. Whether this app also loads the shared theme colours has to be decided before the copy.

### 3. Adding names to the shared files without changing the Reader

**Don't put our selectors inside an existing `:is()`.** An `:is()` weighs as much as its heaviest member, for all of them.
Adding `.column:not(.page-column)` to `:is(.toolbar, .tabstrip, .sidebar)` would make that rule outweigh more of the Reader's
own styles, with no Reader selector edited. Add ours as separate selectors in the rule's list, or inside `:where()`, which
adds no weight, and check that each still beats this app's base styles.

## Read aloud can use the shared names from the start

This app has no read aloud bar yet. If the one built in 3.12 uses `.speak-bar`, `.speak-play`, `.speak-status` and
`.audio-job`, with `.tb-btn` on its buttons, nothing has to be added to the shared files for it.

## The colours from issue 54

Highlighting and letter colours are shaded for what's behind the page (`src/shared/colour.js`, `pageBackgrounds`). That
assumes our Glass: the page at 90%, over the theme's desk colours. The shared Glass draws `.page` at 86%, over
`--glass-desk`. With the shared copy, those two figures have to follow it. `test/e2e/colours.e2e.cjs` measures every colour
from the screen in every theme and Look, and has to pass against the shared files.

What our own screens measure over each part is listed in `test/e2e/look.e2e.cjs`, which is the place to start when
`reference.html` gets our parts.
