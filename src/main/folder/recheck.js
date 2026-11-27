'use strict';
// Checks the folders a project was brought in from for what has changed there since, and carries out what the author picks.
//
// The rules, which test/recheck.test.cjs holds it to:
// - The folder is only read. Only files found by looking through the folder are opened: never a path that came out of the project.
// - A folder is only looked at if it was chosen on this computer (./links.js).
// - Looking changes nothing in the writing. The one thing it writes down is that two texts it compared now match.
// - Nothing is applied that wasn't picked, one change at a time. Just before applying, the file and the chapter are looked at again, and
//   if either has changed since the author saw them, that change is left alone.
// - No words are lost. Replaced text goes into the chapter's earlier versions, so does a folder's text that wasn't used where both had
//   changed, and a replaced file goes to the Trash.
// - A project that's locked or closed part way stops the check.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { plainText } = require('../../shared/text');
const { sectionLabel } = require('../../shared/sections');
const { IMPORT_EXTENSIONS, imageSize, readSource, sectionsOf } = require('../import');
const { documentOf, wordsIn } = require('../import/split');
const { cleanTitle, toImported } = require('../workspace');
const { sectionOf } = require('./filing');
const { fingerprint, notesIn } = require('./fingerprint');
const { buildPlan } = require('./plan');
const { piece, piecesOf } = require('./pieces');
const { hashOf, walkFolder } = require('./scan');
const signs = require('./signs');

const MAX_WRITING_BYTES = 200 * 1024 * 1024;
const READABLE = new Set(IMPORT_EXTENSIONS);
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', epub: 'application/epub+zip' };
const SUFFIX = ' (from the folder)';

const extensionOf = (rel) => path.posix.extname(rel).slice(1).toLowerCase();
const nameOf = (rel) => path.posix.basename(rel);
const stemOf = (rel) => nameOf(rel).replace(/\.[^.]+$/, '');
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const fullPath = (root, rel) => path.join(root, ...rel.split('/'));
const canBeWriting = (rel) => READABLE.has(extensionOf(rel)) && signs.kindOf(extensionOf(rel)) === 'writing';
const hashData = (data) => crypto.createHash('sha256').update(data).digest('hex');

class FolderCheck {
  constructor() {
    this.last = null;
    this.queue = Promise.resolve();
  }

