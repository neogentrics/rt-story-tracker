'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Inbox } = require('../src/main/inbox');
const { Linking } = require('../src/main/linking');
const { exportEverything } = require('../src/main/export');
const { pageHtml, printable, printableMarkdown, recordsHtml } = require('../src/main/export/printable');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { cleanType, audienceOf, parseRecord, versionLabel } = require('../src/shared/records');
const { cleanSettings } = require('../src/shared/themes');
const { documentFromText } = require('../src/shared/text');

const SECRET = 'ZZ-AUTHOR-ONLY-7731';
const tempDirs = [];
const workspaces = [];

test.after(() => {
  workspaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});

const doc = (text) => JSON.stringify(documentFromText(text));

// A project with two books and a versioned kind of record: Role and Rank are for print, the Secret field and the author's own
// notes are not. Every secret thing carries the same marker, so a scan can find it anywhere it shouldn't be.
function setUp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-versions-'));
  tempDirs.push(dir);
  const space = new Workspace(new Library(path.join(dir, 'library')));
  workspaces.push(space);
  const { outline } = space.createProject('Salt Road');
  const bookOne = outline.children[0];
  const bookTwo = space.addItem({ kind: 'book', parentId: outline.id, title: 'The Second Door' }).item;
  const records = space.records;
  const type = records.createType({
    title: 'Character',
    versioning: true,
    labelWord: 'Record',
    numbering: { prefix: '', digits: 4 },
    fields: [
      { name: 'Role', kind: 'choice', options: ['Main', 'Minor'], audience: 'print' },
      { name: 'Rank', kind: 'text', audience: 'print' },
      { name: 'Background', kind: 'longtext', audience: 'print' },
      { name: `${SECRET} field`, kind: 'text' },
    ],
  });
  const f = (name) => type.fields.find((field) => field.name === name).id;
  const secretField = type.fields.find((field) => field.name.startsWith(SECRET)).id;
  const record = records.create({
    typeId: type.id,
    title: 'Marit Vance',
    number: 100,
    values: { [f('Role')]: 'Main', [f('Rank')]: 'Captain', [f('Background')]: 'Born at the harbour.\nRaised by her grandmother.', [secretField]: `${SECRET} killed the baker` },
    notes: doc(`${SECRET} author notes`),
  });
  records.save({ id: record.id, printNotes: doc('PRINT-OK a short biography.') });
  return { dir, space, records, type, record, f, secretField, bookOne: bookOne.id, bookTwo: bookTwo.id };
}

test('a field is for the author alone unless it says it’s for print, in a kind that keeps versions', () => {
  const plain = cleanType({ fields: [{ name: 'A', kind: 'text' }] });
  assert.equal(audienceOf(plain, plain.fields[0]), 'print', 'a kind with no versions prints what it always did');
  const kept = cleanType({ fields: [{ name: 'A', kind: 'text' }, { name: 'B', kind: 'text', audience: 'print' }, { name: 'C', kind: 'text', audience: 'nonsense' }], versioning: true });
  assert.deepEqual(kept.fields.map((field) => audienceOf(kept, field)), ['author', 'print', 'author']);
  assert.equal(kept.versioning, true);
  assert.equal('labelWord' in kept, false);
  assert.equal(cleanType({ fields: [], versioning: true, labelWord: '  Dossier  ' }).labelWord, 'Dossier');
  assert.equal(versionLabel({ numbering: { prefix: '', digits: 4 }, labelWord: 'Record' }, 100, 2), 'Record 0100 · Revision 2');
  assert.equal(versionLabel({ numbering: null }, null, 1, { draft: true }), 'Record · Revision 1 (draft)');
});

test('freezing writes the next version once, tied to the book it covers', () => {
  const { records, record, f, bookOne } = setUp();
  const frozen = records.freeze({ id: record.id, bookId: bookOne });
  assert.deepEqual(frozen.versions.map((v) => [v.number, v.bookTitle]), [[1, 'Salt Road']]);
  assert.equal(frozen.revision, 2, 'what’s open now is the next version');
  const version = records.getVersion(frozen.versions[0].id);
  assert.equal(version.label, 'Record 0100 · Revision 1');
  assert.equal(version.values[f('Rank')], 'Captain');
  assert.equal(version.authorNotes.includes(SECRET), true, 'the author sees all of it');
  assert.deepEqual(version.changes, { print: [], author: [] }, 'the first version has nothing before it');
  assert.ok(version.frozenAt);
});

