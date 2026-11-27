// Bringing records in from spreadsheets or Markdown files: choose the files, say where each column goes, and see what
// happened. Nothing is written until the button is pressed, and a copy of the project is kept first.
import { KIND_LABELS } from '../shared/records.js';
import { el, fill } from './dom.js';
import { icon } from './icons.js';

const NEW_KIND = '@newtype';

export function openRecordsImport({ api, types, type = null, onDone, onError }) {
  document.getElementById('records-import')?.remove();
  const state = { loaded: null, preview: null, typeId: type?.id ?? (types[0]?.id ?? NEW_KIND), newName: '', duplicates: 'skip' };
  const targets = new Map();

  const body = el('div', { class: 'import-body' });
  const message = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const actions = el('div', { class: 'dialog-actions' });
  const dialog = el('dialog', { id: 'records-import', class: 'dialog wide' }, el('h2', {}, 'Bring in records'), body, message, actions);
  dialog.addEventListener('close', () => dialog.remove());

  const fail = (error) => {
    message.textContent = error.message;
    message.hidden = false;
  };
  const clearFail = () => {
    message.hidden = true;
  };
  const typeNow = () => types.find((item) => item.id === state.typeId) ?? null;

  const choose = async (picker) => {
    clearFail();
    try {
      const loaded = await picker();
      if (!loaded) return;
      state.loaded = loaded;
      if (!state.newName) state.newName = loaded.names[0]?.replace(/\.[^.]+$/, '') ?? '';
      await refresh();
    } catch (error) {
      fail(error);
    }
  };

  // The suggestions depend on the kind chosen, so choosing another asks again.
  const refresh = async () => {
    state.preview = await api.previewRecordImport(state.typeId === NEW_KIND ? null : state.typeId);
    targets.clear();
    for (const column of state.preview.columns) targets.set(column.label, column.target);
    drawChoose();
  };

  const optionsFor = (column) => {
    const current = typeNow();
    return [
      el('option', { value: '@name' }, 'The name'),
      ...(current?.numbering ? [el('option', { value: '@number' }, 'The number')] : []),
      ...(current?.fields ?? []).map((field) => el('option', { value: field.id }, `Field: ${field.name} (${KIND_LABELS[field.kind].toLowerCase()})`)),
      el('option', { value: '@new' }, `A new field, ${column.label} (${KIND_LABELS[column.kind].toLowerCase()})`),
      el('option', { value: '@skip' }, state.preview.kind === 'markdown' ? 'Leave it in the notes' : 'Leave it out'),
    ];
  };

  const drawChoose = () => {
    const kindPick = el(
      'select',
      { id: 'import-kind', 'aria-label': 'Bring them in as' },
      types.map((item) => el('option', { value: item.id }, item.title)),
      el('option', { value: NEW_KIND }, 'A new kind of record…'),
    );
    kindPick.value = state.typeId;
    kindPick.addEventListener('change', async () => {
      state.typeId = kindPick.value;
      if (state.loaded) {
        try {
          await refresh();
        } catch (error) {
          fail(error);
        }
      } else drawChoose();
    });
    const newName = el('input', { id: 'import-new-name', type: 'text', maxlength: '500', value: state.newName, 'aria-label': 'Name of the new kind', placeholder: 'Character, Place…' });
    newName.addEventListener('input', () => {
      state.newName = newName.value;
    });
    const files = el(
      'div',
      { class: 'import-files' },
      el('button', { id: 'import-choose-files', onclick: () => choose(() => api.chooseRecordFiles()) }, icon('open'), 'Choose files…'),
      el('button', { id: 'import-choose-folder', onclick: () => choose(() => api.chooseRecordFolder()) }, icon('folder'), 'Choose a folder…'),
      state.loaded ? el('span', { class: 'quiet-note', id: 'import-summary' }, `${state.loaded.kind === 'csv' ? 'Spreadsheet' : 'Markdown'}: ${state.loaded.rows} ${state.loaded.rows === 1 ? 'record' : 'records'} from ${state.loaded.files} ${state.loaded.files === 1 ? 'file' : 'files'}.`) : null,
    );
    fill(
      body,
      el('p', { class: 'quiet-note' }, 'A spreadsheet gives one record for each row. A Markdown file gives one record, and its “Label: value” lines can go to fields. The files themselves aren’t changed.'),
      files,
      el('label', { class: 'field' }, el('span', {}, 'Bring them in as'), kindPick),
      state.typeId === NEW_KIND ? el('label', { class: 'field' }, el('span', {}, 'Name of the new kind'), newName) : null,
      state.preview ? mapping() : null,
    );
    drawActions();
  };

  const mapping = () => {
    const rows = state.preview.columns.map((column) => {
      const pick = el('select', { 'aria-label': `Where ${column.label} goes`, dataset: { label: column.label } }, optionsFor(column));
      const wanted = targets.get(column.label);
      pick.value = [...pick.options].some((option) => option.value === wanted) ? wanted : '@skip';
      targets.set(column.label, pick.value);
      pick.addEventListener('change', () => {
        targets.set(column.label, pick.value);
      });
      return el(
        'tr',
        {},
        el('th', { scope: 'row' }, column.label),
        el('td', { class: 'import-count' }, String(column.count)),
        el('td', { class: 'import-samples' }, column.samples.join(' · ')),
        el('td', {}, pick),
      );
    });
    const dupes = el('select', { id: 'import-duplicates', 'aria-label': 'If a name is already there' }, el('option', { value: 'skip' }, 'Leave it alone'), el('option', { value: 'update' }, 'Fill in what the file has'));
    dupes.value = state.duplicates;
    dupes.addEventListener('change', () => {
      state.duplicates = dupes.value;
    });
    return el(
      'div',
      { class: 'import-map' },
      el('h3', {}, 'Where each one goes'),
      el('div', { class: 'import-table-wrap' }, el('table', { class: 'import-table' }, el('thead', {}, el('tr', {}, el('th', {}, state.preview.kind === 'csv' ? 'Column' : 'Label'), el('th', {}, 'Filled'), el('th', {}, 'For example'), el('th', {}, 'Goes to'))), el('tbody', {}, rows))),
      el('label', { class: 'field' }, el('span', {}, 'A name that’s already there'), dupes),
    );
  };

  const drawActions = () => {
    fill(
      actions,
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      state.preview ? el('button', { id: 'import-run', class: 'primary', type: 'button', onclick: () => run() }, `Bring in ${state.preview.rows} ${state.preview.rows === 1 ? 'record' : 'records'}`) : null,
    );
  };

  const run = async () => {
    clearFail();
    const go = actions.querySelector('#import-run');
    if (go) go.disabled = true;
    try {
      const result = await api.runRecordImport({
        ...(state.typeId === NEW_KIND ? { newTypeName: state.newName } : { typeId: state.typeId }),
        mapping: [...targets].map(([label, target]) => ({ label, target })),
        duplicates: state.duplicates,
      });
      drawResult(result);
      await onDone(result);
    } catch (error) {
      fail(error);
      if (go) go.disabled = false;
    }
  };

  const drawResult = (result) => {
    const parts = [`${result.created} made`, ...(result.updated ? [`${result.updated} filled in`] : []), ...(result.skipped ? [`${result.skipped} left alone`] : [])];
    fill(
      body,
      el('h3', {}, 'Done'),
      el('p', { id: 'import-result' }, parts.join(', ') + '.'),
      result.newFields.length ? el('p', { class: 'quiet-note' }, `New fields: ${result.newFields.join(', ')}.`) : null,
      result.problems.length
        ? el('div', {}, el('h3', {}, 'Things to look at'), el('ul', { class: 'import-problems' }, [...result.problems.map((item) => el('li', {}, el('strong', {}, `${item.where}: `), item.message)), result.moreProblems ? el('li', {}, `…and ${result.moreProblems} more.`) : null]))
        : el('p', { class: 'quiet-note' }, 'Nothing needed a second look.'),
      el('p', { class: 'quiet-note' }, 'A copy of the project from before this was kept in its backups.'),
    );
    actions.replaceChildren(el('button', { id: 'import-done', class: 'primary', type: 'button', onclick: () => dialog.close() }, 'Done'));
  };

  document.body.append(dialog);
  dialog.showModal();
  drawChoose();
  return dialog.querySelector('#import-choose-files')?.focus();
}
