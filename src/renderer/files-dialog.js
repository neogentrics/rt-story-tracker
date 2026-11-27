// The Files view: everything kept with a book, a series or the whole project, sorted into sections. A file can be looked at, moved to
// another section or book, used as a cover, made into a chapter or a record, saved as a copy, or put in the Trash, one at a time or many
// at once. Files stay encrypted, and only "Save a copy" writes one out.
import { SECTIONS, sectionLabel } from '../shared/sections.js';
import { el, fill, formatCount, words } from './dom.js';
import { icon } from './icons.js';
import { ensurePass } from './security-dialog.js';

// A project can hold thousands of files, so the list shows this many at a time, and a picture is only read when its row comes into view.
const SHOWN_AT_A_TIME = 100;
const SMALL_PICTURE = 5 * 1024 * 1024;

export function sizeOf(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${formatCount(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

const filesWord = (count) => `${formatCount(count)} ${count === 1 ? 'file' : 'files'}`;

// `id` is what's being looked at and `projectId` is the whole project. `onBefore` saves the page before writing is brought in, and
// `onOutline` shows the new chapters.
export async function openFiles({ api, id, title, projectId, onError, onBefore = async () => {}, onOutline = () => {} }) {
  document.getElementById('attachments')?.remove();
  let scope = id;
  let data = { files: [], covers: [], places: [] };
  let section = 'all';
  let search = '';
  let shown = SHOWN_AT_A_TIME;
  const chosen = new Set();

  const status = el('p', { id: 'files-status', class: 'quiet-note files-status', role: 'status' });
  const say = (text) => {
    status.textContent = text ?? '';
  };
  const attempt = async (work) => {
    try {
      await work();
    } catch (error) {
      say(error.message);
      onError(error.message);
    }
  };

  const list = el('ul', { id: 'attachment-list', class: 'attachment-list' });
  const side = el('aside', { id: 'file-side', class: 'file-side', 'aria-label': 'About the chosen file', hidden: true });
  const nav = el('div', { class: 'files-nav', role: 'group', 'aria-label': 'Sections' });

  const thumbs = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbs.unobserve(entry.target);
      api.previewFile(entry.target.dataset.file).then((look) => {
        if (look.kind === 'picture') entry.target.src = look.url;
      }).catch(() => {});
    }
  }, { root: list, rootMargin: '200px' });

  const placeName = (place) => (place.kind === 'project' ? `${place.title} (the whole project)` : `${' '.repeat(Math.max(0, place.depth - 1))}${place.title}`);
  const matching = () => {
    const wanted = search.trim().toLowerCase();
    return data.files.filter((file) => (section === 'all' || file.section === section) && (!wanted || `${file.name} ${file.from ?? ''}`.toLowerCase().includes(wanted)));
  };

  async function load() {
    data = await api.listFiles(scope);
    const present = new Set(data.files.map((file) => file.id));
    for (const one of chosen) if (!present.has(one)) chosen.delete(one);
    draw();
  }

  const closeSide = () => {
    side.hidden = true;
    fill(side);
  };

  function showSide(heading, ...children) {
    fill(
      side,
      el('div', { class: 'file-side-head' }, el('h3', {}, heading), el('button', { type: 'button', class: 'quiet', id: 'file-side-close', 'aria-label': 'Close the side panel', onclick: closeSide }, icon('close'))),
      ...children,
    );
    side.hidden = false;
  }

  const look = (file) => attempt(async () => {
    showSide(file.name, el('p', { class: 'quiet-note' }, 'Opening…'));
    const seen = await api.previewFile(file.id);
    const body = {
      picture: () => el('img', { class: 'file-picture', src: seen.url, alt: file.name }),
      sound: () => el('audio', { class: 'file-sound', controls: true, src: seen.url, 'aria-label': `Play ${file.name}` }),
      text: () => el('div', {}, el('p', { class: 'quiet-note' }, `${words(seen.words)}${seen.cut ? ', and this is the first part' : ''}`), el('pre', { class: 'file-text', tabindex: '0' }, seen.text || 'There are no words in it.')),
      none: () => el('p', { class: 'quiet-note' }, seen.why),
    }[seen.kind]();
    showSide(file.name, el('p', { class: 'quiet-note' }, file.from || 'Added by hand'), body);
  });

  // Asks which book, or which kind of record, before something is made from a file.
  function askWhere(heading, note, label, options, button, onYes) {
    const choice = el('select', { id: 'file-where', 'aria-label': label }, options.map(([value, text]) => el('option', { value }, text)));
    showSide(heading, el('p', { class: 'quiet-note' }, note), el('label', { class: 'field' }, el('span', {}, label), choice),
      el('button', { type: 'button', id: 'file-where-go', class: 'primary', onclick: () => attempt(() => onYes(choice.value)) }, button));
    choice.focus();
  }

  const makeChapter = (file) => {
    const books = data.places.filter((place) => place.kind === 'book');
    if (!books.length) {
      say('Make a book first, then the writing has somewhere to go.');
      return;
    }
    const go = async (bookId) => {
      await onBefore();
      const made = await api.fileToChapter(file.id, bookId);
      onOutline(made.outline);
      closeSide();
      await load();
      say(`Made ${made.chapters === 1 ? 'a chapter' : `${made.chapters} chapters`} in “${made.book}” from ${file.name}. The file is in the Trash for 30 days.`);
    };
    const own = books.find((place) => place.id === file.ownerId);
    askWhere(`Make ${file.name} a chapter`, 'Its writing goes at the end of the book, split into chapters the way Import splits it. The file moves to the Trash, where it waits 30 days.',
      'Book', [...(own ? [own] : []), ...books.filter((place) => place !== own)].map((place) => [place.id, place.title]), 'Make it a chapter', go);
  };

  const makeRecord = (file) => attempt(async () => {
    const { types } = await api.recordsOverview();
    if (!types.length) {
      say('Make a kind of record first, in Records. Then a file can become one.');
      return;
    }
    askWhere(`Make ${file.name} a record`, 'Its writing becomes the new record’s notes. The file moves to the Trash, where it waits 30 days.',
      'Kind of record', types.map((type) => [type.id, type.title]), 'Make the record', async (typeId) => {
        const made = await api.fileToRecord(file.id, typeId);
        closeSide();
        await load();
        say(`Made the record “${made.title}” from ${file.name}. The file is in the Trash for 30 days.`);
      });
  });

  const act = {
    chapter: makeChapter,
    record: makeRecord,
    cover: (file) => attempt(async () => {
      const { book } = await api.fileAsCover(file.id);
      await load();
      say(`${file.name} is now the cover of “${book}”. A cover it replaced is kept under Covers.`);
    }),
    trash: (file) => attempt(async () => {
      await api.trashFiles([file.id]);
      closeSide();
      await load();
      say(`${file.name} is in the Trash.`);
    }),
  };

  function row(file) {
    const picture = file.look === 'picture' && file.size < SMALL_PICTURE;
    const thumb = el(picture ? 'img' : 'span', { class: 'attachment-thumb', alt: picture ? '' : null, 'aria-hidden': picture ? null : 'true', dataset: { file: file.id } });
    if (picture) thumbs.observe(thumb);
    const tick = el('input', {
      type: 'checkbox',
      class: 'file-tick',
      'aria-label': `Select ${file.name}`,
      checked: chosen.has(file.id),
      onchange: (event) => {
        if (event.target.checked) chosen.add(file.id);
        else chosen.delete(file.id);
        drawBulk();
      },
    });
    const kind = el('select', {
      class: 'file-section',
      'aria-label': `Section for ${file.name}`,
      onchange: (event) => attempt(async () => {
        const to = event.target.value;
        await api.setFileSection([file.id], to);
        await load();
        say(`${file.name} is now under ${sectionLabel(to)}.`);
      }),
    }, SECTIONS.map((one) => el('option', { value: one.id }, one.label)));
    kind.value = file.section;
    const more = el('select', {
      class: 'file-more',
      'aria-label': `Do something with ${file.name}`,
      onchange: (event) => {
        const action = event.target.value;
        event.target.value = '';
        act[action]?.(file);
      },
    },
    el('option', { value: '' }, 'More…'),
    file.writing ? el('option', { value: 'chapter' }, 'Make it a chapter…') : null,
    file.writing ? el('option', { value: 'record' }, 'Make it a record…') : null,
    file.cover ? el('option', { value: 'cover' }, 'Use as the book’s cover') : null,
    el('option', { value: 'trash' }, 'Move to Trash'));
    return el(
      'li',
      { class: 'attachment-row', dataset: { id: file.id } },
      tick,
      thumb,
      el('div', { class: 'attachment-name' }, el('span', { title: file.from || file.name }, file.name), el('small', {}, `${sizeOf(file.size)} · ${file.owner}`)),
      kind,
      file.look ? el('button', { type: 'button', class: 'file-look', 'aria-label': `Look at ${file.name}`, onclick: () => look(file) }, file.look === 'sound' ? 'Play' : 'Look') : null,
      el('button', { type: 'button', 'aria-label': `Save a copy of ${file.name}`, onclick: () => attempt(async () => {
        if (await ensurePass(api, 'A saved copy isn’t protected: anyone can open it.')) await api.saveAttachment(file.id);
      }) }, 'Save a copy'),
      more,
    );
  }

  // The books' own covers, which are kept apart from the files.
  const coverRow = (cover) => {
    const picture = el('img', { class: 'attachment-thumb', alt: '' });
    api.getDetails(cover.bookId).then((details) => { if (details.cover?.url) picture.src = details.cover.url; }).catch(() => {});
    return el('li', { class: 'cover-row' }, picture, el('div', { class: 'attachment-name' }, el('span', {}, `The cover of “${cover.book}”`), el('small', {}, 'In use. Change it in Book Details, or choose another picture below.')));
  };

  const selectAll = el('input', {
    type: 'checkbox',
    id: 'files-select-all',
    onchange: () => {
      for (const file of matching()) {
        if (selectAll.checked) chosen.add(file.id);
        else chosen.delete(file.id);
      }
      draw();
    },
  });
  const selected = el('span', { id: 'files-selected', class: 'quiet-note' });
  const bulkSection = el('select', { id: 'bulk-section', 'aria-label': 'Move the selected files to a section', onchange: () => attempt(async () => {
    const to = bulkSection.value;
    bulkSection.value = '';
    if (!to) return;
    const count = await api.setFileSection([...chosen], to);
    chosen.clear();
    await load();
    say(`${filesWord(count)} moved to ${sectionLabel(to)}.`);
  }) });
  const bulkPlace = el('select', { id: 'bulk-place', 'aria-label': 'Move the selected files to a book', onchange: () => attempt(async () => {
    const to = bulkPlace.value;
    bulkPlace.value = '';
    if (!to) return;
    const name = data.places.find((place) => place.id === to)?.title;
    const count = await api.moveFiles([...chosen], to);
    chosen.clear();
    await load();
    say(`${filesWord(count)} moved to “${name}”.`);
  }) });
  const bulkTrash = el('button', { type: 'button', id: 'bulk-trash', onclick: () => attempt(async () => {
    const count = chosen.size;
    if (!window.confirm(`Move ${filesWord(count)} to the Trash? They wait there 30 days.`)) return;
    await api.trashFiles([...chosen]);
    chosen.clear();
    await load();
    say(`${filesWord(count)} in the Trash.`);
  }) }, icon('trash'), 'Move to Trash');

  function drawBulk() {
    const here = matching();
    const picked = here.filter((file) => chosen.has(file.id)).length;
    selectAll.checked = here.length > 0 && picked === here.length;
    selectAll.indeterminate = picked > 0 && picked < here.length;
    selected.textContent = chosen.size ? `${filesWord(chosen.size)} selected` : `${filesWord(here.length)} here`;
    for (const control of [bulkSection, bulkPlace, bulkTrash]) control.disabled = chosen.size === 0;
  }

  function draw() {
    const counts = new Map(SECTIONS.map((one) => [one.id, 0]));
    for (const file of data.files) counts.set(file.section, counts.get(file.section) + 1);
    const tab = (key, label, count) => el('button', {
      type: 'button',
      dataset: { section: key },
      'aria-pressed': String(section === key),
      class: count === 0 && key !== 'all' ? 'empty' : '',
      onclick: () => {
        section = key;
        shown = SHOWN_AT_A_TIME;
        // What was ticked in another section is let go, so an action never reaches a file that's out of sight.
        chosen.clear();
        closeSide();
        draw();
        nav.querySelector(`[data-section="${key}"]`)?.focus();
      },
    }, el('span', {}, label), el('span', { class: 'files-count' }, formatCount(count)));
    fill(nav, tab('all', 'All files', data.files.length), SECTIONS.map((one) => tab(one.id, one.label, counts.get(one.id))));
    fill(bulkSection, el('option', { value: '' }, 'Move to section…'), SECTIONS.map((one) => el('option', { value: one.id }, one.label)));
    fill(bulkPlace, el('option', { value: '' }, 'Move to book…'), data.places.map((place) => el('option', { value: place.id }, placeName(place))));

    thumbs.disconnect();
    const here = matching();
    const covers = !search.trim() && (section === 'all' || section === 'cover') ? data.covers : [];
    const rows = [...covers.map(coverRow), ...here.slice(0, shown).map(row)];
    if (here.length > shown) {
      rows.push(el('li', {}, el('button', { type: 'button', id: 'files-more', onclick: () => {
        const at = list.scrollTop;
        shown += SHOWN_AT_A_TIME;
        draw();
        list.scrollTop = at;
      } }, `Show ${formatCount(Math.min(SHOWN_AT_A_TIME, here.length - shown))} more of ${formatCount(here.length)}`)));
    }
    if (!rows.length) rows.push(el('li', { class: 'quiet-note' }, data.files.length ? 'No files here.' : 'Nothing is attached yet.'));
    fill(list, rows);
    drawBulk();
  }

  const find = el('input', { id: 'files-search', type: 'search', placeholder: 'Search by name or folder', 'aria-label': 'Search files by name or folder', oninput: () => {
    search = find.value;
    shown = SHOWN_AT_A_TIME;
    chosen.clear();
    draw();
  } });
  const where = id === projectId ? null : el('select', { id: 'files-scope', 'aria-label': 'Which files to show', onchange: () => attempt(async () => {
    scope = where.value;
    shown = SHOWN_AT_A_TIME;
    chosen.clear();
    closeSide();
    await load();
  }) }, el('option', { value: id }, `In “${title}”`), el('option', { value: projectId }, 'In the whole project'));

  const add = el('button', {
    id: 'attachment-add',
    class: 'primary',
    onclick: () => attempt(async () => {
      await api.addAttachments(scope);
      await load();
    }),
  }, icon('plus'), 'Add files');
  const dialog = el(
    'dialog',
    { id: 'attachments', class: 'dialog files-window', 'aria-labelledby': 'files-title' },
    el('div', { class: 'files-head' },
      el('h2', { id: 'files-title' }, `Files: ${title}`),
      el('div', { class: 'files-tools' }, find, where)),
    el('div', { class: 'files-body' },
      nav,
      el('div', { class: 'files-main' },
        el('div', { class: 'files-bulk' }, el('label', { class: 'check' }, selectAll, el('span', {}, 'Select all')), selected, bulkSection, bulkPlace, bulkTrash),
        list),
      side),
    el('div', { class: 'files-foot' }, status, el('div', { class: 'files-foot-buttons' }, el('button', { id: 'attachments-close', onclick: () => dialog.close() }, 'Close'), add)),
  );
  dialog.addEventListener('close', () => {
    thumbs.disconnect();
    dialog.remove();
  });
  document.body.append(dialog);
  await load();
  dialog.showModal();
}