test('a frozen version can never be edited, removed or thrown away, below every screen', () => {
  const { space, records, record, f, bookOne } = setUp();
  const frozen = records.freeze({ id: record.id, bookId: bookOne });
  const id = frozen.versions[0].id;
  assert.throws(() => space.project.putItem({ id, title: 'v1 edited' }), /A frozen version can’t be changed/);
  assert.throws(() => space.project.putItem({ id, details: '{}' }), /can’t be changed/);
  assert.throws(() => space.project.putItem({ id, body: 'new' }), /can’t be changed/);
  assert.throws(() => space.project.putItem({ id, trashedAt: new Date().toISOString() }), /can’t be changed/);
  assert.throws(() => space.trashItem(id), /stays with its record/);
  const other = records.create({ typeId: records.get(record.id).type.id, title: 'Another' });
  assert.throws(() => space.project.moveItem(id, { parentId: other.id }), /can’t be changed/, 'and it can’t be moved to another record');
  records.save({ id: record.id, values: { [f('Rank')]: 'Admiral' } });
  assert.equal(records.getVersion(id).values[f('Rank')], 'Captain', 'editing the record goes in the next version, not this one');
  assert.equal(records.get(record.id).record.values[f('Rank')], 'Admiral');
  assert.equal(space.outline().children.length >= 1 && JSON.stringify(space.outline()).includes('v1'), false, 'versions stay out of the books and chapters');
});

test('a record is frozen for one book once, and only when something has changed', () => {
  const { records, record, f, bookOne, bookTwo } = setUp();
  records.freeze({ id: record.id, bookId: bookOne });
  assert.throws(() => records.freeze({ id: record.id, bookId: bookTwo }), /Nothing has changed since version 1/);
  records.save({ id: record.id, values: { [f('Rank')]: 'Admiral' } });
  assert.throws(() => records.freeze({ id: record.id, bookId: bookOne }), /Version 1 already covers “Salt Road”. Fixes go in the version for the next book/);
  assert.throws(() => records.freeze({ id: record.id, bookId: 'nope' }), /Choose the book/);
  assert.throws(() => records.freeze({ id: record.id, bookId: record.id }), /Choose the book/);
  assert.throws(() => records.freeze({ id: record.id }), /Choose the book/);
  const second = records.freeze({ id: record.id, bookId: bookTwo });
  assert.deepEqual(second.versions.map((v) => [v.number, v.bookTitle]), [[1, 'Salt Road'], [2, 'The Second Door']]);
  assert.equal(second.revision, 3);
});

test('a kind that doesn’t keep versions can’t freeze, and one with frozen versions keeps them for good', () => {
  const { space, records, type, record, bookOne } = setUp();
  const plain = records.createType({ title: 'Idea', fields: [] });
  const idea = records.create({ typeId: plain.id, title: 'A thing' });
  assert.throws(() => records.freeze({ id: idea.id, bookId: bookOne }), /doesn’t keep versions/);
  assert.throws(() => records.save({ id: idea.id, printNotes: doc('x') }), /one set of notes/);
  records.freeze({ id: record.id, bookId: bookOne });
  assert.throws(() => records.saveType({ id: type.id, versioning: false }), /keeps versions for good/);
  assert.equal(records.saveType({ id: plain.id, versioning: true }).versioning, true, 'a kind can start keeping versions later');
  assert.equal(records.saveType({ id: plain.id, versioning: false }).versioning, false, 'and stop, while it has none frozen');
  assert.equal(space.records.overview().types.find((item) => item.id === plain.id).versioning, false);
});

