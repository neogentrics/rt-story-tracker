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
