// Frozen versions of a record: freezing one, looking at one, writing a correction against one, and printing records. A frozen
// version is never changed and can't be unfrozen. The only things that can be done about a mistake in one are to say so, and
// to fix it in the next version, which is the record as it's open.
import { showValue } from '../shared/records.js';
import { plainText, toDocument } from '../shared/text.js';
import { el, fill } from './dom.js';
import { icon } from './icons.js';
import { ensurePass } from './security-dialog.js';

const when = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

// Freezing asks which book, then asks again by name, because it can't be taken back.
export async function openFreeze({ api, record, revision, covered, onError, onDone }) {
  document.getElementById('freeze-dialog')?.remove();
  const books = (await api.recordBooks()).filter((book) => !covered.includes(book.id));
  if (!books.length) {
    onError('Every book already has a version of this. Fixes go in the version for a new book.');
    return;
  }
  const pick = el('select', { id: 'freeze-book', 'aria-label': 'The book this version covers' }, books.map((book) => el('option', { value: book.id }, book.title)));
  const sure = el('p', { id: 'freeze-sure', class: 'freeze-sure' });
  const message = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const say = () => {
    const book = books.find((item) => item.id === pick.value);
    sure.textContent = `Freeze “${record.title}” as Revision ${revision} for “${book.title}”? A frozen version can never be changed or unfrozen. Fixes go in the next version.`;
  };
  pick.addEventListener('change', say);
  say();
  const dialog = el(
    'dialog',
    { id: 'freeze-dialog', class: 'dialog' },
    el('h2', {}, 'Freeze this version'),
    el('label', { class: 'field' }, el('span', {}, 'The book it covers'), pick),
    sure,
    message,
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      el('button', {
        id: 'freeze-confirm',
        class: 'primary',
        type: 'button',
        onclick: async () => {
          try {
            await api.freezeRecord({ id: record.id, bookId: pick.value });
            dialog.close();
            await onDone();
          } catch (error) {
            message.textContent = error.message;
            message.hidden = false;
          }
        },
      }, icon('lock'), 'Freeze'),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// A mistake in a frozen version is written down against it. The fix is made in the next version.
function openCorrection({ api, record, version, onError, onDone }) {
  document.getElementById('correction-dialog')?.remove();
  const note = el('textarea', { id: 'correction-note', rows: '4', 'aria-label': 'What needs correcting', placeholder: 'What was wrong, and what it should say' });
  const dialog = el(
    'dialog',
    { id: 'correction-dialog', class: 'dialog' },
    el('h2', {}, `Correct Revision ${version.number}`),
    el('p', { class: 'quiet-note' }, `Revision ${version.number} stays as it was frozen. This is written down against it, and the fix goes in the next revision, which is what you’re editing now. The note stays with the author: it isn’t printed.`),
    note,
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      el('button', {
        id: 'correction-save',
        class: 'primary',
        type: 'button',
        onclick: async () => {
          try {
            await api.correctRecord({ id: record, versionId: version.id, note: note.value });
            dialog.close();
            await onDone();
          } catch (error) {
            onError(error.message);
          }
        },
      }, 'Write it down'),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  note.focus();
}

// Printing records. Only the printable part is ever in what's printed: fields marked for the author, and the author's own
// notes, are left out, and there's no way to ask for them.
export async function openPrintRecords({ api, type, ids = null, version = null, onError }) {
  document.getElementById('print-records')?.remove();
  if (!(await ensurePass(api, 'A printed file isn’t protected: anyone can read it.'))) return;
  const choice = { value: type.versioning ? 'frozen' : 'working' };
  const message = el('p', { class: 'quiet-note', role: 'status', id: 'print-result' });
  const radios = [];
  if (!version && type.versioning) {
    for (const [value, text] of [['frozen', 'The latest frozen version of each'], ['working', 'What I’m editing now, marked as a draft']]) {
      const radio = el('input', { type: 'radio', name: 'print-which', value });
      radio.checked = value === choice.value;
      radio.addEventListener('change', () => {
        choice.value = value;
      });
      radios.push(el('label', { class: 'check' }, radio, text));
    }
  }
  const run = async (save) => {
    try {
      const result = await api.printRecords({ typeId: type.id, ...(ids ? { ids } : {}), version: version ?? choice.value, save });
      if (!result) return;
      message.textContent = `${result.pages} ${result.pages === 1 ? 'page' : 'pages'}${result.skipped ? `. ${result.skipped} left out for having no frozen version yet` : ''}${result.file ? `. Saved to ${result.file}` : ''}.`;
    } catch (error) {
      message.textContent = '';
      onError(error.message);
      dialog.close();
    }
  };
  const dialog = el(
    'dialog',
    { id: 'print-records', class: 'dialog' },
    el('h2', {}, ids?.length === 1 ? 'Print this record' : 'Print records'),
    el('p', { class: 'quiet-note' }, `Each record starts a page, headed “${type.labelWord ?? 'Record'}” with its number and revision.${type.versioning ? ' Only the printable part is printed: fields marked author only, and your own notes, are left out.' : ''}`),
    ...radios,
    message,
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Close'),
      el('button', { id: 'print-save', type: 'button', onclick: () => run(true) }, 'Save as PDF…'),
      el('button', { id: 'print-preview', class: 'primary', type: 'button', onclick: () => run(false) }, icon('print'), 'Preview'),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// A frozen version, as the author sees it: read-only, every field marked for print or for the author, and what changed.
export class VersionView {
  constructor(root, { api, onError, onBack, onOpenRecord }) {
    this.api = api;
    this.onError = onError;
    this.onBack = onBack;
    this.onOpenRecord = onOpenRecord;
    this.root = el('div', { class: 'record-page version-view' });
    root.replaceChildren(this.root);
  }

  async open(versionId) {
    const version = await this.api.getRecordVersion(versionId);
    const { type, revision } = await this.api.getRecord(version.recordId);
    this.version = version;
    this.render({ type, revision });
  }

  render({ type, revision }) {
    const { version } = this;
    const names = (id) => version.targets[id] ?? '';
    const note = (document) => plainText(toDocument(document)).trim();
    const list = (items) => (items.length ? el('ul', { class: 'change-list' }, items.map((item) => el('li', {}, item))) : el('p', { class: 'quiet-note' }, 'None.'));
    const fields = version.fields.map((field) => {
      const text = showValue(field, version.values[field.id], names);
      return el(
        'div',
        { class: 'record-field' },
        el('span', { class: 'field-label' }, field.name, el('small', { class: field.audience === 'print' ? 'print-tag' : 'author-tag' }, field.audience === 'print' ? ' in print' : ' author only')),
        el('div', { class: 'frozen-value', dataset: { field: field.id } }, text || '—'),
      );
    });
    fill(
      this.root,
      el(
        'header',
        { class: 'record-head' },
        el('span', { class: 'type-chip' }, type.title),
        el('h2', { class: 'frozen-title' }, version.title),
        el('span', { class: 'frozen-label', id: 'frozen-label' }, version.label),
        el('button', { class: 'row-action', title: 'Print this version', 'aria-label': 'Print this version', onclick: () => openPrintRecords({ api: this.api, type, ids: [version.recordId], version: version.id, onError: this.onError }) }, icon('print')),
      ),
      el(
        'div',
        { class: 'lock-banner frozen-banner', id: 'frozen-banner', role: 'status' },
        icon('lock'),
        el('span', {}, `Frozen with “${version.bookTitle}” on ${when(version.frozenAt)}. This version can’t be changed or unfrozen. Fixes go in Revision ${revision}.`),
        el('button', { id: 'correct-version', onclick: () => openCorrection({ api: this.api, record: version.recordId, version, onError: this.onError, onDone: () => this.onBack() }) }, `Correct this in Revision ${revision}…`),
      ),
      el('div', { class: 'record-fields' }, fields),
      el('section', { class: 'record-notes' }, el('h3', {}, 'Notes for print'), el('p', { class: 'frozen-notes' }, note(version.printNotes) || '—')),
      el('section', { class: 'record-notes author-notes' }, el('h3', {}, 'Author-only notes'), el('p', { class: 'frozen-notes' }, note(version.authorNotes) || '—')),
      el('section', { class: 'record-notes' }, el('h3', {}, 'What changed since the last version, in print'), list(version.changes.print)),
      el('section', { class: 'record-notes author-notes' }, el('h3', {}, 'What changed, for the author'), list(version.changes.author)),
      el('p', {}, el('button', { id: 'version-back', onclick: () => this.onBack() }, '← Back to the record')),
    );
  }

  destroy() {
    this.root.replaceChildren();
  }
}