test('what changed is listed for print and for the author separately, and the author-only list never reaches print', () => {
  const { records, record, f, secretField, bookOne, bookTwo } = setUp();
  records.freeze({ id: record.id, bookId: bookOne });
  records.save({ id: record.id, title: 'Marit Vale', values: { [f('Role')]: 'Minor', [f('Rank')]: 'Captain', [f('Background')]: 'Changed.', [secretField]: `${SECRET} did not do it` }, notes: doc(`${SECRET} new author notes`), printNotes: doc('PRINT-OK a longer biography.') });
  const second = records.freeze({ id: record.id, bookId: bookTwo });
  const version = records.getVersion(second.versions[1].id);
  assert.deepEqual(version.changes.print, ['Name changed from “Marit Vance” to “Marit Vale”', 'Role: “Main” → “Minor”', 'Background changed', 'Notes changed']);
  assert.equal(version.changes.author.some((line) => line.includes(SECRET)), true);
  assert.deepEqual(version.changes.author.slice(-1), ['Author notes changed']);
  assert.equal(version.changes.print.some((line) => line.includes(SECRET)), false);
});

test('a version prints as it was frozen, even after the kind’s fields change', () => {
  const { records, type, record, f, bookOne } = setUp();
  const frozen = records.freeze({ id: record.id, bookId: bookOne });
  const fields = type.fields.map((field) => (field.name === 'Rank' ? { ...field, name: 'Title now', audience: 'author' } : field));
  records.saveType({ id: type.id, fields });
  const { pages } = records.printPages({ typeId: type.id, version: frozen.versions[0].id });
  assert.deepEqual(pages[0].fields.map((field) => field.name), ['Role', 'Rank', 'Background'], 'the frozen version still has Rank, for print');
  const working = records.printPages({ typeId: type.id, version: 'working' }).pages[0];
  assert.equal(working.fields.some((field) => field.name === 'Rank'), false, 'while the working copy follows the kind');
  assert.equal(working.fields.some((field) => field.name === 'Title now'), false, 'and a field made for the author stays out');
  assert.ok(f('Rank'));
});

test('a correction is written against a frozen version, and goes with the next one', () => {
  const { records, record, f, bookOne, bookTwo } = setUp();
  const frozen = records.freeze({ id: record.id, bookId: bookOne });
  const v1 = frozen.versions[0].id;
  const logged = records.correct({ id: record.id, versionId: v1, note: `Her rank was wrong ${SECRET}` });
  assert.equal(logged.revision, 2);
  assert.equal(logged.corrections[0].version, 1);
  assert.throws(() => records.correct({ id: record.id, versionId: v1, note: '  ' }), /Say what needs correcting/);
  assert.throws(() => records.correct({ id: record.id, versionId: record.id, note: 'x' }), /isn’t there/);
  assert.equal(records.getVersion(v1).values[f('Rank')], 'Captain', 'the frozen version itself is untouched');
  assert.equal(records.get(record.id).corrections.length, 1);
  records.save({ id: record.id, values: { [f('Rank')]: 'Admiral' } });
  const second = records.freeze({ id: record.id, bookId: bookTwo });
  const version = records.getVersion(second.versions[1].id);
  assert.ok(version.changes.author.some((line) => line.startsWith('Corrects version 1: Her rank was wrong')));
  assert.equal(version.changes.print.some((line) => line.includes('Corrects')), false);
  assert.deepEqual(records.get(record.id).corrections, [], 'it’s recorded, so it’s no longer waiting');
});

test('canon lock asks first: a locked record changes only when the author has said yes', () => {
  const { records, record, f } = setUp();
  records.save({ id: record.id, locked: true });
  assert.equal(records.get(record.id).record.locked, true);
  assert.throws(() => records.save({ id: record.id, title: 'Changed' }), /Canon lock: “Marit Vance” is locked/);
  assert.throws(() => records.save({ id: record.id, locked: false }), /Canon lock/, 'taking the lock off is a change too');
  assert.throws(() => records.save({ id: record.id, values: {}, confirmLocked: 'yes' }), /Canon lock/, 'only a real yes counts');
  assert.equal(records.get(record.id).record.title, 'Marit Vance');
  assert.equal(records.save({ id: record.id, title: 'Marit V.', confirmLocked: true }).title, 'Marit V.');
  assert.equal(records.get(record.id).record.locked, true, 'it stays locked');
  records.save({ id: record.id, locked: false, confirmLocked: true });
  assert.equal(records.save({ id: record.id, title: 'Free again' }).title, 'Free again');
  assert.throws(() => records.save({ id: record.id, locked: 'maybe' }), /on or off/);
  assert.ok(f('Role'));
});

