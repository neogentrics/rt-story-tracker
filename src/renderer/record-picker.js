// A small box under a button for choosing a record by typing part of its name. It can also make a new one on the spot, so
// a link to something that isn't written up yet doesn't mean leaving the page.
import { el } from './dom.js';

const DELAY_MS = 120;

export function openRecordPicker({ api, anchor, typeId = null, typeTitle = '', exclude = [], onPick, onError }) {
  document.querySelector('.record-picker')?.remove();
  let found = [];
  let at = 0;
  let timer = null;
  let closed = false;
  let loadedFor = null;

  const input = el('input', { type: 'text', class: 'picker-input', placeholder: 'Type a name or number', 'aria-label': 'Find a record' });
  const list = el('ul', { class: 'picker-list', role: 'listbox' });
  const box = el('div', { class: 'record-picker' }, input, list);

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    document.removeEventListener('pointerdown', outside, true);
    box.remove();
    anchor.focus();
  };
  const outside = (event) => {
    if (!box.contains(event.target) && event.target !== anchor) close();
  };

  const choose = async (entry) => {
    try {
      if (entry.make) {
        const made = await api.createRecord({ typeId, title: entry.make });
        await onPick({ id: made.id, title: made.title, typeId, typeTitle, created: true });
      } else {
        await onPick(entry);
      }
      close();
    } catch (error) {
      onError?.(error.message);
    }
  };

  const draw = () => {
    const typed = input.value.trim();
    const rows = [...found];
    const exact = found.some((entry) => entry.title.toLowerCase() === typed.toLowerCase());
    if (typeId && typed && !exact) rows.push({ make: typed });
    at = Math.max(0, Math.min(at, rows.length - 1));
    list.replaceChildren(
      ...(rows.length
        ? rows.map((entry, place) =>
            el(
              'li',
              { class: `picker-row${place === at ? ' active' : ''}`, role: 'option', 'aria-selected': String(place === at), onclick: () => choose(entry) },
              entry.make
                ? el('span', { class: 'picker-title' }, `New ${typeTitle ? typeTitle.toLowerCase() : 'record'}: “${entry.make}”`)
                : [
                    el('span', { class: 'picker-title' }, entry.title),
                    el('span', { class: 'picker-note' }, [entry.label, entry.typeTitle].filter(Boolean).join(' · ')),
                  ],
            ))
        : [el('li', { class: 'picker-empty' }, typed ? 'Nothing matches.' : 'Nothing here yet.')]),
    );
    box.rows = rows;
  };

  const search = async () => {
    const asked = input.value;
    try {
      const results = await api.findRecords({ query: asked, ...(typeId ? { typeId } : {}) });
      if (asked !== input.value) return;
      found = results.filter((entry) => !exclude.includes(entry.id));
      loadedFor = asked;
      at = 0;
      draw();
    } catch (error) {
      onError?.(error.message);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, DELAY_MS);
  });
  input.addEventListener('keydown', async (event) => {
    // Enter picks from what the list shows, so if the list hasn't caught up with the typing, it catches up first.
    if (event.key === 'Enter' && loadedFor !== input.value) {
      event.preventDefault();
      clearTimeout(timer);
      await search();
    }
    const rows = box.rows ?? [];
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      at = (at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(rows.length, 1);
      draw();
    } else if (event.key === 'Enter' && rows[at]) {
      event.preventDefault();
      choose(rows[at]);
    }
  });

  anchor.after(box);
  document.addEventListener('pointerdown', outside, true);
  input.focus();
  search();
  return { close };
}
