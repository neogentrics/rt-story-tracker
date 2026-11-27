'use strict';
// Files you bring in: which section each file belongs in, what Find my files offers and asks, and what's saved. The folder shapes are
// made up, like the ones in issues 37 to 40.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SECTIONS, sectionLabel } = require('../src/shared/sections');
const { sectionOf } = require('../src/main/folder/filing');
const { buildPlan } = require('../src/main/folder/plan');
const { FolderImport } = require('../src/main/folder');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');

const tempDirs = [];
const spaces = [];
test.after(() => {
  spaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-files-'));
  tempDirs.push(dir);
  return dir;
};
const project = () => {
  const space = new Workspace(new Library(path.join(tempDir(), 'library')));
  spaces.push(space);
  const { outline } = space.createProject('Files');
  return { space, bookId: outline.children[0].id };
};
const folderOf = (files) => {
  const root = tempDir();
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
};
const plan = (list, edits) => buildPlan({ title: 'Stories', entries: list.map((rel, at) => ({ rel, size: 100 + at, mtime: 1000 + at })) }, edits);
const fileAt = (result, rel) => result.files.find((file) => file.rel === rel);
const filed = (result, rel) => [fileAt(result, rel).role, fileAt(result, rel).section];

test('the sections, in the order they are shown', () => {
  assert.deepEqual(SECTIONS.map((section) => section.label), ['Covers', 'Art', 'Audio', 'Video', 'Notes', 'Finished copies', 'Other files']);
  assert.equal(sectionLabel('finished'), 'Finished copies');
  assert.equal(sectionLabel('nonsense'), 'Other files');
});

test('each file goes where its type, its name and its folder say', () => {
  const table = {
    cover: ['Book 1/Covers/Back.png', 'Book 1/Cover Art/idea 3.jpg', 'Book 1/The_Road_Cover_v2.png', 'ebook cover.jpeg', 'Old covers/first try.webp', 'Book 1/wrap-cover.psd'],
    art: ['Book 1/Art/Marit.png', 'Reference/castle.jpg', 'Book 1/map.psd', 'Discovery.png', 'Undercover Agent sketch.gif', 'scan.tiff', 'photo.HEIC', 'logo.svg'],
    audio: ['Audio/ch1.mp3', 'Book 1/narration.m4b', 'theme.M4A', 'take 2.wav', 'a.flac', 'b.ogg', 'c.aac', 'd.opus', 'e.aiff', 'Covers/the cover song.mp3'],
    video: ['trailer.mp4', 'clip.mov', 'x.mkv', 'y.webm'],
    finished: ['Book 1/Print/interior.pdf', 'The Road.epub', 'kindle build.azw3', 'Research/a paper.pdf', 'Book 1/Print/The Road FULL.docx', 'Book 1/Ebook/the-road.docx'],
    notes: ['Book 1/Notes/ideas.docx', 'outline.md', 'random thoughts.txt', 'old format.doc', 'Timeline.xlsx', 'cast.csv', 'letter.rtf', 'cover letter.docx'],
    other: ['fonts/Quill.ttf', 'backup.zip', 'data.bin', 'no-extension', 'project.aeon'],
  };
  for (const [section, list] of Object.entries(table)) {
    for (const rel of list) assert.equal(sectionOf(rel.split('/').at(-1), rel), section, rel);
  }
});

test('a picture taken out of a document is art, whatever the document was', () => {
  assert.equal(sectionOf('image1.png', 'Book 1/Notes/ideas.docx'), 'art');
  assert.equal(sectionOf('map.png', ''), 'art', 'and one added by hand has no folder to go by');
  assert.equal(sectionOf('front.png', 'Book 1/Covers/art sheet.docx'), 'cover');
});

test('in a plan, covers, art, notes, audio and finished copies are told apart, and only the unknown is left over', () => {
  const result = plan([
    'Book 1/Chapter 1.docx', 'Book 1/Chapter 2.docx', 'Book 1/Covers/Front_Cover.png', 'Book 1/Covers/Back Cover.png', 'Book 1/Art/map.png',
    'Book 1/scene.jpg', 'Book 1/Audio/ch1.mp3', 'Book 1/Print/interior.pdf', 'Book 1/Notes/ideas.docx', 'Book 1/mystery.dat',
  ]);
  const book = result.tree.children[0];
  assert.deepEqual(filed(result, 'Book 1/Covers/Front_Cover.png'), ['cover', 'cover'], 'underscores don’t hide the word cover');
  assert.equal(book.cover, fileAt(result, 'Book 1/Covers/Front_Cover.png').id);
  for (const [rel, section] of [
    ['Book 1/Covers/Back Cover.png', 'cover'], ['Book 1/Art/map.png', 'art'], ['Book 1/scene.jpg', 'art'], ['Book 1/Audio/ch1.mp3', 'audio'],
    ['Book 1/Print/interior.pdf', 'finished'], ['Book 1/Notes/ideas.docx', 'notes'], ['Book 1/mystery.dat', 'other'],
  ]) assert.deepEqual(filed(result, rel), ['attachment', section], rel);
  assert.deepEqual(result.totals.sections, { cover: 1, art: 2, audio: 1, notes: 1, finished: 1, other: 1 });
});

test('a question about unclear writing starts on Notes, and can still make chapters or leave them as other files', () => {
  const list = ['Book 1/Chapter 1.docx', 'Book 1/Random Thing.docx'];
  const first = plan(list);
  const [ask] = first.asks;
  assert.equal(ask.type, 'unsure');
  assert.equal(ask.value, 'notes');
  assert.deepEqual(ask.options.map((option) => option.value), ['notes', 'chapter', 'attachment']);
  assert.deepEqual(filed(first, 'Book 1/Random Thing.docx'), ['attachment', 'notes']);
  assert.equal(fileAt(plan(list, { answers: { [ask.id]: 'chapter' } }), 'Book 1/Random Thing.docx').role, 'chapter');
  assert.deepEqual(filed(plan(list, { answers: { [ask.id]: 'attachment' } }), 'Book 1/Random Thing.docx'), ['attachment', 'other']);
});

test('writing with no book starts on Notes, or on one book where the names are chapters', () => {
  const loose = plan(['My Series/Book A/Chapter 1.docx', 'My Series/Book B/Chapter 1.docx', 'My Series/thoughts.docx', 'My Series/more thoughts.docx']);
  const ask = loose.asks.find((item) => item.type === 'loose');
  assert.equal(ask.value, 'notes');
  assert.deepEqual(ask.options.map((option) => option.value), ['notes', 'attachment', 'book', 'books']);
  assert.deepEqual(filed(loose, 'My Series/thoughts.docx'), ['attachment', 'notes']);
  const chapters = plan(['My Series/Book A/Chapter 1.docx', 'My Series/Book B/Chapter 1.docx', 'My Series/Chapter 1.docx', 'My Series/Chapter 2.docx']);
  assert.equal(chapters.asks.find((item) => item.type === 'loose').value, 'book');
});

test('no question starts on plain attachments', () => {
  const result = plan([
    'Stuff/alpha.docx', 'Stuff/beta.docx', 'Book 1/Chapter 1.docx', 'Book 1/Random.docx', 'My Series/Book A/Chapter 1.docx',
    'My Series/Book B/Chapter 1.docx', 'My Series/loose.docx',
  ]);
  assert.ok(result.asks.length >= 3);
  for (const ask of result.asks) assert.notEqual(ask.value, 'attachment', `${ask.type}: ${ask.question}`);
});

test('the author can put any file in any section before it comes in, and take it back to a chapter', () => {
  const list = ['Book 1/Chapter 1.docx', 'Book 1/Covers/Front Cover.png', 'Book 1/scene.jpg'];
  const base = plan(list);
  const id = (rel) => fileAt(base, rel).id;
  const moved = plan(list, { sections: { [id('Book 1/scene.jpg')]: 'cover', [id('Book 1/Covers/Front Cover.png')]: 'art', [id('Book 1/Chapter 1.docx')]: 'notes' } });
  assert.deepEqual(filed(moved, 'Book 1/scene.jpg'), ['attachment', 'cover']);
  assert.deepEqual(filed(moved, 'Book 1/Covers/Front Cover.png'), ['attachment', 'art'], 'a picture the author calls art isn’t made the cover');
  assert.deepEqual(filed(moved, 'Book 1/Chapter 1.docx'), ['attachment', 'notes']);
});

test('the choices are kept as edits: a section, then a chapter again, and a section that isn’t one is refused', async () => {
  const { space } = project();
  const root = folderOf({ 'Book 1/Chapter 1.txt': 'One two three.', 'Book 1/Chapter 2.txt': 'Four five.' });
  const folder = new FolderImport();
  const first = await folder.scan(space, root, () => {});
  const two = fileAt(first, 'Book 1/Chapter 2.txt').id;
  const asNotes = await folder.edit(space, { type: 'section', id: two, section: 'notes' });
  assert.deepEqual(filed(asNotes, 'Book 1/Chapter 2.txt'), ['attachment', 'notes']);
  const back = await folder.edit(space, { type: 'role', id: two, role: 'chapter' });
  assert.equal(fileAt(back, 'Book 1/Chapter 2.txt').role, 'chapter');
  await assert.rejects(async () => folder.edit(space, { type: 'section', id: two, section: 'elsewhere' }), /section/);
});

test('what the preview showed is what’s saved, and the report says where each file went', async () => {
  const { space } = project();
  const root = folderOf({
    'Book 1/Chapter 1.txt': 'The first words.', 'Book 1/Art/map.png': 'not really a picture', 'Book 1/Audio/ch1.mp3': 'sound',
    'Book 1/Notes/ideas.txt': 'An idea.', 'Book 1/thing.bin': 'x',
  });
  const folder = new FolderImport();
  const first = await folder.scan(space, root, () => {});
  await folder.edit(space, { type: 'section', id: fileAt(first, 'Book 1/thing.bin').id, section: 'notes' });
  const { report, outline } = await folder.run(space, () => {});
  const book = outline.children[0];
  assert.deepEqual(Object.fromEntries(space.listAttachments(book.id).map((item) => [item.name, item.section])), { 'map.png': 'art', 'ch1.mp3': 'audio', 'ideas.txt': 'notes', 'thing.bin': 'notes' });
  const kept = report.groups.find((group) => group.outcome === 'attachment');
  assert.equal(kept.label, 'Kept as files');
  assert.equal(kept.files.find((file) => file.rel === 'Book 1/Art/map.png').note, 'Filed under Art.');
});

test('files brought in before there were sections are sorted too, with nothing on disk or in the project rewritten', async () => {
  const { space, bookId } = project();
  const add = (name, from) => space.project.addAttachment(bookId, { name, source: Buffer.from(name), from });
  const items = [await add('Front.png', 'Book 1/Covers/Front.png'), await add('map.png', 'Book 1/map.png'), await add('ch1.mp3', 'x/ch1.mp3'), await add('ideas.docx', 'Book 1/Notes/ideas.docx'), await add('thing.bin', '')];
  const stored = () => items.map((item) => space.project.getItem(item.id).details);
  const before = stored();
  for (const text of before) assert.equal('section' in JSON.parse(text), false, 'saved the way 3.10 saved them');
  assert.deepEqual(space.listAttachments(bookId).map((item) => item.section), ['cover', 'art', 'audio', 'notes', 'other']);
  assert.deepEqual(stored(), before, 'looking doesn’t change anything');
});

// The Files view's actions.
const docx = require('docx');
const { Files, abilities } = require('../src/main/files');
const { readSource } = require('../src/main/import');
const { plainText } = require('../src/shared/text');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const wordFile = (...lines) => docx.Packer.toBuffer(new docx.Document({ sections: [{ children: lines.map((text) => new docx.Paragraph({ children: [new docx.TextRun(text)] })) }] }));

async function withFiles() {
  const { space, bookId } = project();
  const add = (name, source, parent = bookId, from = name) => space.project.addAttachment(parent, { name, source: Buffer.from(source), from });
  return { space, bookId, add, files: new Files(space) };
}
const byName = (list) => Object.fromEntries(list.files.map((file) => [file.name, file]));

test('a document reads the same from memory as from its file', async () => {
  const data = await wordFile('The first line.', 'And the second.');
  const root = folderOf({ 'Some Notes.docx': data });
  const fromDisk = await readSource(path.join(root, 'Some Notes.docx'));
  const fromMemory = await readSource('Some Notes.docx', data);
  assert.deepEqual(fromMemory.blocks, fromDisk.blocks);
  await assert.rejects(readSource('Book.scrivx', Buffer.from('x')), /folder/);
});

test('what a file allows goes by what it is', () => {
  assert.deepEqual(abilities('map.PNG'), { look: 'picture', writing: false, cover: true });
  assert.deepEqual(abilities('scan.gif'), { look: 'picture', writing: false, cover: false });
  assert.deepEqual(abilities('ch1.m4b'), { look: 'sound', writing: false, cover: false });
  assert.deepEqual(abilities('ideas.docx'), { look: 'text', writing: true, cover: false });
  assert.deepEqual(abilities('thing.bin'), { look: '', writing: false, cover: false });
});

test('files change section and book, many at a time, and one wrong id changes nothing', async () => {
  const { space, bookId, add, files } = await withFiles();
  const other = space.addItem({ kind: 'book', parentId: space.outline().id, title: 'Second' }).outline.children.at(-1).id;
  const a = await add('a.png', 'a');
  const b = await add('b.png', 'bb');
  assert.equal(files.setSection([a.id, b.id], 'cover'), 2);
  assert.deepEqual(files.list(bookId).files.map((file) => file.section), ['cover', 'cover']);
  assert.throws(() => files.setSection([a.id, 'nothing'], 'audio'), /missing/);
  assert.equal(byName(files.list(bookId))['a.png'].section, 'cover', 'the first wasn’t changed either');
  assert.throws(() => files.setSection([a.id], 'somewhere'), /section/);
  files.move([a.id], other);
  assert.deepEqual([Object.keys(byName(files.list(bookId))), Object.keys(byName(files.list(other)))], [['b.png'], ['a.png']]);
  assert.equal(byName(files.list(other))['a.png'].section, 'cover', 'moving keeps the section');
  assert.throws(() => files.move([b.id], a.id), /can't be moved/);
  files.trash([a.id, b.id]);
  assert.equal(files.list(space.outline().id).files.length, 0);
  assert.equal(space.listTrash().length, 2);
});

test('a look at a file shows a picture, plays a sound or reads a document, and says why when it can’t', async () => {
  const { add, files } = await withFiles();
  const picture = await add('map.png', PNG);
  const sound = await add('ch1.mp3', 'not really sound');
  const text = await add('ideas.docx', await wordFile('A very good idea.'));
  const other = await add('thing.bin', 'x');
  const broken = await add('broken.docx', 'not a document');
  assert.match((await files.preview(picture.id)).url, /^data:image\/png;base64,/);
  assert.match((await files.preview(sound.id)).url, /^data:audio\/mpeg;base64,/);
  assert.deepEqual(await files.preview(text.id), { kind: 'text', text: 'A very good idea.', words: 4, cut: false });
  assert.match((await files.preview(other.id)).why, /can’t be shown/);
  assert.match((await files.preview(broken.id)).why, /couldn’t be read/);
});

test('a picture becomes the cover, and the cover before it is kept', async () => {
  const { space, bookId, add, files } = await withFiles();
  const first = Buffer.concat([PNG, Buffer.from('first')]);
  space.setCover(bookId, { type: 'image/png', data: first, width: 1, height: 1 });
  const next = await add('new front.png', Buffer.concat([PNG, Buffer.from('next')]));
  assert.deepEqual(files.list(bookId).covers.map((cover) => cover.bookId), [bookId]);
  await files.useAsCover(next.id);
  assert.ok(Buffer.from(space.project.cover(bookId).data).equals(await space.project.attachments.read(space.project.attachment(next.id).file)));
  const kept = byName(files.list(bookId))['Earlier cover.png'];
  assert.equal(kept.section, 'cover');
  assert.ok((await space.project.attachments.read(space.project.attachment(kept.id).file)).equals(first), 'the old cover, whole');
  await files.useAsCover(kept.id);
  await files.useAsCover(next.id);
  assert.equal(files.list(bookId).files.length, 2, 'going back and forth keeps no extra copies');
  const loose = await add('x.png', PNG, space.outline().id);
  await assert.rejects(files.useAsCover(loose.id), /Move the picture to a book/);
  const gif = await add('y.gif', 'GIF89a');
  await assert.rejects(files.useAsCover(gif.id), /JPEG or PNG/);
});

test('writing becomes a chapter at the end of its book, and the file waits in the Trash', async () => {
  const { space, bookId, add, files } = await withFiles();
  const item = await add('The_Lost_Chapter.docx', await wordFile('Words that were filed as notes.'));
  const made = await files.makeChapter(item.id);
  assert.equal(made.chapters, 1);
  assert.equal(plainText(space.loadChapter(made.first).body), 'Words that were filed as notes.');
  assert.equal(space.loadChapter(made.first).title, 'The Lost Chapter');
  assert.equal(files.list(bookId).files.length, 0);
  assert.deepEqual(space.listTrash().map((row) => row.title), ['The_Lost_Chapter.docx']);
  assert.equal(space.progress().today, 0, 'bringing writing in isn’t writing');
});

test('a file with no words, or that isn’t writing, makes nothing and stays where it was', async () => {
  const { space, bookId, add, files } = await withFiles();
  const empty = await add('empty.txt', '   ');
  const picture = await add('map.png', PNG);
  const before = JSON.stringify(space.outline());
  await assert.rejects(files.makeChapter(empty.id), /no words/);
  await assert.rejects(files.makeChapter(picture.id), /isn’t a kind of writing/);
  const loose = await add('loose.txt', 'Some words.', space.outline().id);
  await assert.rejects(files.makeChapter(loose.id), /Choose the book/);
  assert.equal(JSON.stringify(space.outline()), before);
  assert.equal(files.list(space.outline().id).files.length, 3);
  assert.equal(space.listTrash().length, 0);
  assert.equal((await files.makeChapter(loose.id, bookId)).bookId, bookId);
});

test('writing becomes a record with the document as its notes, and a kind that isn’t there changes nothing', async () => {
  const { space, add, files } = await withFiles();
  const item = await add('Marit.txt', 'Marit keeps the ledger.');
  await assert.rejects(files.makeRecord(item.id, 'no such kind'));
  assert.equal(space.listTrash().length, 0);
  const type = space.records.createType({ title: 'Character', fields: [] });
  const made = await files.makeRecord(item.id, type.id);
  assert.equal(made.title, 'Marit');
  assert.equal(plainText(space.records.get(made.id).notes), 'Marit keeps the ledger.');
  assert.deepEqual(space.listTrash().map((row) => row.title), ['Marit.txt']);
});

test('looking at and converting files writes no unencrypted copy anywhere', async () => {
  const { space, add, files } = await withFiles();
  const marker = 'ZZ-PRIVATE-WORDS-7741';
  const item = await add('secret.docx', await wordFile(`${marker} in a document.`));
  const text = await add('secret.txt', `${marker} in plain text.`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-watch-'));
  tempDirs.push(temp);
  const written = [];
  const real = { writeFileSync: fs.writeFileSync, openSync: fs.openSync, createWriteStream: fs.createWriteStream, writeFile: fs.promises.writeFile };
  const note = (file) => { if (typeof file === 'string') written.push(file); };
  fs.writeFileSync = (file, ...rest) => { note(file); return real.writeFileSync(file, ...rest); };
  fs.openSync = (file, flags, ...rest) => { if (/[wa+]/.test(String(flags))) note(file); return real.openSync(file, flags, ...rest); };
  fs.createWriteStream = (file, ...rest) => { note(file); return real.createWriteStream(file, ...rest); };
  fs.promises.writeFile = (file, ...rest) => { note(file); return real.writeFile(file, ...rest); };
  try {
    await files.preview(item.id);
    await files.makeChapter(item.id);
    await files.preview(text.id);
    await files.makeChapter(text.id);
    // The watch has to see a write when there is one.
    fs.writeFileSync(path.join(temp, 'control'), 'x');
  } finally {
    Object.assign(fs, { writeFileSync: real.writeFileSync, openSync: real.openSync, createWriteStream: real.createWriteStream });
    fs.promises.writeFile = real.writeFile;
  }
  assert.deepEqual([...new Set(written)], [path.join(temp, 'control')], `only the control was opened for writing: ${written.join(', ')}`);
});
