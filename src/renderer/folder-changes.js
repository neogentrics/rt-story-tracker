// What has changed in the folders a project was brought in from. Everything starts at Decide later: nothing happens to a chapter or a
// file until the author picks it and presses Apply. src/main/folder/recheck.js holds the rules.
import { diffWordsWithSpace } from 'diff';
import { el, fill } from './dom.js';

const GROUPS = [
  { id: 'both', title: 'Changed in both places', note: 'Changed here and in the folder. Whichever you choose, both sets of words are kept.' },
  { id: 'folder', title: 'Changed in the folder', note: '' },
  { id: 'new', title: 'New in the folder', note: '' },
  { id: 'gone', title: 'No longer where it was', note: 'These are only reported. Nothing here is removed.' },
];

// What each choice is called, which depends on what it's a choice about.
function wording(entry, choice) {
  const isNew = entry.choices.includes('new');
  return {
    folder: entry.group === 'both' ? 'Use the folder’s' : 'Update from the folder',
    app: 'Keep the app’s',
    both: entry.what === 'A chapter' ? 'Keep both, as two chapters' : 'Keep both',
    new: entry.what === 'A chapter' ? 'Bring it in as a new chapter' : 'Bring in the new copy',
    chapter: 'Make it a chapter',
    file: 'Keep it as a file',
    leave: entry.group === 'gone' ? 'Stop listing it' : isNew ? 'Leave it as it is' : 'Leave it out',
    follow: 'Note its new place',
    add: 'Add it to the chapter’s earlier versions',
  }[choice];
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// "2 changed, 1 new and 1 gone", for the notice as a project opens.
export function summarise(entries) {
  const count = (ids) => entries.filter((entry) => ids.includes(entry.group)).length;
  const parts = [[count(['both', 'folder']), 'changed'], [count(['new']), 'new'], [count(['gone']), 'moved or gone']].filter(([many]) => many).map(([many, word]) => `${many} ${word}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? 'nothing';
}

function sideBySide({ app, folder }) {
  const column = (title, children, name) => el('div', { class: 'compare-side' }, el('h4', {}, title), el('div', { class: `compare-text ${name}`, tabindex: '0', role: 'group', 'aria-label': title }, children));
  if (app === null) return [column('In the folder', folder, 'from-folder')];
  const parts = diffWordsWithSpace(app, folder);
  const same = !parts.some((part) => part.added || part.removed);
  return [
    same ? el('p', { class: 'quiet-note compare-same' }, 'The words are the same. Only the formatting, or a title, differs.') : null,
    column('In the app', parts.filter((part) => !part.added).map((part) => (part.removed ? el('del', {}, part.value) : part.value)), 'from-app'),
    column('In the folder', parts.filter((part) => !part.removed).map((part) => (part.added ? el('ins', {}, part.value) : part.value)), 'from-folder'),
  ];
}

export async function openFolderChanges({ api, onError, onBefore = async () => {}, onApplied = async () => {} }) {
  document.getElementById('folder-changes')?.remove();
  let found = { folders: [], entries: [], books: [] };
  let working = false;

  const status = el('p', { id: 'changes-status', class: 'changes-status', role: 'status' });
  const folderList = el('ul', { id: 'changes-folders', class: 'changes-folders' });
  const list = el('div', { id: 'changes-list' });
  const bulk = el('button', { id: 'changes-bulk', type: 'button', hidden: true, onclick: () => chooseUpdates() }, 'Choose Update for all that changed only in the folder');
  const again = el('button', { id: 'changes-again', type: 'button', onclick: () => look() }, 'Check again');
  const apply = el('button', { id: 'changes-apply', class: 'primary', type: 'button', disabled: true, onclick: () => carryOut() }, 'Apply');

  const picks = () => [...list.querySelectorAll('.change')]
    .map((row) => ({ key: row.dataset.key, choice: row.querySelector('input[type="radio"]:checked')?.value, bookId: row.querySelector('select')?.value || null }))
    .filter((pick) => pick.choice);

  function countPicks() {
    const count = picks().length;
    apply.disabled = working || count === 0;
    apply.textContent = count ? `Apply ${plural(count, 'choice')}` : 'Apply';
  }

  // Only what changed in the folder alone. Where both changed, the author picks each one.
  function chooseUpdates() {
    for (const row of list.querySelectorAll('.change[data-group="folder"]')) {
      const update = row.querySelector('input[value="folder"]');
      if (update) update.checked = true;
    }
    countPicks();
  }

  function entryRow(entry) {
    const marks = entry.notes ?? { comments: 0, links: 0 };
    const carried = [marks.comments ? plural(marks.comments, 'comment') : '', marks.links ? plural(marks.links, 'record link') : ''].filter(Boolean).join(' and ');
    const option = (value, label, checked = false) => el('label', { class: 'change-choice' }, el('input', { type: 'radio', name: `pick-${entry.key}`, value, checked, onchange: countPicks }), el('span', {}, label));
    const place = entry.needsBook
      ? el(
        'select',
        { class: 'change-book', 'aria-label': `Where ${entry.title} goes` },
        el('option', { value: '' }, 'Choose where it goes…'),
        found.books.map((book) => el('option', { value: book.id }, book.title)),
        entry.choices.includes('file') || entry.what.startsWith('A file') ? el('option', { value: found.projectId }, 'The whole project') : null,
      )
      : null;
    if (place) place.value = entry.bookId ?? '';
    const compare = el('div', { class: 'compare', hidden: true });
    const show = entry.canCompare
      ? el('button', { type: 'button', class: 'change-compare', 'aria-expanded': 'false', 'aria-label': `Compare ${entry.title}`, onclick: async () => {
        if (!compare.hidden) {
          compare.hidden = true;
          show.setAttribute('aria-expanded', 'false');
          return;
        }
        try {
          fill(compare, sideBySide(await api.compareFolderChange(entry.key)));
          compare.hidden = false;
          show.setAttribute('aria-expanded', 'true');
        } catch (error) {
          status.textContent = error.message;
        }
      } }, 'Compare')
      : null;
    return el(
      'li',
      { class: 'change', dataset: { key: entry.key, group: entry.group } },
      el('div', { class: 'change-head' }, el('strong', {}, entry.title), el('span', { class: 'change-what' }, `${entry.what} · ${entry.rel}`), show),
      entry.note ? el('p', { class: 'quiet-note' }, entry.note) : null,
      carried && entry.choices.includes('folder') ? el('p', { class: 'change-warning' }, `It has ${carried}. If its text is replaced, ${marks.comments + marks.links === 1 ? 'it stays' : 'they stay'} with the earlier version, which you can restore.`) : null,
      el('div', { class: 'change-choices', role: 'radiogroup', 'aria-label': `What to do with ${entry.title}` }, option('', 'Decide later', true), entry.choices.map((choice) => option(choice, wording(entry, choice))), place),
      compare,
    );
  }

  function folderRow(folder) {
    const choose = (label) => el('button', { type: 'button', class: 'folder-choose', onclick: async () => {
      try {
        if (await api.locateFolder(folder.importId)) await look();
      } catch (error) {
        status.textContent = error.message;
      }
    } }, label);
    let state = [el('span', { class: 'quiet-note' }, 'Checked.')];
    if (!folder.linked) state = [el('span', { class: 'quiet-note' }, 'It wasn’t chosen on this computer, so it hasn’t been read.'), choose('Choose the folder…')];
    else if (!folder.there) state = [el('span', { class: 'quiet-note' }, 'It isn’t there now. Connect it and check again, or say where it is.'), choose('Choose where it is now…')];
    return el('li', { dataset: { linked: String(folder.linked) } }, el('span', { class: 'folder-path' }, folder.root), ...state);
  }

  function draw() {
    fill(folderList, found.folders.map(folderRow));
    fill(list, GROUPS.map((group) => {
      const here = found.entries.filter((entry) => entry.group === group.id);
      if (!here.length) return null;
      return el(
        'section',
        { class: 'change-group', dataset: { group: group.id } },
        el('h3', {}, `${group.title} (${here.length})`),
        group.note ? el('p', { class: 'quiet-note' }, group.note) : null,
        el('ul', {}, here.map(entryRow)),
      );
    }));
    bulk.hidden = !found.entries.some((entry) => entry.group === 'folder' && entry.choices.includes('folder'));
    countPicks();
  }

  function sayWhatIsThere() {
    if (!found.folders.length) return 'Nothing in this project was brought in with Find my files, so there’s no folder to check.';
    if (found.entries.length) return `${summarise(found.entries)}. Nothing has been changed.`;
    return found.folders.some((folder) => folder.linked && folder.there) ? 'Nothing has changed in the folder.' : 'No folder could be read.';
  }

  async function busy(work) {
    working = true;
    again.disabled = true;
    countPicks();
    try {
      await work();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      working = false;
      again.disabled = false;
      countPicks();
    }
  }

  async function read() {
    found = await api.checkFolders();
    draw();
  }

  function look() {
    return busy(async () => {
      status.textContent = 'Looking at the folder…';
      await read();
      status.textContent = sayWhatIsThere();
    });
  }

  function carryOut() {
    const chosen = picks();
    return busy(async () => {
      // What's been typed is saved first, so a chapter is judged as it really is.
      await onBefore();
      status.textContent = 'Applying…';
      const result = await api.applyFolderChanges(chosen);
      await onApplied(result.outline);
      await read();
      const left = result.skipped.map((one) => `${one.title}: ${one.why}`).join(' ');
      status.textContent = `Applied ${plural(result.applied.length, 'choice')}.${left ? ` Left as it was — ${left}` : ''}`;
    });
  }

  const dialog = el(
    'dialog',
    { id: 'folder-changes', class: 'dialog changes-window', 'aria-labelledby': 'changes-title' },
    el('h2', { id: 'changes-title' }, 'Changes in the folder'),
    el('p', { class: 'quiet-note' }, 'The folder is only read, never changed. Nothing here changes until you choose it and press Apply.'),
    folderList,
    status,
    bulk,
    list,
    el('div', { class: 'dialog-actions changes-actions' }, again, el('button', { id: 'changes-close', type: 'button', onclick: () => dialog.close() }, 'Close'), apply),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  try {
    await look();
  } catch (error) {
    onError(error.message);
  }
}
