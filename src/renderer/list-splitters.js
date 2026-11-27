// The lines beside the two lists, to make them wider or narrower: by dragging, or with the arrow keys once one has the focus, and Enter or
// a double click to go back to the usual width. The widths are remembered on this computer. However wide a list was left, it's held back
// in a smaller window, so the page always keeps room to be written in.
import { el } from './dom.js';

const SMALLEST = 130;
const PAGE_ROOM = 320;
const STEP = 16;
const KEYS = { books: 'width:books', chapters: 'width:chapters' };

// `columns` holds the two lists and the page. `books` and `chapters` are the lists' columns, and `page` the page's.
export function createListSplitters({ columns, books, chapters, page, remember }) {
  const sides = {
    books: { column: books, label: 'Width of the books list' },
    chapters: { column: chapters, label: 'Width of the chapters list' },
  };
  const saved = {};
  for (const name of Object.keys(sides)) {
    const value = Number(remember.get(KEYS[name]));
    if (Number.isFinite(value) && value > 0) saved[name] = value;
  }

  // In a very small window the two lists share one column, so one line sets its width.
  const stacked = () => Math.abs(books.getBoundingClientRect().left - chapters.getBoundingClientRect().left) < 2;
  // The look-up panel sits beside the page, in the same column, and needs room of its own while it's open.
  const pageRoom = () => PAGE_ROOM + (page.querySelector('.lookup-pane:not([hidden])')?.offsetWidth ?? 0);
  const widthOf = (name) => Math.round(sides[name].column.getBoundingClientRect().width);
  const widest = (name) => {
    const other = name === 'books' ? 'chapters' : 'books';
    const taken = stacked() ? 0 : widthOf(other);
    return Math.max(SMALLEST, columns.clientWidth - taken - pageRoom());
  };

  function describe() {
    for (const [name, side] of Object.entries(sides)) {
      side.line.setAttribute('aria-valuemin', String(SMALLEST));
      side.line.setAttribute('aria-valuemax', String(widest(name)));
      side.line.setAttribute('aria-valuenow', String(widthOf(name)));
    }
    chapters.classList.toggle('shares-column', stacked());
  }

  function apply() {
    if (!columns.isConnected || columns.clientWidth === 0 || widthOf('books') === 0) return;
    for (const name of Object.keys(sides)) columns.style.removeProperty(`--${name}-width`);
    const one = stacked();
    const names = one ? ['books'] : ['books', 'chapters'];
    const wanted = Object.fromEntries(names.map((name) => [name, saved[name] ?? widthOf(name)]));
    // What the lists want beyond what there is comes off each in proportion to how far it is above the smallest.
    const over = names.reduce((sum, name) => sum + wanted[name], 0) - Math.max(names.length * SMALLEST, columns.clientWidth - pageRoom());
    const spare = names.reduce((sum, name) => sum + Math.max(0, wanted[name] - SMALLEST), 0);
    for (const name of names) {
      const width = over > 0 && spare > 0 ? Math.max(SMALLEST, Math.floor(wanted[name] - (over * Math.max(0, wanted[name] - SMALLEST)) / spare)) : Math.max(SMALLEST, wanted[name]);
      if (saved[name] || width !== widthOf(name)) columns.style.setProperty(`--${name}-width`, `${width}px`);
    }
    describe();
  }

  function set(name, width) {
    saved[name] = Math.round(Math.min(widest(name), Math.max(SMALLEST, width)));
    remember.set(KEYS[name], String(saved[name]));
    columns.style.setProperty(`--${name}-width`, `${saved[name]}px`);
    describe();
  }

  function reset(name) {
    delete saved[name];
    remember.set(KEYS[name], '');
    apply();
  }

  for (const [name, side] of Object.entries(sides)) {
    const line = el('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': side.label, tabindex: '0', title: 'Drag to resize. The arrow keys resize too, and Enter goes back to the usual width.', dataset: { side: name } });
    side.line = line;
    side.column.append(line);
    line.addEventListener('keydown', (event) => {
      const by = event.shiftKey ? STEP * 4 : STEP;
      const to = { ArrowLeft: widthOf(name) - by, ArrowRight: widthOf(name) + by, Home: SMALLEST, End: widest(name) }[event.key];
      if (to !== undefined) {
        event.preventDefault();
        set(name, to);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        reset(name);
      }
    });
    line.addEventListener('dblclick', () => reset(name));
    line.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      line.setPointerCapture(event.pointerId);
      line.classList.add('dragging');
      const left = side.column.getBoundingClientRect().left;
      const move = (moved) => set(name, moved.clientX - left);
      const end = () => {
        line.classList.remove('dragging');
        line.removeEventListener('pointermove', move);
        line.removeEventListener('pointerup', end);
        line.removeEventListener('pointercancel', end);
      };
      line.addEventListener('pointermove', move);
      line.addEventListener('pointerup', end);
      line.addEventListener('pointercancel', end);
    });
  }

  let waiting = 0;
  const soon = () => {
    if (waiting) return;
    waiting = requestAnimationFrame(() => {
      waiting = 0;
      apply();
    });
  };
  let seen = 0;
  const watch = new ResizeObserver(() => {
    if (columns.clientWidth !== seen) {
      seen = columns.clientWidth;
      soon();
    }
  });
  watch.observe(columns);
  // The look-up panel opens inside the page's column, which doesn't change size, so its showing and hiding is watched for.
  const shows = new MutationObserver((changes) => {
    if (changes.some((change) => change.target.classList.contains('lookup-pane'))) soon();
  });
  shows.observe(page, { subtree: true, attributes: true, attributeFilter: ['hidden'] });

  return {
    apply: soon,
    destroy: () => {
      watch.disconnect();
      shows.disconnect();
      cancelAnimationFrame(waiting);
    },
  };
}
