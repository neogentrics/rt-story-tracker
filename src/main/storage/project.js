'use strict';
const crypto = require('node:crypto');
const { canHold } = require('../../shared/outline');
const { cleanPronunciations } = require('../../shared/reading');
const { parseRecord, parseType } = require('../../shared/records');
const { countWords, mentionsIn, plainText } = require('../../shared/text');
const { copyDatabase, databaseInfo } = require('./database');
const { SECTION_IDS } = require('../../shared/sections');
const { sectionOf } = require('../folder/filing');

const REMOVAL_MARKER_DAYS = 90;
const TRASH_DAYS = 30;
const VERSION_GAP_MS = 10 * 60 * 1000;
const EVERY_VERSION_DAYS = 2;
const DAY_MS = 86400000;
const FIELDS = ['kind', 'parentId', 'position', 'title', 'body', 'goal', 'trashedAt', 'details'];
const COLUMNS = {
  kind: 'kind',
  parentId: 'parent_id',
  position: 'position',
  title: 'title',
  body: 'body',
  goal: 'goal',
  trashedAt: 'trashed_at',
  details: 'details',
};
const SMALLEST_GAP = 1e-6;
// Why an earlier version is never thinned out: it came from the author's files, or was kept when the folder was checked.
const KEPT_REASONS = ['imported', 'folder', 'unused'];

const wordsIn = (body) => countWords(plainText(body));

function toItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    parentId: row.parent_id,
    position: row.position,
    title: row.title,
    body: row.body,
    words: row.words,
    goal: row.goal,
    trashedAt: row.trashed_at,
    details: row.details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deviceId: row.device_id,
  };
}

class Project {
  constructor(db, { id, file, deviceId, attachments, now = () => new Date() }) {
    this.db = db;
    this.attachments = attachments;
    this.id = id;
    this.file = file;
    this.deviceId = deviceId;
    this.now = now;
  }

  log(itemId, op, fields, at) {
    this.db
      .prepare('INSERT INTO changes (item_id, op, fields, device_id, at) VALUES (?, ?, ?, ?, ?)')
      .run(itemId, op, JSON.stringify(fields), this.deviceId, at);
  }