test('a locked record is left alone by an import that would fill it in', () => {
  const { RecordImporter, NAME, NEW } = require('../src/main/records-import');
  const { space, records, type, record, dir } = setUp();
  records.save({ id: record.id, locked: true });
  const file = path.join(dir, 'a.csv');
  fs.writeFileSync(file, 'Name,Rank\nMarit Vance,Admiral\n');
  const importer = new RecordImporter();
  importer.load([file]);
  const rank = type.fields.find((field) => field.name === 'Rank').id;
  const result = importer.run(records, { typeId: type.id, mapping: [{ label: 'Name', target: NAME }, { label: 'Rank', target: rank }], duplicates: 'update' });
  assert.deepEqual([result.updated, result.skipped], [0, 1]);
  assert.match(result.problems[0].message, /canon lock/);
  assert.equal(records.get(record.id).record.values[rank], 'Captain');
  assert.ok(space && NEW);
});

test('versions and the lock survive a record going to the Trash and coming back', () => {
  const { space, records, record, f, bookOne } = setUp();
  records.save({ id: record.id, locked: true });
  records.freeze({ id: record.id, bookId: bookOne });
  space.trashItem(record.id);
  space.restoreItem(record.id);
  const back = records.get(record.id);
  assert.equal(back.versions.length, 1);
  assert.equal(back.record.locked, true);
  assert.equal(back.record.values[f('Rank')], 'Captain');
});

test('printed pages say which revision they are, and a set skips records with nothing frozen', () => {
  const { records, type, record, bookOne } = setUp();
  records.create({ typeId: type.id, title: 'Jon Reed', number: 101 });
  const working = records.printPages({ typeId: type.id, version: 'working' });
  assert.deepEqual(working.pages.map((page) => page.label), ['Record 0100 · Revision 1 (draft)', 'Record 0101 · Revision 1 (draft)']);
  const none = records.printPages({ typeId: type.id, version: 'frozen' });
  assert.deepEqual([none.pages.length, none.skipped], [0, 2]);
  records.freeze({ id: record.id, bookId: bookOne });
  const frozen = records.printPages({ typeId: type.id, version: 'frozen' });
  assert.deepEqual(frozen.pages.map((page) => page.label), ['Record 0100 · Revision 1']);
  assert.equal(frozen.skipped, 1);
  const chosen = records.printPages({ typeId: type.id, ids: [record.id], version: 'working' });
  assert.equal(chosen.pages.length, 1);
  assert.equal(chosen.pages[0].label, 'Record 0100 · Revision 2 (draft)');
  const html = recordsHtml(frozen.pages, 'Character');
  assert.match(html, /Record 0100 · Revision 1/);
  assert.match(html, /<dt>Rank<\/dt><dd>Captain<\/dd>/);
  assert.ok(pageHtml(frozen.pages[0]).includes('Born at the harbour.'));
});

// The rule that matters most: the author-only part is in no document that leaves.

