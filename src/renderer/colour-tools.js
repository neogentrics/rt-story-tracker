// The two colour buttons on the formatting bar. Each opens a menu of colours, a way to pick any other, and a way back to none.
import { HIGHLIGHTS, HIGHLIGHT_MARK, TEXT_COLOURS, TEXT_MARK, cleanColour } from '../shared/colour.js';
import { ATTRIBUTES, note, shadeOf } from './colour-marks.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './popup-menu.js';

const KINDS = [
  { type: HIGHLIGHT_MARK, label: 'Highlight colour', face: () => icon('highlighter'), palette: HIGHLIGHTS, none: 'Remove highlight', start: '#ffff00' },
  { type: TEXT_MARK, label: 'Text colour', face: () => el('span', { class: 'face-letter', 'aria-hidden': 'true' }, 'A'), palette: TEXT_COLOURS, none: 'Normal text colour', start: '#c00000' },
];

export class ColourTools {
  constructor({ editor }) {
    this.editor = editor;
    this.tools = KINDS.map((kind) => this.build(kind));
    this.root = el('div', { class: 'tool-group colour-tools' }, this.tools.map(({ button, picker }) => [button, picker]));
  }

  build(kind) {
    const bar = el('span', { class: 'colour-bar', 'aria-hidden': 'true' });
    const button = el('button', {
      class: 'tool colour-tool',
      type: 'button',
      title: kind.label,
      'aria-label': kind.label,
      'aria-haspopup': 'menu',
      dataset: { colourTool: kind.type },
      onmousedown: (event) => event.preventDefault(),
      onclick: () => this.open(kind, button, picker),
    }, kind.face(), bar);
    // The system's own colour picker, opened from the menu.
    const picker = el('input', {
      type: 'color',
      class: 'colour-picker',
      tabindex: '-1',
      'aria-label': `Another ${kind.label.toLowerCase()}`,
      'aria-hidden': 'true',
      dataset: { colourPicker: kind.type },
      onchange: () => this.apply(kind.type, cleanColour(picker.value)),
    });
    return { kind, button, bar, picker };
  }

  // The colour where the cursor is, or at the start of what's selected.
  current(type) {
    const editor = this.editor();
    return editor ? cleanColour(editor.getAttributes(type).color) : null;
  }

  apply(type, colour) {
    const chain = this.editor()?.chain().focus();
    if (!chain) return;
    if (colour) chain.setMark(type, { color: colour }).run();
    else chain.unsetMark(type).run();
  }

  open(kind, button, picker) {
    const now = this.current(kind.type);
    const listed = kind.palette.some((item) => item.color === now);
    const box = button.getBoundingClientRect();
    openMenu({
      label: kind.label,
      returnTo: button,
      at: { x: box.left, y: box.bottom + 2 },
      items: [
        ...kind.palette.map((item) => ({
          label: item.name,
          swatch: shadeOf(kind.type, item.color),
          checked: item.color === now,
          run: () => this.apply(kind.type, item.color),
        })),
        'separator',
        {
          label: 'Another colour…',
          swatch: now && !listed ? shadeOf(kind.type, now) : null,
          checked: Boolean(now) && !listed,
          run: () => {
            picker.value = now ?? kind.start;
            picker.click();
          },
        },
        { label: kind.none, run: () => this.apply(kind.type, null) },
      ],
    });
  }

  update() {
    for (const { kind, bar } of this.tools) {
      const colour = this.current(kind.type);
      if (colour) {
        note(kind.type, colour);
        bar.setAttribute(ATTRIBUTES[kind.type], colour);
      } else {
        bar.removeAttribute(ATTRIBUTES[kind.type]);
      }
      bar.classList.toggle('set', Boolean(colour));
    }
  }
}