  putItem(input) {
    return this.db.transaction(() => {
      const at = this.now().toISOString();
      const id = input.id ?? crypto.randomUUID();
      if (this.db.prepare('SELECT 1 FROM removals WHERE item_id = ?').get(id)) {
        throw new Error("This item was removed, so it can't be saved under the same ID.");
      }
      const existing = this.getItem(id);
      if (!existing) {
        if (!input.kind) throw new Error('A new item needs a kind.');
        const item = { parentId: null, position: 0, title: '', body: '', details: '', ...input };
        this.db
          .prepare(`INSERT INTO items (id, kind, parent_id, position, title, body, words, details, created_at, updated_at, device_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, item.kind, item.parentId, item.position, item.title, item.body, wordsIn(item.body), item.details, at, at, this.deviceId);
        this.log(id, 'put', FIELDS, at);
        const added = this.getItem(id);
        this.indexLinksIf(added, FIELDS);
        return added;
      }
      const changed = FIELDS.filter((field) => field in input && input[field] !== existing[field]);
      if (changed.length === 0) return existing;
      // A frozen version is written once, with everything in it. This is the last line of the rule, below every screen.
      if (existing.kind === 'recordversion') throw new Error('A frozen version can’t be changed. Fixes go in the next version.');
      const sets = changed.map((field) => `${COLUMNS[field]} = ?`).join(', ');
      const words = 'body' in input ? wordsIn(input.body) : existing.words;
      this.db
        .prepare(`UPDATE items SET ${sets}, words = ?, updated_at = ?, device_id = ? WHERE id = ?`)
        .run(...changed.map((field) => input[field]), words, at, this.deviceId, id);
      this.log(id, 'put', changed, at);
      const saved = this.getItem(id);
      this.indexLinksIf(saved, changed);
      return saved;
    })();
  }

  getItem(id) {
    return toItem(this.db.prepare('SELECT * FROM items WHERE id = ?').get(id));
  }

  listChildren(parentId) {
    return this.db
      .prepare('SELECT * FROM items WHERE parent_id IS ? ORDER BY position, created_at')
      .all(parentId)
      .map(toItem);
  }

  // Adds to the end of its parent.
  addItem({ kind, parentId, title = '', body = '' }) {
    const parent = this.getItem(parentId);
    if (!parent || !canHold(parent.kind, kind)) throw new Error(`A ${kind} can't go there.`);
    const last = this.listChildren(parentId).at(-1);
    return this.putItem({ kind, parentId, title, body, position: (last?.position ?? 0) + 1 });
  }

  // Puts an item before a sibling, or at the end. Positions are numbers with room between them, so a move changes one
  // row. If the room runs out, that parent's rows are spaced out again.
  moveItem(id, { parentId, beforeId = null }) {
    return this.db.transaction(() => {
      const item = this.getItem(id);
      const parent = this.getItem(parentId);
      if (!item || !parent || !canHold(parent.kind, item.kind)) throw new Error("That can't move there.");
      const siblings = this.listChildren(parentId).filter((sibling) => sibling.id !== id);
      const at = beforeId === null ? siblings.length : siblings.findIndex((sibling) => sibling.id === beforeId);
      if (at < 0) throw new Error("That can't move there.");
      const previous = siblings[at - 1]?.position;
      const next = siblings[at]?.position;
      if (previous !== undefined && next !== undefined && next - previous < SMALLEST_GAP) {
        const ordered = [...siblings.slice(0, at), item, ...siblings.slice(at)];
        ordered.forEach((row, place) => this.putItem({ id: row.id, parentId, position: place + 1 }));
        return this.getItem(id);
      }
      let position = (previous ?? 0) + 1;
      if (next !== undefined) position = previous === undefined ? next - 1 : (previous + next) / 2;
      return this.putItem({ id, parentId, position });
    })();
  }

  // The whole tree without the writing itself, with word totals added up from the chapters.
  outline() {
    const rows = this.db
      .prepare(`SELECT id, kind, parent_id, title, words FROM items
                WHERE kind NOT IN ('comment', 'attachment', 'recordtype', 'record', 'recordversion') AND trashed_at IS NULL
                ORDER BY position, created_at`)
      .all();
    const nodes = new Map(
      rows.map((row) => [row.id, { id: row.id, kind: row.kind, title: row.title, words: row.words, children: [] }]),
    );
    for (const row of rows) nodes.get(row.parent_id)?.children.push(nodes.get(row.id));
    const total = (node) => {
      node.words += node.children.reduce((sum, child) => sum + total(child), 0);
      return node.words;
    };
    const root = nodes.get(this.id);
    if (root) total(root);
    return root ?? null;
  }

  localDay() {
    const now = this.now();
    const part = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
  }

  // Net words, so writing 500 and cutting 200 counts as 300.
  addDayWords(change) {
    if (change === 0) return;
    this.db
      .prepare(`INSERT INTO writing_days (day, words) VALUES (?, ?)
                ON CONFLICT (day) DO UPDATE SET words = words + excluded.words`)
      .run(this.localDay(), change);
  }

  wordsToday() {
    return Math.max(0, this.db.prepare('SELECT words FROM writing_days WHERE day = ?').get(this.localDay())?.words ?? 0);
  }

  chapters() {
    return this.db
      .prepare("SELECT * FROM items WHERE kind = 'chapter' ORDER BY position, created_at")
      .all()
      .map(toItem);
  }

  summary() {
    const { updatedAt } = this.db.prepare('SELECT MAX(updated_at) AS updatedAt FROM items').get();
    return { title: this.title(), words: this.outline()?.words ?? 0, updatedAt };
  }

  // Records. The checking of what comes from the window is in records.js, as with the rest of what the window asks for.

  // Where a record or a chapter points: the link fields of a record, and every @ in a record's notes or a chapter.
  indexLinksIf(item, changed) {
    const record = item.kind === 'record' && (changed.includes('details') || changed.includes('body'));
    if (record || (item.kind === 'chapter' && changed.includes('body'))) this.indexLinks(item);
  }

  indexLinks(item) {
    const links = [];
    if (item.kind === 'record') {
      const { values } = parseRecord(item.details);
      for (const field of parseType(this.getItem(item.parentId)?.details ?? '').fields) {
        if (field.kind === 'link' && Array.isArray(values[field.id])) for (const to of values[field.id]) links.push([to, field.id]);
      }
    }
    for (const to of mentionsIn(item.body)) links.push([to, '@']);
    this.db.prepare('DELETE FROM record_links WHERE from_id = ?').run(item.id);
    const insert = this.db.prepare('INSERT OR IGNORE INTO record_links (from_id, to_id, via) VALUES (?, ?, ?)');
    for (const [to, via] of links) if (to !== item.id) insert.run(item.id, to, via);
  }

  // A type's fields can change what counts as a link, so everything under it is worked out again.
  reindexType(typeId) {
    for (const record of this.recordRows(typeId, { all: true })) this.indexLinks(record);
  }

  recordTypes() {
    return this.db
      .prepare("SELECT * FROM items WHERE kind = 'recordtype' AND parent_id = ? AND trashed_at IS NULL ORDER BY position, created_at")
      .all(this.id)
      .map(toItem);
  }

  // `all` includes the Trash, for the numbers that stay taken while a record waits there.
  recordRows(typeId, { all = false } = {}) {
    return this.db
      .prepare(`SELECT * FROM items WHERE kind = 'record' AND parent_id = ? ${all ? '' : 'AND trashed_at IS NULL'} ORDER BY title COLLATE NOCASE, created_at`)
      .all(typeId)
      .map(toItem);
  }

  // The frozen versions of a record, oldest first.
  versionRows(recordId) {
    return this.db
      .prepare("SELECT * FROM items WHERE kind = 'recordversion' AND parent_id = ? ORDER BY position, created_at")
      .all(recordId)
      .map(toItem);
  }

  // How many frozen versions the records of a kind have between them.
  versionCount(typeId) {
    return this.db
      .prepare("SELECT COUNT(*) AS n FROM items v JOIN items r ON v.parent_id = r.id WHERE v.kind = 'recordversion' AND r.parent_id = ?")
      .get(typeId).n;
  }

  recordCount(typeId) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE kind = 'record' AND parent_id = ? AND trashed_at IS NULL").get(typeId).n;
  }

  // Is this item, or anything it sits in, in the Trash?
  isHidden(id) {
    for (let item = this.getItem(id); item; item = item.parentId ? this.getItem(item.parentId) : null) {
      if (item.trashedAt) return true;
    }
    return false;
  }

  // Everything that points at this record, newest links first. Whatever is in the Trash, or inside something that is,
  // is left out until it comes back.
  linksTo(id, limit = 500) {
    const rows = this.db.prepare('SELECT from_id AS fromId, via FROM record_links WHERE to_id = ?').all(id);
    const found = [];
    for (const { fromId, via } of rows) {
      const item = this.getItem(fromId);
      if (!item || this.isHidden(fromId)) continue;
      found.push({ item, via });
      if (found.length >= limit) break;
    }
    return found;
  }

  // The first ancestor of a kind, such as the book a chapter is in.
  ancestor(id, kind) {
    for (let item = this.getItem(id); item; item = item.parentId ? this.getItem(item.parentId) : null) {
      if (item.kind === kind) return item;
    }
    return null;
  }

  // Covers

  setCover(itemId, { type, data, width, height }) {
    this.db
      .prepare(`INSERT INTO covers (item_id, type, data, width, height) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (item_id) DO UPDATE SET type = excluded.type, data = excluded.data,
                  width = excluded.width, height = excluded.height`)
      .run(itemId, type, data, width, height);
  }

  cover(itemId) {
    const row = this.db.prepare('SELECT * FROM covers WHERE item_id = ?').get(itemId);
    if (!row) return null;
    return { type: row.type, data: row.data, width: row.width, height: row.height, extension: row.type === 'image/png' ? 'png' : 'jpg' };
  }

  removeCover(itemId) {
    this.db.prepare('DELETE FROM covers WHERE item_id = ?').run(itemId);
  }

  // Trash

  trashItem(id) {
    return this.putItem({ id, trashedAt: this.now().toISOString() });
  }

  restoreItem(id) {
    const item = this.getItem(id);
    if (!item?.trashedAt) throw new Error("That isn't in the Trash.");
    const parent = this.getItem(item.parentId);
    if (parent?.trashedAt) throw new Error(`Restore “${parent.title}” first. This was inside it.`);
    return this.putItem({ id, trashedAt: null });
  }

  trashed() {
    return this.db
      .prepare('SELECT * FROM items WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC')
      .all()
      .map(toItem)
      .map((item) => {
        const left = TRASH_DAYS - (this.now().getTime() - new Date(item.trashedAt).getTime()) / DAY_MS;
        return { id: item.id, kind: item.kind, title: item.title, trashedAt: item.trashedAt, daysLeft: Math.max(0, Math.ceil(left)) };
      });
  }

  purgeTrash() {
    const cutoff = new Date(this.now().getTime() - TRASH_DAYS * DAY_MS).toISOString();
    const old = this.db.prepare('SELECT id FROM items WHERE trashed_at < ?').all(cutoff);
    old.forEach(({ id }) => this.removeItem(id));
    return old.length;
  }

  // Earlier versions

  keepVersion(item, reason) {
    this.db
      .prepare('INSERT INTO versions (item_id, title, body, words, reason, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, item.title, item.body, item.words, reason, this.now().toISOString());
  }

  // Called just before a chapter is overwritten, so what's kept is the writing as it stood. Typing saves every few
  // seconds, so a copy is only taken when the last one is at least ten minutes old.
  versionIfDue(item) {
    if (!item.body) return;
    const last = this.db.prepare('SELECT at FROM versions WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(item.id);
    if (last && this.now().getTime() - new Date(last.at).getTime() < VERSION_GAP_MS) return;
    this.keepVersion(item, 'auto');
  }

  // A version from an author's own files, with the date it really had. These are never thinned out.
  addOlderVersion(itemId, { title, body, at }) {
    this.db
      .prepare('INSERT INTO versions (item_id, title, body, words, reason, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(itemId, title, body, wordsIn(body), 'imported', at);
  }

  // A version from an author's own files, with the date it really had. These are never thinned out.
  addOlderVersion(itemId, { title, body, at }) {
    this.db
      .prepare('INSERT INTO versions (item_id, title, body, words, reason, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(itemId, title, body, wordsIn(body), 'imported', at);
  }

  listVersions(itemId) {
    return this.db
      .prepare('SELECT id, title, words, reason, at FROM versions WHERE item_id = ? ORDER BY id DESC')
      .all(itemId);
  }

  getVersion(id) {
    return this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id) ?? null;
  }

  // A version with words of its own, kept beside a chapter without changing the chapter.
  addVersion(itemId, { title, body, reason }) {
    this.db
      .prepare('INSERT INTO versions (item_id, title, body, words, reason, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(itemId, title, body, wordsIn(body), reason, this.now().toISOString());
  }

  // Every version from the last two days stays. Older ones thin out to the last of each day. Those from the author's own files, and
  // those kept when the folder was checked, never do.
  thinVersions() {
    const cutoff = new Date(this.now().getTime() - EVERY_VERSION_DAYS * DAY_MS).toISOString();
    return this.db
      .prepare(`DELETE FROM versions WHERE at < ? AND reason NOT IN (${KEPT_REASONS.map((reason) => `'${reason}'`).join(', ')}) AND id NOT IN (
                  SELECT MAX(id) FROM versions GROUP BY item_id, substr(at, 1, 10)
                )`)
      .run(cutoff).changes;
  }

  tidy() {
    this.purgeTrash();
    this.thinVersions();
    this.pruneRemovalMarkers();
    this.tidyAttachments();
  }

  // `source` is a path or a Buffer. Contents already in the project aren't stored twice.
  async addAttachment(parentId, { name, source, type = '', from = '', section = '' }) {
    const stored = await this.attachments.store(source);
    const known = this.db.prepare('SELECT file FROM attachment_files WHERE sha256 = ?').get(stored.sha256);
    if (known) this.attachments.remove(stored.file);
    else this.db.prepare('INSERT INTO attachment_files (sha256, file, size) VALUES (?, ?, ?)').run(stored.sha256, stored.file, stored.size);
    const item = this.addItem({ kind: 'attachment', parentId, title: name });
    const details = { file: known?.file ?? stored.file, size: stored.size, type, from, ...(SECTION_IDS.has(section) ? { section } : {}) };
    return this.putItem({ id: item.id, details: JSON.stringify(details) });
  }

  attachment(id) {
    const item = this.getItem(id);
    if (item?.kind !== 'attachment') throw new Error('That attachment is missing.');
    return { ...JSON.parse(item.details), id, name: item.title, parentId: item.parentId };
  }

  // The mark of an attached file's contents.
  attachmentHash(id) {
    return this.db.prepare('SELECT sha256 FROM attachment_files WHERE file = ?').get(this.attachment(id).file)?.sha256 ?? '';
  }

  // What's attached to something and everything under it, leaving out what's in the Trash.
  listAttachments(rootId) {
    const rows = this.db
      .prepare(`WITH RECURSIVE tree(id) AS (
                  SELECT id FROM items WHERE id = ?
                  UNION
                  SELECT items.id FROM items JOIN tree ON items.parent_id = tree.id WHERE items.trashed_at IS NULL
                )
                SELECT items.id, items.title, items.details, parent.title AS owner, items.parent_id AS ownerId
                FROM items JOIN tree ON items.id = tree.id JOIN items AS parent ON parent.id = items.parent_id
                WHERE items.kind = 'attachment' ORDER BY parent.position, items.position`)
      .all(rootId);
    return rows.map(({ id, title, details, owner, ownerId }) => {
      const { size, type, from, section } = JSON.parse(details);
      // A file saved with no section, as every file was before 3.11, is sorted by what it is each time it's listed.
      return { id, name: title, size, type, from, owner, ownerId, section: SECTION_IDS.has(section) ? section : sectionOf(title, from) };
    });
  }

  // A file moved to a new key gets a new name. Backups keep each file under its name, so one name must never mean two keys.
  renameAttachmentFiles(moved) {
    const row = this.db.prepare('UPDATE attachment_files SET file = ? WHERE file = ?');
    const items = this.db.prepare("UPDATE items SET details = json_set(details, '$.file', ?) WHERE kind = 'attachment' AND json_extract(details, '$.file') = ?");
    this.db.transaction(() => {
      for (const [from, to] of moved) {
        row.run(to, from);
        items.run(to, from);
      }
    })();
  }

  attachmentFiles() {
    return this.db.prepare('SELECT file FROM attachment_files').all().map((row) => row.file);
  }

  // A stored file goes once nothing uses it, which can only happen after the Trash has let go of its last item.
  tidyAttachments() {
    const used = new Set(
      this.db.prepare("SELECT json_extract(details, '$.file') AS file FROM items WHERE kind = 'attachment'").all().map((row) => row.file),
    );
    const keep = new Set();
    for (const file of this.attachmentFiles()) {
      if (used.has(file)) keep.add(file);
      else this.db.prepare('DELETE FROM attachment_files WHERE file = ?').run(file);
    }
    return this.attachments.sweep(keep);
  }

  saveFolderImport({ id, root, state }) {
    this.db
      .prepare(`INSERT INTO folder_imports (id, root, state, status, started_at) VALUES (?, ?, ?, 'running', ?)
                ON CONFLICT (id) DO UPDATE SET state = excluded.state, status = 'running', finished_at = NULL`)
      .run(id, root, state, this.now().toISOString());
  }

  recordFolderImport(importId, { fileId, outcome, itemId = null, note = '' }) {
    this.db
      .prepare(`INSERT INTO folder_import_files (import_id, file_id, outcome, item_id, note) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (import_id, file_id) DO UPDATE SET outcome = excluded.outcome, item_id = excluded.item_id, note = excluded.note`)
      .run(importId, fileId, outcome, itemId, note);
  }

  folderImportRows(importId) {
    return this.db
      .prepare('SELECT file_id AS fileId, outcome, item_id AS itemId, note FROM folder_import_files WHERE import_id = ?')
      .all(importId);
  }

  finishFolderImport(id, status) {
    this.db.prepare('UPDATE folder_imports SET status = ?, finished_at = ? WHERE id = ?').run(status, this.now().toISOString(), id);
  }

  // The imports a folder can be checked against, the newest first. One that was dropped, or is still to be finished, isn't.
  folderImports() {
    return this.db
      .prepare(`SELECT id, root, state, status, started_at AS startedAt, finished_at AS finishedAt FROM folder_imports
                WHERE status = 'done' ORDER BY started_at DESC, rowid DESC`)
      .all();
  }

  // Read aloud's pronunciation list. It holds character names, so it lives inside the project, encrypted with the rest of it. Its table
  // is made when a list is first saved, outside the numbered steps in schema.js on purpose: version 3.11 ignores a table it doesn't
  // know, where a new step would stop it opening the project at all. So a later step must not take this name for something else.
  pronunciations() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'read_aloud'").get()) return [];
    const row = this.db.prepare("SELECT value FROM read_aloud WHERE name = 'pronunciations'").get();
    try {
      return cleanPronunciations(JSON.parse(row?.value ?? '[]'));
    } catch {
      return [];
    }
  }

  savePronunciations(list) {
    const clean = cleanPronunciations(list);
    this.db.exec('CREATE TABLE IF NOT EXISTS read_aloud (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.db
      .prepare("INSERT INTO read_aloud (name, value) VALUES ('pronunciations', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(clean));
    return clean;
  }

  setFolderRoot(id, root) {
    this.db.prepare('UPDATE folder_imports SET root = ? WHERE id = ?').run(root, id);
  }

  folderFiles(importId) {
    return this.db
      .prepare(`SELECT rel, size, mtime, sha256, kind, item_id AS itemId, book_id AS bookId, whole, given, chapters, pieces
                FROM folder_files WHERE import_id = ? ORDER BY rel`)
      .all(importId)
      .map((row) => ({ ...row, whole: Boolean(row.whole), pieces: row.pieces ? JSON.parse(row.pieces) : null }));
  }

  // `whole` and `given` are how writing was read: whether it was split at its headings, and the title it was given.
  saveFolderFile(importId, { rel, size, mtime, sha256 = '', kind, itemId = null, bookId = null, whole = false, given = '', chapters = 0, pieces = null }) {
    this.db
      .prepare(`INSERT OR REPLACE INTO folder_files (import_id, rel, size, mtime, sha256, kind, item_id, book_id, whole, given, chapters, pieces)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(importId, rel, size, mtime, sha256, kind, itemId, bookId, whole ? 1 : 0, given, chapters, pieces ? JSON.stringify(pieces) : '');
  }

  unfinishedFolderImport() {
    return this.db
      .prepare(`SELECT id, root, state, started_at AS startedAt FROM folder_imports
                WHERE status IN ('running', 'stopped') ORDER BY started_at DESC LIMIT 1`)
      .get() ?? null;
  }

  // Removes an item and everything under it. Each one leaves a marker, so a device that was switched off can't bring
  // it back. The screens never call this directly: things go to the Trash first, and this runs 30 days later.
  removeItem(id) {
    return this.db.transaction(() => {
      const at = this.now().toISOString();
      const rows = this.db
        .prepare(`WITH RECURSIVE tree(id) AS (
                    SELECT id FROM items WHERE id = ?
                    UNION
                    SELECT items.id FROM items JOIN tree ON items.parent_id = tree.id
                  )
                  SELECT items.id, items.kind FROM items JOIN tree ON items.id = tree.id`)
        .all(id);
      for (const row of rows) {
        this.db.prepare('DELETE FROM items WHERE id = ?').run(row.id);
        this.db.prepare('DELETE FROM versions WHERE item_id = ?').run(row.id);
        this.db.prepare('DELETE FROM covers WHERE item_id = ?').run(row.id);
        this.db.prepare('DELETE FROM record_links WHERE from_id = ? OR to_id = ?').run(row.id, row.id);
        this.db
          .prepare('INSERT INTO removals (item_id, kind, removed_at, device_id) VALUES (?, ?, ?, ?)')
          .run(row.id, row.kind, at, this.deviceId);
        this.log(row.id, 'remove', [], at);
      }
      return rows.length;
    })();
  }

  changesSince(seq = 0) {
    return this.db
      .prepare('SELECT * FROM changes WHERE seq > ? ORDER BY seq')
      .all(seq)
      .map((row) => ({
        seq: row.seq,
        itemId: row.item_id,
        op: row.op,
        fields: JSON.parse(row.fields),
        deviceId: row.device_id,
        at: row.at,
      }));
  }

  removalMarkers() {
    return this.db
      .prepare('SELECT item_id AS itemId, kind, removed_at AS removedAt, device_id AS deviceId FROM removals')
      .all();
  }

  pruneRemovalMarkers() {
    const cutoff = new Date(this.now().getTime() - REMOVAL_MARKER_DAYS * 86400000).toISOString();
    return this.db.prepare('DELETE FROM removals WHERE removed_at < ?').run(cutoff).changes;
  }

  title() {
    return this.getItem(this.id)?.title ?? '';
  }

  backupTo(destination) {
    copyDatabase(this.db, this.file, destination);
  }

  check() {
    return this.db.pragma('integrity_check', { simple: true }) === 'ok';
  }

  info() {
    return databaseInfo(this.db);
  }

  close() {
    this.db.close();
  }
}

module.exports = { Project, REMOVAL_MARKER_DAYS, TRASH_DAYS };