function everyFile(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? everyFile(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

function secretsIn(text, where) {
  assert.equal(text.includes(SECRET), false, `${where} holds the author-only part`);
  assert.equal(/killed the baker|did not do it|author notes/i.test(text), false, `${where} holds author-only words`);
}

test('the author-only part is in no print, no export, no status and no fact', async (t) => {
  const { space, records, type, record, f, secretField, bookOne, bookTwo, dir } = setUp();
  records.freeze({ id: record.id, bookId: bookOne });
  const now = () => records.get(record.id).record.values;
  records.save({ id: record.id, values: { ...now(), [f('Rank')]: 'Admiral', [secretField]: `${SECRET} did not do it` }, notes: doc(`${SECRET} new author notes`) });
  records.correct({ id: record.id, versionId: records.get(record.id).versions[0].id, note: `${SECRET} was wrong` });
  records.freeze({ id: record.id, bookId: bookTwo });
  records.save({ id: record.id, values: { ...now(), [f('Rank')]: 'Commodore' } });

  // It is there, for the author.
  assert.ok(records.get(record.id).notes.includes(SECRET));
  assert.ok(records.getVersion(records.get(record.id).versions[0].id).authorNotes.includes(SECRET));

  // Print, every way it can be asked for.
  for (const version of ['working', 'frozen', ...records.get(record.id).versions.map((v) => v.id)]) {
    const { pages } = records.printPages({ typeId: type.id, version });
    assert.ok(pages.length);
    secretsIn(JSON.stringify(pages), `print pages (${version})`);
    secretsIn(recordsHtml(pages), `print html (${version})`);
    for (const page of pages) secretsIn(printableMarkdown(page, '0100'), `print markdown (${version})`);
  }
  const shown = recordsHtml(records.printPages({ typeId: type.id, version: 'frozen' }).pages);
  assert.ok(shown.includes('PRINT-OK'), 'the printable part is there');
  assert.ok(shown.includes('Born at the harbour'));
  secretsIn(JSON.stringify(printable(type, { title: 'x', number: 1, values: { [secretField]: SECRET }, authorNotes: doc(SECRET), printNotes: '' })), 'printable()');

  // Export everything: every file written.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-secret-out-'));
  tempDirs.push(out);
  const { folder } = await exportEverything(space.project, out);
  const files = everyFile(folder);
  assert.ok(files.some((file) => /Records[\\/]Character[\\/]0100 Marit Vance v2\.md$/.test(file)), 'the frozen versions are written too');
  assert.ok(files.some((file) => /Character\.csv$/.test(file)));
  for (const file of files) secretsIn(fs.readFileSync(file, 'latin1'), `export file ${path.relative(folder, file)}`);
  assert.ok(fs.readFileSync(files.find((file) => /Character\.csv$/.test(file)), 'utf8').includes('PRINT-OK'));

  // Find, status and facts.
  secretsIn(JSON.stringify(records.find({ query: 'Marit' })), 'find');
  secretsIn(JSON.stringify(records.find({ query: SECRET })), 'find by the secret');
  assert.deepEqual(records.find({ query: SECRET }), [], 'and the secret can’t be searched for');
  const settings = { values: cleanSettings({ appLink: false }), save() {} };
  const linking = new Linking({
    workspace: space, settings, vault: { available: () => false }, inbox: new Inbox(), root: path.join(dir, 'library'),
    tempDir: dir, home: dir, dataDir: dir, version: '3.10.0', ask: async () => true, places: () => [],
  });
  t.after(() => linking.close());
  space.setActivity({ mode: 'records', chapterId: null });
  secretsIn(JSON.stringify(linking.describe()), 'status');
  secretsIn(JSON.stringify(linking.factProvider().get('book.progress')), 'facts');
  secretsIn(JSON.stringify(linking.factProvider().list()), 'the list of facts');
  secretsIn(await linking.markdownOf(space.project, { scope: 'book', id: bookOne }), 'a book sent to another app');
});

test('the same scan catches a leak, so it isn’t passing by looking at nothing', () => {
  assert.throws(() => secretsIn(`x ${SECRET} y`, 'a leaky file'), /holds the author-only part/);
  assert.throws(() => secretsIn('he killed the baker', 'a leaky file'), /author-only words/);
});

test('a project from 3.9 opens with versions off and everything where it was', () => {
  const { space, records } = setUp();
  const plain = records.createType({ title: 'Place', fields: [{ name: 'Kind', kind: 'text' }] });
  const view = records.overview().types.find((item) => item.id === plain.id);
  assert.equal(view.versioning, false);
  assert.equal(view.labelWord, 'Record');
  const record = records.create({ typeId: plain.id, title: 'Harbour', values: { [plain.fields[0].id]: 'Town' } });
  assert.equal(parseRecord(space.project.getItem(record.id).details).locked, false);
  assert.equal(space.project.getItem(record.id).details.includes('locked'), false, 'a record that uses none of this keeps its small details');
  assert.equal(audienceOf(parseRecordType(plain), plain.fields[0]), 'print');
});

function parseRecordType(typeView) {
  return { fields: typeView.fields, versioning: typeView.versioning };
}
