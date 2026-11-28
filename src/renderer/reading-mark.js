// The mark on the sentence being read. It's drawn the way Find marks its matches, as something laid over the page, so it changes
// nothing in the chapter and nothing for Undo. It moves with the words as they're edited.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('reading');

export const ReadingMark = Extension.create({
  name: 'readingMark',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: () => null,
          apply(transaction, value) {
            const wanted = transaction.getMeta(key);
            if (wanted !== undefined) return wanted;
            if (!value || !transaction.docChanged) return value;
            const from = transaction.mapping.map(value.from, 1);
            const to = transaction.mapping.map(value.to, -1);
            return { from, to: Math.max(from, to) };
          },
        },
        props: {
          decorations(state) {
            const at = key.getState(state);
            if (!at || at.to <= at.from || at.to > state.doc.content.size) return null;
            return DecorationSet.create(state.doc, [Decoration.inline(at.from, at.to, { class: 'reading-sentence' })]);
          },
        },
      }),
    ];
  },
});

// `range` is { from, to }, or null for no mark.
export function markReading(editor, range) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, range).setMeta('addToHistory', false));
}

// Where the marked sentence is now.
export const readingRange = (editor) => (editor.isDestroyed ? null : key.getState(editor.state));
