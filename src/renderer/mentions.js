// Type @ and a name to link a record. The words stay in the text as ordinary words, so they count, export and search like
// any others. The mark only holds the record's ID, which is how a record knows every chapter it's in.
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { el } from './dom.js';

const TRIGGER = /(?:^|\s)@([^\s@]{0,40})$/;
const DELAY_MS = 120;

export const MentionMark = Mark.create({
  name: 'mention',
  inclusive: false,
  excludes: '',
  addOptions() {
    return { onOpen: null };
  },
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (node) => node.getAttribute('data-mention'),
        renderHTML: (attributes) => ({ 'data-mention': attributes.id }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'mention-mark', title: 'Ctrl or Cmd and click to open this record' }), 0];
  },
  // Plain clicks only place the cursor, so a name in the middle of a sentence can still be edited.
  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    return [
      new Plugin({
        key: new PluginKey('mentionOpen'),
        props: {
          handleClick: (_view, _pos, event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-mention]') : null;
            if (!target || !(event.ctrlKey || event.metaKey) || !onOpen) return false;
            onOpen(target.getAttribute('data-mention'));
            return true;
          },
        },
      }),
    ];
  },
});

// Where the cursor is, if it's just after an @ and the start of a name.
function triggerAt(state) {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const found = TRIGGER.exec(before);
  if (!found) return null;
  return { from: $from.pos - found[1].length - 1, to: $from.pos, query: found[1] };
}

export function mentionSuggestions({ api, onError, selfId = () => null }) {
  return Extension.create({
    name: 'mentionSuggestions',
    addProseMirrorPlugins() {
      let results = [];
      let index = 0;
      let range = null;
      let asked = null;
      let timer = null;
      let dismissedAt = null;
      let pop = null;
      let loadedFor = null;
      let chooseWhenReady = false;

      const close = () => {
        clearTimeout(timer);
        pop?.remove();
        pop = null;
        range = null;
        asked = null;
        loadedFor = null;
        chooseWhenReady = false;
        results = [];
      };

      const choose = (view, entry) => {
        if (!range || !entry) return;
        const { schema } = view.state;
        const mark = schema.marks.mention.create({ id: entry.id });
        const tr = view.state.tr.replaceWith(range.from, range.to, [schema.text(entry.title, [mark]), schema.text(' ')]);
        view.dispatch(tr.scrollIntoView());
        close();
        view.focus();
      };

      const draw = (view) => {
        if (!range) return;
        if (!pop) {
          pop = el('ul', { class: 'mention-pop', role: 'listbox', 'aria-label': 'Records to link' });
          document.body.append(pop);
        }
        const spot = view.coordsAtPos(range.to);
        pop.style.left = `${Math.min(spot.left, window.innerWidth - 300)}px`;
        pop.style.top = `${spot.bottom + 4}px`;
        pop.replaceChildren(
          ...(results.length
            ? results.map((entry, place) =>
                el(
                  'li',
                  {
                    class: `mention-row${place === index ? ' active' : ''}`,
                    role: 'option',
                    'aria-selected': String(place === index),
                    onmousedown: (event) => {
                      event.preventDefault();
                      choose(view, entry);
                    },
                  },
                  el('span', { class: 'picker-title' }, entry.title),
                  el('span', { class: 'picker-note' }, [entry.label, entry.typeTitle].filter(Boolean).join(' · ')),
                ))
            : [el('li', { class: 'picker-empty' }, 'No record by that name.')]),
        );
      };

      const ask = (view, query) => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const found = await api.findRecords({ query });
            if (asked !== query || !range) return;
            results = found.filter((entry) => entry.id !== selfId());
            loadedFor = query;
            index = 0;
            draw(view);
            // Enter was pressed before the names for this much typing had arrived.
            if (chooseWhenReady) {
              chooseWhenReady = false;
              choose(view, results[0]);
            }
          } catch (error) {
            onError?.(error.message);
          }
        }, DELAY_MS);
      };

      return [
        new Plugin({
          key: new PluginKey('mentionSuggest'),
          view: () => ({
            update(view) {
              const found = triggerAt(view.state);
              if (!found || found.from === dismissedAt) {
                if (!found) dismissedAt = null;
                close();
                return;
              }
              const first = !range;
              range = { from: found.from, to: found.to };
              if (first || asked !== found.query) {
                asked = found.query;
                ask(view, found.query);
              }
              draw(view);
            },
            destroy: close,
          }),
          props: {
            handleKeyDown: (view, event) => {
              if (!range) return false;
              if (event.key === 'Escape') {
                dismissedAt = range.from;
                close();
                return true;
              }
              if (loadedFor !== asked && (event.key === 'Enter' || event.key === 'Tab')) {
                chooseWhenReady = true;
                return true;
              }
              if (!results.length) return false;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                index = (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
                draw(view);
                return true;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                choose(view, results[index]);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