  // One at a time: a check asked for while another runs waits its turn.
  run(work) {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  forget() {
    this.last = null;
  }

  // Every import made before there was anything to check against gets what can be known about each of its files: what it became, and
  // how big and how old it was when the folder was looked through.
  track(project, record) {
    const known = new Set(project.folderFiles(record.id).map((row) => row.rel));
    let state;
    try {
      state = JSON.parse(record.state);
    } catch {
      return;
    }
    const entries = state.entries ?? [];
    if (entries.every((entry) => known.has(entry.rel))) return;
    const plan = buildPlan({ title: path.basename(record.root) || 'Your files', entries }, state.edits);
    const planned = new Map(plan.files.map((file) => [file.rel, file]));
    const nodes = new Map();
    const index = (node) => {
      nodes.set(node.id, node);
      node.children.forEach(index);
    };
    index(plan.tree);
    const done = new Map(project.folderImportRows(record.id).map((row) => [row.fileId, row]));
    project.db.transaction(() => {
      for (const entry of entries) {
        const file = planned.get(entry.rel);
        const row = file && done.get(file.id);
        if (known.has(entry.rel) || !row) continue;
        const item = row.itemId ? project.getItem(row.itemId) : null;
        const node = nodes.get(file.node);
        const base = { rel: entry.rel, size: entry.size, mtime: entry.mtime ?? 0, sha256: entry.sha256 ?? '' };
        const bookId = item ? this.bookOf(project, item.id) : null;
        // The plan worked out today can keep another of two identical files than the import did. Then the plan says nothing about how
        // this one was read, and the number of chapters it made does.
        const chapters = Number(/^(\d+) chapters/.exec(row.note)?.[1] ?? 1);
        const whole = node ? node.kind === 'whole' || Boolean(node.split) : chapters > 1;
        const given = node ? (node.kind === 'whole' ? file.name : node.title) : chapters > 1 ? file.name : '';
        if (row.outcome === 'chapters') project.saveFolderFile(record.id, { ...base, kind: 'chapters', itemId: row.itemId, bookId, whole, given, chapters });
        else if (row.outcome === 'older') project.saveFolderFile(record.id, { ...base, kind: 'older', itemId: row.itemId, bookId, whole, given });
        else if (row.outcome === 'attachment') project.saveFolderFile(record.id, { ...base, kind: 'attachment', itemId: row.itemId, bookId: item?.parentId ?? null });
        else if (row.outcome === 'cover') project.saveFolderFile(record.id, { ...base, kind: 'cover', itemId: row.itemId, bookId: row.itemId });
        else project.saveFolderFile(record.id, { ...base, kind: row.outcome === 'bundled' ? 'ignore' : 'left' });
      }
    })();
  }

  bookOf(project, id) {
    for (let item = project.getItem(id); item; item = item.parentId ? project.getItem(item.parentId) : null) {
      if (item.kind === 'book') return item.id;
    }
    return null;
  }

  alive(project, id, kind) {
    const item = id ? project.getItem(id) : null;
    return item && item.kind === kind && !project.isHidden(id) ? item : null;
  }

  // The folders of the open project, and which were chosen on this computer. This looks at no folder.
  folders(workspace, links) {
    const project = workspace.open();
    return project.folderImports().map((record) => ({ importId: record.id, root: record.root, linked: links.has(project.id, record.id, record.root), at: record.finishedAt }));
  }

  // The author picks where a folder is. It's only taken if some of what came from it is there.
  async locate(workspace, links, importId, chosen) {
    const project = workspace.open();
    const record = project.folderImports().find((item) => item.id === importId);
    if (!record) throw new Error('That import isn’t in this project.');
    this.track(project, record);
    const found = new Set((await walkFolder(chosen, () => {}, () => false)).map((entry) => entry.rel));
    if (workspace.project !== project) throw new Error('The project was closed.');
    if (!project.folderFiles(importId).some((row) => found.has(row.rel))) throw new Error('None of the files brought in from that folder are there. Choose the folder they came from.');
    project.setFolderRoot(importId, chosen);
    links.add(project.id, importId, chosen);
    this.forget();
  }

  check(workspace, links, options = {}) {
    return this.run(() => this.look(workspace, links, options));
  }

  async look(workspace, links, { onProgress = () => {} } = {}) {
    const project = workspace.open();
    const guard = () => {
      if (workspace.project !== project) throw new Error('The project was closed, so the check stopped.');
    };
    this.forget();
    // Each look names what it lists afresh, so a choice made on an earlier list can never land on something else in a later one.
    const found = { id: crypto.randomUUID().slice(0, 8), project, entries: [], refs: new Map(), rows: new Map() };
    const folders = [];
    // The same folder brought in twice: each file is checked against the newer import.
    const seen = new Set();
    for (const record of project.folderImports()) {
      const linked = links.has(project.id, record.id, record.root);
      const folder = { importId: record.id, root: record.root, linked, there: null };
      folders.push(folder);
      if (!linked) continue;
      const stat = await fs.promises.stat(record.root).catch(() => null);
      guard();
      folder.there = Boolean(stat?.isDirectory());
      if (!folder.there) continue;
      onProgress({ stage: 'looking', root: record.root });
      const entries = await walkFolder(record.root, () => {}, () => workspace.project !== project).catch((error) => {
        guard();
        throw error;
      });
      guard();
      // A folder that can't be listed would make everything in it look gone, so it counts as not there.
      if (entries.some((entry) => entry.rel === '.' && entry.error)) {
        folder.there = false;
        continue;
      }
      this.track(project, record);
      await this.lookThrough({ project, record, entries, found, seen, guard, onProgress });
    }
    this.last = found;
    return { folders, entries: found.entries, books: this.books(project), projectId: project.id };
  }

  books(project) {
    const books = [];
    const walk = (id) => {
      for (const item of project.listChildren(id)) {
        if (item.trashedAt) continue;
        if (item.kind === 'book') books.push({ id: item.id, title: item.title });
        else if (item.kind === 'series') walk(item.id);
      }
    };
    walk(project.id);
    return books;
  }

  add(found, ref, shown) {
    const key = `${found.id}-${found.entries.length + 1}`;
    found.entries.push({ key, rel: ref.rel, canCompare: false, notes: null, needsBook: false, bookId: null, note: '', ...shown });
    found.refs.set(key, { ...ref, choices: shown.choices });
    if (ref.rowKey) found.rows.set(ref.rowKey, [...(found.rows.get(ref.rowKey) ?? []), key]);
  }

  async lookThrough({ project, record, entries, found, seen, guard, onProgress }) {
    const onDisk = new Map(entries.map((entry) => [entry.rel, entry]));
    const rows = project.folderFiles(record.id);
    const mine = (rel) => {
      const mark = `${record.root}\0${rel}`;
      if (seen.has(mark)) return false;
      seen.add(mark);
      return true;
    };
    const gone = [];
    const tracked = new Set();
    const closed = entries.filter((entry) => entry.error && !entry.size && !entry.mtime).map((entry) => entry.rel);
    for (const row of rows) {
      // Crossed off after it went or moved. If a file turns up under that name again, it's a new one.
      if (row.kind === 'dropped') continue;
      tracked.add(row.rel);
      if (!mine(row.rel) || row.kind === 'ignore') continue;
      const entry = onDisk.get(row.rel);
      if (!entry) {
        // Nothing is said about what's inside a folder that couldn't be listed.
        if (row.kind !== 'left' && !closed.some((dir) => row.rel.startsWith(`${dir}/`))) gone.push(row);
        continue;
      }
      if (entry.error || (entry.size === row.size && entry.mtime === row.mtime)) continue;
      onProgress({ stage: 'reading', name: nameOf(entry.rel) });
      const sha256 = await hashOf(fullPath(record.root, entry.rel)).catch(() => null);
      guard();
      if (sha256 === null) continue;
      // Saved again with nothing changed in it: only its size and time are new.
      if (row.sha256 && sha256 === row.sha256) {
        project.saveFolderFile(record.id, { ...row, size: entry.size, mtime: entry.mtime });
        continue;
      }
      await this.changed({ project, record, row, entry, sha256, found });
      guard();
    }
    await this.newAndGone({ project, record, entries, rows, tracked, gone, found, mine, guard });
  }

  base(project, record, row, entry, sha256) {
    return { importId: record.id, root: record.root, rel: entry.rel, entry: { size: entry.size, mtime: entry.mtime }, sha256, rowKey: `${record.id}\0${row.rel}`, row };
  }

  async changed({ project, record, row, entry, sha256, found }) {
    const ref = this.base(project, record, row, entry, sha256);
    if (row.kind === 'chapters') await this.changedWriting({ project, record, row, ref, found });
    else if (row.kind === 'attachment') this.changedFile({ project, row, ref, found });
    else if (row.kind === 'cover') this.changedCover({ project, row, ref, found });
    else if (row.kind === 'older') {
      const chapter = this.alive(project, row.itemId, 'chapter');
      this.add(found, { ...ref, type: 'older' }, { group: 'folder', title: nameOf(row.rel), what: 'An earlier version of a chapter', choices: chapter ? ['add', 'app'] : ['app'], note: chapter ? '' : 'Its chapter is in the Trash or gone.' });
    } else this.newEntry({ project, record, ref, found, rows: project.folderFiles(record.id), note: 'It was left out before, and has changed.' });
  }

  async chaptersIn(root, rel, whole, title) {
    const full = fullPath(root, rel);
    const { size } = await fs.promises.stat(full);
    if (size > MAX_WRITING_BYTES) throw new Error('It’s too big to read as writing.');
    const data = await fs.promises.readFile(full);
    const source = await readSource(full, data);
    const sections = sectionsOf(source, whole ? null : 'none', title).filter((section) => section.type !== 'part');
    return { sha256: hashData(data), sections: sections.map((section) => ({ ...section, blocks: section.blocks ?? [] })), words: sections.reduce((sum, section) => sum + wordsIn(section.blocks ?? []), 0) };
  }

  async changedWriting({ project, record, row, ref, found }) {
    const first = this.alive(project, row.itemId, 'chapter');
    let sections;
    try {
      ({ sections } = await this.chaptersIn(record.root, ref.rel, row.whole, row.given || first?.title || signs.tidy(stemOf(row.rel))));
    } catch (error) {
      this.add(found, { ...ref, type: 'unreadable' }, { group: 'folder', title: nameOf(row.rel), what: 'Writing', choices: ['app'], note: `The new version can’t be read as writing: ${error.message}` });
      return;
    }
    // Imports from before 3.11 wrote down no marks. Where such a file made one chapter, that chapter is the one to compare with, and it
    // counts as changed in the app if it was saved at all after the import.
    const old = !row.pieces && row.chapters === 1 && sections.length === 1;
    const pieces = old ? [{ id: row.itemId, title: null, folder: null, app: null }] : row.pieces;
    const titles = sections.map((section) => cleanTitle(section.title, 'Untitled chapter'));
    // Chapters are matched one for one, in order. A different number, or the same titles in another order, can't be matched safely.
    const matched = pieces && pieces.length === sections.length
      && !pieces.some((one, at) => one.title !== null && one.title !== titles[at] && pieces.some((other, where) => where !== at && other.title === titles[at]));
    if (!matched) {
      this.unmatched({ project, record, row, ref, sections, found });
      return;
    }
    let open = 0;
    const next = pieces.map((one) => ({ ...one }));
    for (const [at, section] of sections.entries()) {
      const one = pieces[at];
      const title = titles[at];
      const folder = fingerprint(toImported(section.blocks));
      const renamed = row.whole && one.title !== null && title !== one.title;
      if (one.folder !== null && folder === one.folder && !renamed) continue;
      const chapter = this.alive(project, one.id, 'chapter');
      const common = { ...ref, type: 'chapter', at, folder, title };
      if (!chapter) {
        this.add(found, { ...common, chapterId: null }, { group: 'folder', title, what: 'A chapter', choices: ['new', 'leave'], note: 'The app’s chapter is in the Trash or gone, so it isn’t brought back by itself.', bookId: this.alive(project, row.bookId, 'book')?.id ?? null, needsBook: true, canCompare: true });
        open += 1;
        continue;
      }
      const app = fingerprint(chapter.body);
      // The two read the same now, so there's nothing to choose. A heading renamed in the file is still offered, unless the app has it.
      if (app === folder && (!renamed || chapter.title === title)) {
        next[at] = { id: one.id, title, folder, app };
        continue;
      }
      const appChanged = one.app === null ? chapter.updatedAt > record.finishedAt : app !== one.app;
      this.add(found, { ...common, chapterId: chapter.id, app, chapterTitle: chapter.title }, {
        group: appChanged ? 'both' : 'folder',
        title: chapter.title,
        what: 'A chapter',
        choices: appChanged ? ['both', 'folder', 'app'] : ['folder', 'app', 'both'],
        note: app === folder ? 'Only its title changed in the file.' : '',
        notes: notesIn(chapter.body),
        canCompare: true,
      });
      open += 1;
    }
    const sectionsKept = sections.map((section) => ({ title: section.title, blocks: section.blocks }));
    for (const key of found.rows.get(ref.rowKey) ?? []) Object.assign(found.refs.get(key), { sections: sectionsKept, pieces: next });
    // With nothing left to choose, the file as it is now is what's compared with next time. Until then the old size and mark stay, so
    // what hasn't been chosen is listed again, and the chapters that now match aren't.
    const written = old && next[0].folder === null ? null : next;
    project.saveFolderFile(record.id, open ? { ...row, pieces: written } : { ...row, size: ref.entry.size, mtime: ref.entry.mtime, sha256: ref.sha256, pieces: written });
    row.pieces = written;
  }

  // Whether every chapter in a file is in the book, word for word. This is how a file from before 3.11 that made several chapters, with
  // only its date changed, is told from one that was edited.
  allInBook(project, bookId, sections) {
    const chaptersOf = (id) => project.listChildren(id).filter((item) => !item.trashedAt).flatMap((item) => (item.kind === 'chapter' ? [item] : item.kind === 'part' ? chaptersOf(item.id) : []));
    if (!this.alive(project, bookId, 'book') || sections.length === 0) return false;
    const there = new Set(chaptersOf(bookId).map((chapter) => fingerprint(chapter.body)));
    return sections.every((section) => there.has(fingerprint(toImported(section.blocks))));
  }

  unmatched({ project, record, row, ref, sections, found }) {
    if (!row.pieces && this.allInBook(project, row.bookId, sections)) {
      project.saveFolderFile(record.id, { ...row, size: ref.entry.size, mtime: ref.entry.mtime, sha256: ref.sha256 });
      return;
    }
    const chapters = (row.pieces ?? [{ id: row.itemId, app: null }]).map((one) => ({ one, item: this.alive(project, one.id, 'chapter') })).filter(({ item }) => item);
    const appChanged = !row.pieces || chapters.length !== row.pieces.length || chapters.some(({ one, item }) => (one.app === null ? item.updatedAt > record.finishedAt : fingerprint(item.body) !== one.app));
    const many = Math.max(row.chapters, row.pieces?.length ?? 0);
    this.add(found, { ...ref, type: 'unmatched', sections: sections.map((section) => ({ title: section.title, blocks: section.blocks })), afterId: chapters.at(-1)?.item.id ?? null, chapterIds: chapters.map(({ item }) => item.id) }, {
      group: appChanged ? 'both' : 'folder',
      title: nameOf(row.rel),
      what: many > 1 ? `A file that made ${many} chapters` : 'Writing',
      choices: sections.length ? ['both', 'app'] : ['app'],
      note: sections.length ? 'Its chapters can’t be matched with yours one for one, so the folder’s can only be added beside them.' : 'It has no words in it now.',
      bookId: this.alive(project, row.bookId, 'book')?.id ?? null,
      needsBook: chapters.length === 0 && sections.length > 0,
      canCompare: sections.length > 0,
    });
  }

  changedFile({ project, row, ref, found }) {
    const item = this.alive(project, row.itemId, 'attachment');
    if (item && project.attachmentHash(item.id) === ref.sha256) {
      project.saveFolderFile(ref.importId, { ...row, size: ref.entry.size, mtime: ref.entry.mtime, sha256: ref.sha256 });
      return;
    }
    this.add(found, { ...ref, type: 'attachment', itemId: item?.id ?? null }, {
      group: 'folder',
      title: item?.title ?? nameOf(row.rel),
      what: `A file in ${sectionLabel(sectionOf(nameOf(row.rel), row.rel))}`,
      choices: item ? ['folder', 'app', 'both'] : ['new', 'leave'],
      note: item ? '' : 'The app’s copy is in the Trash, or has become something else, so it isn’t brought back by itself.',
      bookId: this.alive(project, row.bookId, 'book')?.id ?? null,
      needsBook: !item,
    });
  }

  changedCover({ project, row, ref, found }) {
    const book = this.alive(project, row.itemId, 'book');
    const cover = book && project.cover(book.id);
    if (cover && hashData(cover.data) === ref.sha256) {
      project.saveFolderFile(ref.importId, { ...row, size: ref.entry.size, mtime: ref.entry.mtime, sha256: ref.sha256 });
      return;
    }
    this.add(found, { ...ref, type: 'cover', bookId: book?.id ?? null, cover: cover ? hashData(cover.data) : '' }, { group: 'folder', title: book ? `The cover of ${book.title}` : nameOf(row.rel), what: 'A book cover', choices: book ? ['folder', 'app'] : ['app'], note: book ? '' : 'The book is in the Trash or gone.' });
  }

  // The book a new file belongs with: the one that took most of the other files in its folder, or in the folders above it.
  likelyBook(project, rows, rel) {
    for (let dir = dirOf(rel); ; dir = dirOf(dir)) {
      const counts = new Map();
      for (const row of rows) {
        if (row.bookId && (dir ? row.rel.startsWith(`${dir}/`) : !row.rel.includes('/')) && this.alive(project, row.bookId, 'book')) counts.set(row.bookId, (counts.get(row.bookId) ?? 0) + 1);
      }
      if (counts.size === 1) return [...counts.keys()][0];
      // Two books share this folder, so it doesn't say which.
      if (counts.size > 1 || !dir) return null;
    }
  }

  newEntry({ project, record, ref, found, rows, note = '' }) {
    const writing = canBeWriting(ref.rel);
    this.add(found, { ...ref, type: 'new' }, {
      group: 'new',
      title: nameOf(ref.rel),
      what: writing ? 'Writing' : `A file for ${sectionLabel(sectionOf(nameOf(ref.rel), ref.rel))}`,
      choices: writing ? ['chapter', 'file', 'leave'] : ['file', 'leave'],
      note,
      bookId: this.likelyBook(project, rows, ref.rel),
      needsBook: true,
      canCompare: writing,
    });
  }

  async newAndGone({ project, record, entries, rows, tracked, gone, found, mine, guard }) {
    // The same rules as an import, for what's never worth bringing in: the computer's own hidden files and the inside of a Scrivener project.
    const plan = buildPlan({ title: 'New', entries: entries.filter((entry) => !entry.error) });
    const junk = new Set(plan.files.filter((file) => file.role === 'skipped' || file.role === 'bundled').map((file) => file.rel));
    let fresh = entries.filter((entry) => !entry.error && !tracked.has(entry.rel) && !junk.has(entry.rel) && mine(entry.rel));
    for (const row of gone) {
      let moved = null;
      if (row.sha256) {
        for (const entry of fresh.filter((one) => one.size === row.size)) {
          const sha256 = await hashOf(fullPath(record.root, entry.rel)).catch(() => null);
          guard();
          if (sha256 === row.sha256) {
            moved = entry;
            break;
          }
        }
      }
      if (moved) fresh = fresh.filter((entry) => entry !== moved);
      this.add(found, { importId: record.id, root: record.root, rel: row.rel, type: moved ? 'moved' : 'gone', row, movedTo: moved ? { rel: moved.rel, size: moved.size, mtime: moved.mtime } : null, sha256: row.sha256 }, {
        group: 'gone',
        title: nameOf(row.rel),
        what: moved ? 'Moved or renamed' : 'No longer in the folder',
        choices: moved ? ['follow'] : ['leave'],
        note: moved ? `It’s at ${moved.rel} now. What’s in the app stays as it is.` : 'What’s in the app stays as it is.',
      });
    }
    for (const entry of fresh) {
      const sha256 = await hashOf(fullPath(record.root, entry.rel)).catch(() => null);
      guard();
      if (sha256 === null) continue;
      this.newEntry({ project, record, ref: { importId: record.id, root: record.root, rel: entry.rel, entry: { size: entry.size, mtime: entry.mtime }, sha256 }, found, rows });
    }
  }

  // The app's text and the folder's, side by side.
  compare(workspace, key) {
    const project = workspace.open();
    const ref = this.last?.project === project ? this.last.refs.get(key) : null;
    if (!ref) throw new Error('Check the folder again.');
    if (ref.type === 'new') {
      return this.run(async () => {
        const { sections } = await this.chaptersIn(ref.root, ref.rel, true, signs.tidy(stemOf(ref.rel)));
        return { app: null, folder: sections.map((section) => plainText(toImported(section.blocks))).join('\n\n') };
      });
    }
    const joined = (texts) => texts.join('\n\n');
    const ids = ref.type === 'unmatched' ? ref.chapterIds : [ref.chapterId].filter(Boolean);
    const app = ids.map((id) => project.getItem(id)).filter(Boolean).map((item) => plainText(item.body));
    const sections = ref.type === 'unmatched' ? ref.sections : [ref.sections[ref.at]];
    return Promise.resolve({ app: app.length ? joined(app) : null, folder: joined(sections.map((section) => plainText(toImported(section.blocks)))) });
  }

  apply(workspace, choices) {
    return this.run(() => this.carryOut(workspace, choices));
  }

  async carryOut(workspace, choices) {
    const project = workspace.open();
    const last = this.last;
    if (!last || last.project !== project || choices.some(({ key }) => !last.refs.has(key))) throw new Error('Check the folder again.');
    const applied = [];
    const skipped = [];
    const settled = new Set();
    for (const { key, choice, bookId = null } of choices) {
      const ref = last.refs.get(key);
      const shown = last.entries.find((entry) => entry.key === key);
      if (!ref.choices.includes(choice) || settled.has(key)) continue;
      if (workspace.project !== project) throw new Error('The project was closed, so nothing more was changed.');
      try {
        await this.applyOne(workspace, project, ref, choice, bookId ?? shown.bookId);
        settled.add(key);
        applied.push({ key, title: shown.title, choice });
      } catch (error) {
        skipped.push({ key, title: shown.title, why: error.message });
      }
    }
    // Once everything listed for a file has been dealt with, the file as it is now is what's compared with next time.
    for (const [rowKey, keys] of last.rows) {
      if (!keys.every((key) => settled.has(key))) continue;
      const ref = last.refs.get(keys[0]);
      const row = project.folderFiles(ref.importId).find((one) => one.rel === ref.rel);
      if (row) project.saveFolderFile(ref.importId, { ...row, size: ref.entry.size, mtime: ref.entry.mtime, sha256: ref.sha256 });
    }
    // What's been seen is used once. Anything else is looked at again before it can be applied.
    this.forget();
    return { applied, skipped, outline: workspace.outline() };
  }

  // The file has to be as it was when the author saw it.
  async same(root, rel, sha256) {
    const now = await hashOf(fullPath(root, rel)).catch(() => null);
    if (now !== sha256) throw new Error('The file changed again, or went, since you looked. Check the folder again.');
  }

  chapterAsSeen(project, ref) {
    const chapter = this.alive(project, ref.chapterId, 'chapter');
    if (!chapter || fingerprint(chapter.body) !== ref.app || chapter.title !== ref.chapterTitle) throw new Error('The chapter changed since you looked. Check the folder again.');
    return chapter;
  }

  row(project, ref) {
    const row = project.folderFiles(ref.importId).find((one) => one.rel === ref.row.rel);
    if (!row) throw new Error('Check the folder again.');
    return row;
  }

  bookFor(project, bookId) {
    const book = this.alive(project, bookId, 'book');
    if (!book) throw new Error('Choose a book for it first.');
    return book;
  }

  // Where a file can be kept: a book, or the whole project.
  holderFor(project, id) {
    const holder = this.alive(project, id, 'book')?.id ?? (id === project.id ? project.id : null);
    if (!holder) throw new Error('Choose a book for it first, or the whole project.');
    return holder;
  }

  // New chapters at the end of a book, or straight after a chapter.
  addChapters(workspace, project, sections, { bookId, afterId = null }) {
    const after = afterId ? this.alive(project, afterId, 'chapter') : null;
    const book = after ? this.bookOf(project, after.id) : this.bookFor(project, bookId).id;
    const made = sections.map((section) => {
      const parentId = after ? after.parentId : book;
      const chapter = project.addItem({ kind: 'chapter', parentId, title: cleanTitle(section.title, 'Untitled chapter') });
      project.putItem({ id: chapter.id, body: JSON.stringify(toImported(section.blocks)) });
      return chapter;
    });
    if (after) {
      const siblings = project.listChildren(after.parentId).filter((item) => !made.some((one) => one.id === item.id));
      const beforeId = siblings[siblings.findIndex((item) => item.id === after.id) + 1]?.id ?? null;
      for (const chapter of made) project.moveItem(chapter.id, { parentId: after.parentId, beforeId });
    }
    return { made, bookId: book };
  }

  async applyOne(workspace, project, ref, choice, bookId) {
    if (ref.type === 'gone' || ref.type === 'moved') {
      // A file that has gone is only crossed off the list, so there's nothing to open. Its name came from the project.
      if (ref.type === 'moved') await this.same(ref.root, ref.movedTo.rel, ref.sha256);
      project.db.transaction(() => {
        const row = this.row(project, ref);
        // The record stays, marked as crossed off. Without one, an older import's would be worked out again.
        project.saveFolderFile(ref.importId, { ...row, kind: 'dropped', pieces: null });
        if (ref.type === 'moved') project.saveFolderFile(ref.importId, { ...row, rel: ref.movedTo.rel, size: ref.movedTo.size, mtime: ref.movedTo.mtime });
      })();
      return;
    }
    await this.same(ref.root, ref.rel, ref.sha256);
    if (workspace.project !== project) throw new Error('The project was closed.');
    const seen = { rel: ref.rel, size: ref.entry.size, mtime: ref.entry.mtime, sha256: ref.sha256 };

    if (ref.type === 'new') await this.applyNew(workspace, project, ref, choice, bookId, seen);
    else if (ref.type === 'chapter') this.applyChapter(workspace, project, ref, choice, bookId);
    else if (ref.type === 'unmatched') {
      if (choice !== 'both') return;
      project.db.transaction(() => {
        const sections = ref.sections.map((section) => ({ ...section, title: `${cleanTitle(section.title, 'Untitled chapter')}${SUFFIX}` }));
        const { made, bookId: into } = this.addChapters(workspace, project, sections, { bookId, afterId: ref.afterId });
        // The new chapters are the folder's text, so they're what the file is compared with from now on.
        const pieces = made.map((chapter, at) => piece(chapter.id, ref.sections[at].title, ref.sections[at].blocks, project.getItem(chapter.id).body));
        project.saveFolderFile(ref.importId, { ...this.row(project, ref), itemId: made[0].id, bookId: into, chapters: made.length, pieces });
      })();
    } else if (ref.type === 'attachment') await this.applyAttachment(project, ref, choice, bookId);
    else if (ref.type === 'cover') await this.applyCover(project, ref, choice);
    else if (ref.type === 'older') await this.applyOlder(project, ref, choice);
  }

  applyChapter(workspace, project, ref, choice, bookId) {
    const section = ref.sections[ref.at];
    const body = JSON.stringify(toImported(section.blocks));
    project.db.transaction(() => {
      const row = this.row(project, ref);
      const pieces = (row.pieces ?? ref.pieces).map((one) => ({ ...one }));
      const one = pieces[ref.at];
      const wasBoth = ref.choices[0] === 'both';
      if (choice === 'new' || choice === 'leave') {
        if (choice === 'new') {
          const { made } = this.addChapters(workspace, project, [section], { bookId });
          pieces[ref.at] = piece(made[0].id, section.title, section.blocks, project.getItem(made[0].id).body);
        } else Object.assign(one, { title: ref.title, folder: ref.folder, app: '' });
      } else {
        const chapter = this.chapterAsSeen(project, ref);
        if (choice === 'folder') {
          project.keepVersion(chapter, 'folder');
          // A title the author changed in the app is theirs. It follows the file only while it's still the file's old one.
          const retitle = row.whole && (chapter.title === one.title);
          project.putItem({ id: chapter.id, body, ...(retitle ? { title: ref.title } : {}) });
          Object.assign(one, { id: chapter.id, title: ref.title, folder: ref.folder, app: fingerprint(body) });
        } else {
          if (choice === 'both') this.addChapters(workspace, project, [{ ...section, title: `${ref.title}${SUFFIX}` }], { afterId: chapter.id });
          // Where both had changed, the folder's words that weren't used are kept with the chapter.
          else if (wasBoth) project.addVersion(chapter.id, { title: ref.title, body, reason: 'unused' });
          Object.assign(one, { id: chapter.id, title: ref.title, folder: ref.folder, app: '' });
        }
      }
      project.saveFolderFile(ref.importId, { ...row, itemId: ref.at === 0 ? pieces[0].id : row.itemId, pieces });
    })();
  }

  async storeFile(project, ref, parentId, name) {
    const item = await project.addAttachment(parentId, { name, source: fullPath(ref.root, ref.rel), type: TYPES[extensionOf(ref.rel)] ?? '', from: ref.rel, section: sectionOf(nameOf(ref.rel), ref.rel) });
    if (project.attachmentHash(item.id) !== ref.sha256) {
      project.removeItem(item.id);
      throw new Error('The file changed while it was being read. Check the folder again.');
    }
    return item;
  }

  async applyAttachment(project, ref, choice, bookId) {
    if (choice === 'app' || choice === 'leave') return;
    const old = choice === 'new' ? null : this.alive(project, ref.itemId, 'attachment');
    if (choice !== 'new' && !old) throw new Error('The app’s copy changed since you looked. Check the folder again.');
    const parentId = old?.parentId ?? this.holderFor(project, bookId);
    const dot = nameOf(ref.rel).lastIndexOf('.');
    const copyName = dot > 0 ? `${nameOf(ref.rel).slice(0, dot)}${SUFFIX}${nameOf(ref.rel).slice(dot)}` : `${nameOf(ref.rel)}${SUFFIX}`;
    const item = await this.storeFile(project, ref, parentId, choice === 'both' ? copyName : old?.title ?? nameOf(ref.rel));
    project.db.transaction(() => {
      if (choice === 'folder') project.trashItem(old.id);
      project.saveFolderFile(ref.importId, { ...this.row(project, ref), itemId: item.id, bookId: parentId });
    })();
  }

  async applyCover(project, ref, choice) {
    if (choice !== 'folder') return;
    const book = this.bookFor(project, ref.bookId);
    const data = await fs.promises.readFile(fullPath(ref.root, ref.rel));
    const size = imageSize(data);
    if (!size || hashData(data) !== ref.sha256) throw new Error('The app can’t read that picture as a cover.');
    const old = project.cover(book.id);
    if ((old ? hashData(old.data) : '') !== ref.cover) throw new Error('The cover changed since you looked. Check the folder again.');
    // The cover it replaces waits in the Trash.
    if (old) {
      const kept = await project.addAttachment(book.id, { name: `Cover before the folder update.${old.extension}`, source: old.data, type: old.type, section: 'cover' });
      project.trashItem(kept.id);
    }
    project.setCover(book.id, { type: TYPES[extensionOf(ref.rel)] ?? 'image/png', data, ...size });
  }

  async applyOlder(project, ref, choice) {
    if (choice !== 'add') return;
    const chapter = this.alive(project, ref.row.itemId, 'chapter');
    if (!chapter) throw new Error('Its chapter is in the Trash or gone.');
    const { sections } = await this.chaptersIn(ref.root, ref.rel, ref.row.whole, ref.row.given || chapter.title);
    const match = sections.length === 1 ? sections[0] : sections.find((section) => cleanTitle(section.title, '').toLowerCase() === chapter.title.toLowerCase());
    if (!match) throw new Error('No part of that file matches the chapter.');
    project.addOlderVersion(chapter.id, { title: match.title, body: JSON.stringify(documentOf(match.blocks)), at: new Date(ref.entry.mtime).toISOString() });
  }

  async applyNew(workspace, project, ref, choice, bookId, seen) {
    if (choice === 'leave') {
      project.saveFolderFile(ref.importId, { ...seen, kind: 'left' });
      return;
    }
    if (choice === 'file') {
      const parentId = this.holderFor(project, bookId);
      const item = await this.storeFile(project, ref, parentId, nameOf(ref.rel));
      project.saveFolderFile(ref.importId, { ...seen, kind: 'attachment', itemId: item.id, bookId: parentId });
      return;
    }
    const book = this.bookFor(project, bookId);
    // A file with headings becomes a chapter for each. Without them, the whole of it is one chapter, named for the file.
    let given = nameOf(ref.rel);
    let read = await this.chaptersIn(ref.root, ref.rel, true, given);
    const whole = read.sections.length > 1;
    if (!whole) {
      given = signs.tidy(stemOf(ref.rel));
      read = await this.chaptersIn(ref.root, ref.rel, false, given);
    }
    if (read.sha256 !== ref.sha256) throw new Error('The file changed while it was being read. Check the folder again.');
    if (read.words === 0) throw new Error('There are no words in it. It can be kept as a file instead.');
    project.db.transaction(() => {
      const { made } = this.addChapters(workspace, project, read.sections, { bookId: book.id });
      project.saveFolderFile(ref.importId, { ...seen, kind: 'chapters', itemId: made[0].id, bookId: book.id, whole, given, chapters: made.length, pieces: piecesOf(project, made, read.sections) });
    })();
  }
}

module.exports = { FolderCheck };
