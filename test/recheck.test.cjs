'use strict';
// Checking a folder for changes. What's held to here: nothing is applied that wasn't picked, no words are ever lost, the folder is only
// read, a folder is only looked at if it was chosen on this computer, and a closed project stops the check.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FolderImport } = require('../src/main/folder');
const { fingerprint, notesIn } = require('../src/main/folder/fingerprint');
const { FolderLinks } = require('../src/main/folder/links');
const { FolderCheck } = require('../src/main/folder/recheck');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { findNode } = require('../src/shared/outline');
const { plainText } = require('../src/shared/text');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const OTHER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC', 'base64');
const tempDirs = [];
const spaces = [];

test.after(() => {
  spaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recheck-'));
  tempDirs.push(dir);
  return dir;
}

const at = (root, rel) => path.join(root, ...rel.split('/'));
// Every write gets a later time than the one before, as a person's saves would.
let written = Date.now();
function put(root, rel, content) {
  const full = at(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  written += 5000;
  fs.utimesSync(full, new Date(written), new Date(written));
}

// What's in a folder, to the byte and the time, so a test can show nothing in it was touched.
function snapshot(root) {
  const lines = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else lines.push(`${path.relative(root, full)} ${fs.statSync(full).mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex')}`);
    }
  };
  walk(root);
  return lines.sort();
}

const ROAD = {
  'Book_1_The_Road/Chapter 1.md': 'The road began at the mill.\n',
  'Book_1_The_Road/Chapter 2.md': 'It crossed the ford at noon.\n',
  'Book_1_The_Road/Chapter 3.md': 'Nobody walked it after dark.\n',
  'Book_1_The_Road/Art/map.png': 'a map of the road',
  'Book_1_The_Road/Cover.png': PNG,
};

async function imported(contents = ROAD) {
  const root = tempDir();
  for (const [rel, content] of Object.entries(contents)) put(root, rel, content);
  let clock = Date.now();
  const space = new Workspace(new Library(path.join(tempDir(), 'library'), { now: () => new Date((clock += 1000)) }));
  spaces.push(space);
  const { id } = space.createProject('Found');
  const folder = new FolderImport();
  await folder.scan(space, root, () => {});
  await folder.run(space, () => {});
  const links = new FolderLinks(tempDir());
  const [record] = space.project.folderImports();
  links.add(id, record.id, root);
  const check = new FolderCheck();
  const run = () => check.check(space, links);
  const all = () => {
    const found = [];
    const walk = (node) => {
      found.push(node);
      node.children.forEach(walk);
    };
    walk(space.outline());
    return found;
  };
  const chapter = (title) => all().find((node) => node.kind === 'chapter' && node.title === title);
  const book = (title = 'The Road') => all().find((node) => node.kind === 'book' && node.title === title);
  const text = (title) => plainText(space.project.getItem(chapter(title).id).body);
  const write = (title, words) => space.saveChapter({ id: chapter(title).id, title, body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] }) });
  const versions = (title) => space.project.listVersions(chapter(title).id).map((version) => [version.reason, plainText(space.project.getVersion(version.id).body)]);
  const files = () => space.project.listAttachments(id).map((file) => file.name).sort();
  const choose = async (picks) => {
    const result = await run();
    const chosen = Object.entries(picks).map(([title, pick]) => {
      const entry = result.entries.find((one) => one.title === title);
      assert.ok(entry, `“${title}” is listed: ${result.entries.map((one) => one.title)}`);
      return { key: entry.key, choice: Array.isArray(pick) ? pick[0] : pick, bookId: Array.isArray(pick) ? pick[1] : undefined };
    });
    return check.apply(space, chosen);
  };
  return { root, space, id, links, check, record, run, chapter, book, text, write, versions, files, choose, all };
}

const listed = (result) => result.entries.map((entry) => `${entry.group}: ${entry.title} [${entry.choices.join(' ')}]`).sort();

test('a mark of a chapter’s text ignores notes on the words and what the editor fills in, and nothing else', () => {
  const doc = (content) => ({ type: 'doc', content });
  const para = (...content) => ({ type: 'paragraph', content });
  const plain = doc([para({ type: 'text', text: 'Mara walked home.' })]);
  const same = [
    doc([para({ type: 'text', text: 'Mara ' }, { type: 'text', text: 'walked', marks: [{ type: 'comment', attrs: { id: 'c1' } }] }, { type: 'text', text: ' home.' })]),
    doc([para({ type: 'text', text: 'Mara', marks: [{ type: 'mention', attrs: { id: 'r1' } }] }, { type: 'text', text: ' walked home.' })]),
    doc([{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Mara walked home.' }] }, { type: 'paragraph' }]),
    doc([{ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'Mara walked home.' }] }]),
  ];
  for (const other of same) assert.equal(fingerprint(other), fingerprint(plain), JSON.stringify(other));
  const different = [
    doc([para({ type: 'text', text: 'Mara walked home!' })]),
    doc([para({ type: 'text', text: 'Mara walked home.', marks: [{ type: 'italic' }] })]),
    doc([{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Mara walked home.' }] }]),
    doc([{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Mara walked home.' }] }]),
    doc([{ type: 'paragraph' }, ...plain.content]),
  ];
  for (const other of different) assert.notEqual(fingerprint(other), fingerprint(plain), JSON.stringify(other));
  assert.deepEqual(notesIn(JSON.stringify(same[0])), { comments: 1, links: 0 });
});

test('with nothing changed nothing is listed, and a file saved again with the same words isn’t a change', async () => {
  const it = await imported();
  const before = snapshot(it.root);
  assert.deepEqual((await it.run()).entries, []);
  assert.deepEqual(snapshot(it.root), before, 'the folder is only read');
  put(it.root, 'Book_1_The_Road/Chapter 1.md', ROAD['Book_1_The_Road/Chapter 1.md']);
  assert.deepEqual((await it.run()).entries, []);
});

test('each kind of change is found, grouped and offered its own choices, and looking changes no writing', async () => {
  const it = await imported();
  it.write('Chapter 2', 'It crossed the ford at dusk, in the app.');
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'The road began at the old mill.\n');
  put(it.root, 'Book_1_The_Road/Chapter 2.md', 'It crossed the ford at dawn, in the folder.\n');
  fs.rmSync(at(it.root, 'Book_1_The_Road/Chapter 3.md'));
  put(it.root, 'Book_1_The_Road/Chapter 4.md', 'A new chapter.\n');
  put(it.root, 'Book_1_The_Road/Art/ford.png', 'a picture of the ford');
  put(it.root, 'Book_1_The_Road/Art/map.png', 'a better map of the road');
  put(it.root, 'Book_1_The_Road/.DS_Store', 'junk');
  put(it.root, 'Book_1_The_Road/~$apter 4.docx', 'a lock file');
  const writing = () => it.all().filter((node) => node.kind === 'chapter').map((node) => it.space.project.getItem(node.id).body);
  const before = [writing(), it.files(), snapshot(it.root)];
  const result = await it.run();
  assert.deepEqual(listed(result), [
    'both: Chapter 2 [both folder app]',
    'folder: Chapter 1 [folder app both]',
    'folder: map.png [folder app both]',
    'gone: Chapter 3.md [leave]',
    'new: Chapter 4.md [chapter file leave]',
    'new: ford.png [file leave]',
  ]);
  const added = result.entries.find((entry) => entry.title === 'Chapter 4.md');
  assert.equal(added.bookId, it.book().id, 'a new file is offered to the book its folder went to');
  const compared = await it.check.compare(it.space, result.entries.find((entry) => entry.title === 'Chapter 2').key);
  assert.deepEqual(compared, { app: 'It crossed the ford at dusk, in the app.', folder: 'It crossed the ford at dawn, in the folder.' });
  assert.deepEqual([writing(), it.files(), snapshot(it.root)], before);
  // Applying nothing changes nothing, and it's all still listed.
  const none = await it.check.apply(it.space, []);
  assert.deepEqual([none.applied, writing(), it.files()], [[], before[0], before[1]]);
  assert.equal((await it.run()).entries.length, 6);
});

test('a comment added in the app isn’t a change to the text, and the person is told it stays with the earlier version', async () => {
  const it = await imported();
  const id = it.chapter('Chapter 1').id;
  const comment = it.space.addComment({ chapterId: id, text: 'Check the mill’s name' });
  const body = JSON.parse(it.space.project.getItem(id).body);
  body.content[0].content[0].marks = [{ type: 'comment', attrs: { id: comment.id } }];
  it.space.saveChapter({ id, title: 'Chapter 1', body: JSON.stringify(body) });
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'The road began at the weir.\n');
  const [entry] = (await it.run()).entries;
  assert.deepEqual([entry.group, entry.notes], ['folder', { comments: 1, links: 0 }]);

  await it.choose({ 'Chapter 1': 'folder' });
  assert.equal(it.text('Chapter 1'), 'The road began at the weir.');
  const [kept] = it.space.project.listVersions(id).filter((version) => version.reason === 'folder');
  it.space.restoreVersion({ chapterId: id, versionId: kept.id });
  assert.equal(it.text('Chapter 1'), 'The road began at the mill.');
  assert.deepEqual(notesIn(it.space.project.getItem(id).body), { comments: 1, links: 0 }, 'restoring brings the comment back on its words');
  assert.deepEqual(it.space.listComments(id).map((one) => one.text), ['Check the mill’s name']);
});

test('updating from the folder keeps the replaced words for good', async () => {
  const it = await imported();
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'The road began at the weir.\n');
  const result = await it.choose({ 'Chapter 1': 'folder' });
  assert.deepEqual([result.applied.length, result.skipped], [1, []]);
  assert.equal(it.text('Chapter 1'), 'The road began at the weir.');
  assert.deepEqual(it.versions('Chapter 1'), [['folder', 'The road began at the mill.']]);
  assert.deepEqual((await it.run()).entries, []);
  // Years of thinning later, it's still there, along with what came before it that day.
  const project = it.space.project;
  project.addVersion(it.chapter('Chapter 1').id, { title: 'Chapter 1', body: project.getItem(it.chapter('Chapter 1').id).body, reason: 'auto' });
  const later = project.now;
  project.now = () => new Date(later().getTime() + 400 * 86400000);
  project.thinVersions();
  assert.ok(it.versions('Chapter 1').some(([reason, words]) => reason === 'folder' && words === 'The road began at the mill.'));
});

test('keeping the app’s changes nothing, isn’t asked again, and the next change in the folder is a conflict', async () => {
  const it = await imported();
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Folder, first change.\n');
  await it.choose({ 'Chapter 1': 'app' });
  assert.equal(it.text('Chapter 1'), 'The road began at the mill.');
  assert.deepEqual(it.versions('Chapter 1'), []);
  assert.deepEqual((await it.run()).entries, []);
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Folder, second change.\n');
  assert.deepEqual(listed(await it.run()), ['both: Chapter 1 [both folder app]'], 'the app’s text is its own now, so nothing replaces it quietly');
});

test('where both changed, every choice keeps both sets of words', async () => {
  for (const choice of ['both', 'folder', 'app']) {
    const it = await imported();
    it.write('Chapter 2', 'Written in the app.');
    put(it.root, 'Book_1_The_Road/Chapter 2.md', 'Written in the folder.\n');
    await it.choose({ 'Chapter 2': choice });
    const book = findNode(it.space.outline(), it.book().id);
    const everywhere = [
      ...it.all().filter((node) => node.kind === 'chapter').flatMap((node) => [plainText(it.space.project.getItem(node.id).body), ...it.space.project.listVersions(node.id).map((version) => plainText(it.space.project.getVersion(version.id).body))]),
    ];
    for (const words of ['Written in the app.', 'Written in the folder.']) assert.ok(everywhere.includes(words), `${choice} keeps “${words}”`);
    if (choice === 'both') {
      assert.deepEqual(book.children.map((node) => node.title), ['Chapter 1', 'Chapter 2', 'Chapter 2 (from the folder)', 'Chapter 3'], 'right after the app’s');
      assert.equal(it.text('Chapter 2'), 'Written in the app.');
      assert.equal(it.text('Chapter 2 (from the folder)'), 'Written in the folder.');
    }
    if (choice === 'folder') {
      assert.equal(it.text('Chapter 2'), 'Written in the folder.');
      assert.ok(it.versions('Chapter 2').some(([reason, words]) => reason === 'folder' && words === 'Written in the app.'));
    }
    if (choice === 'app') {
      assert.equal(it.text('Chapter 2'), 'Written in the app.');
      assert.ok(it.versions('Chapter 2').some(([reason, words]) => reason === 'unused' && words === 'Written in the folder.'));
    }
    assert.deepEqual((await it.run()).entries, [], `${choice} settles it`);
  }
});

test('texts that now match aren’t listed, and the next change in the folder is the folder’s alone', async () => {
  const it = await imported();
  it.write('Chapter 1', 'The same new words.');
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'The same new words.\n');
  assert.deepEqual((await it.run()).entries, []);
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Newer words from the folder.\n');
  assert.deepEqual(listed(await it.run()), ['folder: Chapter 1 [folder app both]']);
});

test('a file or chapter that changes between looking and applying is left alone', async () => {
  const it = await imported();
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'First look.\n');
  put(it.root, 'Book_1_The_Road/Chapter 2.md', 'Folder two.\n');
  const result = await it.run();
  const picks = result.entries.map((entry) => ({ key: entry.key, choice: 'folder' }));
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Changed after the look.\n');
  it.write('Chapter 2', 'Typed after the look.');
  const applied = await it.check.apply(it.space, picks);
  assert.deepEqual(applied.applied, []);
  assert.deepEqual(applied.skipped.map((one) => [one.title, /since you looked/.test(one.why)]).sort(), [['Chapter 1', true], ['Chapter 2', true]]);
  assert.deepEqual([it.text('Chapter 1'), it.text('Chapter 2')], ['The road began at the mill.', 'Typed after the look.']);
  assert.deepEqual(listed(await it.run()), ['both: Chapter 2 [both folder app]', 'folder: Chapter 1 [folder app both]']);
  await assert.rejects(it.check.apply(it.space, picks), /Check the folder again/, 'choices from an earlier list land on nothing in a later one');
  assert.deepEqual([it.text('Chapter 1'), it.text('Chapter 2')], ['The road began at the mill.', 'Typed after the look.']);
});

const MANUSCRIPT = { 'Book_1_The_Road/Manuscript.md': '# The Mill\n\nWords of the mill.\n\n# The Ford\n\nWords of the ford.\n\n# The Dark\n\nWords of the dark.\n' };
const manuscript = (mill, ford, dark = 'Words of the dark.') => `# The Mill\n\n${mill}\n\n# The Ford\n\n${ford}\n\n# The Dark\n\n${dark}\n`;

test('in a manuscript of several chapters, each is dealt with by itself, and what isn’t chosen stays listed', async () => {
  const it = await imported(MANUSCRIPT);
  put(it.root, 'Book_1_The_Road/Manuscript.md', manuscript('New mill.', 'New ford.'));
  assert.deepEqual(listed(await it.run()), ['folder: The Ford [folder app both]', 'folder: The Mill [folder app both]']);
  await it.choose({ 'The Mill': 'folder' });
  assert.deepEqual([it.text('The Mill'), it.text('The Ford'), it.text('The Dark')], ['New mill.', 'Words of the ford.', 'Words of the dark.']);
  assert.deepEqual(listed(await it.run()), ['folder: The Ford [folder app both]']);
  await it.choose({ 'The Ford': 'folder' });
  assert.deepEqual((await it.run()).entries, []);
});

test('a title changed in the app stays, and a heading changed in the file is offered', async () => {
  const it = await imported(MANUSCRIPT);
  it.space.rename({ id: it.chapter('The Mill').id, title: 'My Own Title' });
  put(it.root, 'Book_1_The_Road/Manuscript.md', manuscript('New mill.', 'Words of the ford.'));
  await it.choose({ 'My Own Title': 'folder' });
  assert.equal(it.text('My Own Title'), 'New mill.');
  put(it.root, 'Book_1_The_Road/Manuscript.md', manuscript('New mill.', 'Words of the ford.').replace('# The Ford', '# The Crossing'));
  const [entry] = (await it.run()).entries;
  assert.deepEqual([entry.title, entry.note], ['The Ford', 'Only its title changed in the file.']);
  await it.choose({ 'The Ford': 'folder' });
  assert.ok(it.chapter('The Crossing'));
});

test('a manuscript that gained or reordered chapters can only be kept beside yours', async () => {
  for (const changed of [`${manuscript('Words of the mill.', 'Words of the ford.')}\n# The Dawn\n\nNew.\n`, '# The Ford\n\nWords of the ford.\n\n# The Mill\n\nWords of the mill.\n\n# The Dark\n\nWords of the dark.\n']) {
    const it = await imported(MANUSCRIPT);
    put(it.root, 'Book_1_The_Road/Manuscript.md', changed);
    const [entry] = (await it.run()).entries;
    assert.deepEqual([entry.title, entry.choices], ['Manuscript.md', ['both', 'app']]);
    const was = ['The Mill', 'The Ford', 'The Dark'].map((title) => it.text(title));
    await it.choose({ 'Manuscript.md': 'both' });
    assert.deepEqual(['The Mill', 'The Ford', 'The Dark'].map((title) => it.text(title)), was, 'yours are as they were');
    assert.ok(it.chapter('The Dark (from the folder)'));
    assert.deepEqual((await it.run()).entries, []);
  }
});

test('a chapter in the Trash isn’t brought back by itself', async () => {
  const it = await imported();
  const id = it.chapter('Chapter 1').id;
  it.space.trashItem(id);
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Changed while it was in the Trash.\n');
  const [entry] = (await it.run()).entries;
  assert.deepEqual([entry.choices, entry.needsBook], [['new', 'leave'], true]);
  assert.equal(it.chapter('Chapter 1'), undefined);
  await it.choose({ 'Chapter 1': ['new', it.book().id] });
  assert.equal(it.text('Chapter 1'), 'Changed while it was in the Trash.');
  assert.ok(it.space.project.getItem(id).trashedAt, 'the one in the Trash is still there');
  assert.deepEqual((await it.run()).entries, []);
});

test('an updated file’s old copy goes to the Trash, keeping both adds one, and keeping the app’s changes nothing', async () => {
  for (const choice of ['folder', 'both', 'app']) {
    const it = await imported();
    const old = it.space.project.listAttachments(it.id).find((file) => file.name === 'map.png');
    put(it.root, 'Book_1_The_Road/Art/map.png', 'a better map');
    await it.choose({ 'map.png': choice });
    assert.deepEqual(it.files().filter((name) => name.startsWith('map')), choice === 'both' ? ['map (from the folder).png', 'map.png'] : ['map.png']);
    assert.equal(Boolean(it.space.project.getItem(old.id).trashedAt), choice === 'folder', choice);
    assert.deepEqual((await it.run()).entries, []);
  }
});

test('a new cover replaces the old one, which waits in the Trash', async () => {
  const it = await imported();
  const book = it.book().id;
  put(it.root, 'Book_1_The_Road/Cover.png', OTHER_PNG);
  assert.deepEqual(listed(await it.run()), ['folder: The cover of The Road [folder app]']);
  await it.choose({ 'The cover of The Road': 'folder' });
  assert.ok(it.space.project.cover(book).data.equals(OTHER_PNG));
  const trashed = it.space.project.trashed().map((item) => item.title);
  assert.ok(trashed.includes('Cover before the folder update.png'), String(trashed));
  assert.deepEqual((await it.run()).entries, []);
});

test('new files become what’s chosen, and one left out isn’t offered again until it changes', async () => {
  const it = await imported();
  put(it.root, 'Book_1_The_Road/Chapter 4.md', 'The fourth.\n');
  put(it.root, 'Book_1_The_Road/Art/ford.png', 'the ford');
  put(it.root, 'Book_1_The_Road/idea.txt', 'An idea.');
  const book = it.book().id;
  await it.choose({ 'Chapter 4.md': ['chapter', book], 'ford.png': ['file', book], 'idea.txt': 'leave' });
  assert.equal(it.text('Chapter 4'), 'The fourth.');
  assert.equal(it.space.project.listAttachments(book).find((file) => file.name === 'ford.png').section, 'art');
  assert.ok(!it.files().includes('idea.txt'));
  assert.deepEqual((await it.run()).entries, []);
  put(it.root, 'Book_1_The_Road/idea.txt', 'A better idea.');
  put(it.root, 'Book_1_The_Road/Chapter 4.md', 'The fourth, changed.\n');
  assert.deepEqual(listed(await it.run()), ['folder: Chapter 4 [folder app both]', 'new: idea.txt [chapter file leave]']);
});

test('a new file with no book to go to waits for one to be chosen', async () => {
  const it = await imported({ 'Book_1_The_Road/Chapter 1.md': 'One.\n', 'Book_2_The_River/Chapter 1.md': 'Two.\n' });
  put(it.root, 'loose.md', 'Words with no home.\n');
  const [entry] = (await it.run()).entries;
  assert.deepEqual([entry.needsBook, entry.bookId], [true, null]);
  const result = await it.choose({ 'loose.md': 'chapter' });
  assert.match(result.skipped[0].why, /Choose a book/);
});

test('a missing file is only reported, and a moved one is told apart and followed', async () => {
  const it = await imported();
  fs.rmSync(at(it.root, 'Book_1_The_Road/Chapter 3.md'));
  fs.renameSync(at(it.root, 'Book_1_The_Road/Art/map.png'), at(it.root, 'Book_1_The_Road/the old map.png'));
  const result = await it.run();
  assert.deepEqual(listed(result), ['gone: Chapter 3.md [leave]', 'gone: map.png [follow]']);
  await it.choose({ 'Chapter 3.md': 'leave', 'map.png': 'follow' });
  assert.equal(it.text('Chapter 3'), 'Nobody walked it after dark.', 'the app’s chapter stays');
  assert.ok(it.files().includes('map.png'));
  assert.deepEqual((await it.run()).entries, []);
  put(it.root, 'Book_1_The_Road/Chapter 3.md', 'It came back.\n');
  assert.deepEqual(listed(await it.run()), ['new: Chapter 3.md [chapter file leave]'], 'a file back under a name that was crossed off is new');
  await it.choose({ 'Chapter 3.md': 'leave' });
  put(it.root, 'Book_1_The_Road/the old map.png', 'redrawn');
  assert.deepEqual(listed(await it.run()), ['folder: map.png [folder app both]']);
});

test('a folder is only looked at if it was chosen on this computer', async () => {
  const it = await imported();
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Changed.\n');
  const elsewhere = new FolderLinks(tempDir());
  const touched = [];
  const real = { stat: fs.promises.stat, readdir: fs.promises.readdir, readFile: fs.promises.readFile };
  for (const name of Object.keys(real)) fs.promises[name] = (target, ...rest) => { touched.push(String(target)); return real[name].call(fs.promises, target, ...rest); };
  try {
    const result = await it.check.check(it.space, elsewhere);
    assert.deepEqual([result.entries, result.folders.map((folder) => [folder.linked, folder.there])], [[], [[false, null]]]);
    assert.deepEqual(touched.filter((target) => target.startsWith(it.root)), []);
    // A project whose folder path was changed, as by someone else, no longer matches what was chosen here.
    const secret = tempDir();
    put(secret, 'Book_1_The_Road/Chapter 1.md', 'A private file.\n');
    it.space.project.setFolderRoot(it.record.id, secret);
    touched.length = 0;
    const tampered = await it.run();
    assert.deepEqual([tampered.entries, tampered.folders[0].linked], [[], false]);
    assert.deepEqual(touched.filter((target) => target.startsWith(secret)), []);
  } finally {
    Object.assign(fs.promises, real);
  }
});

test('a file path planted in the project is never opened', async () => {
  const it = await imported();
  const outside = path.join(path.dirname(it.root), `planted-${path.basename(it.root)}.md`);
  fs.writeFileSync(outside, 'Not part of the folder.\n');
  tempDirs.push(outside);
  const chapter = it.chapter('Chapter 1').id;
  for (const rel of [`../${path.basename(outside)}`, outside]) it.space.project.saveFolderFile(it.record.id, { rel, size: 1, mtime: 1, kind: 'chapters', itemId: chapter, pieces: [] });
  const result = await it.run();
  assert.deepEqual(result.entries.map((entry) => [entry.group, entry.choices]), [['gone', ['leave']], ['gone', ['leave']]]);
  await it.check.apply(it.space, result.entries.map((entry) => ({ key: entry.key, choice: 'leave' })));
  assert.equal(it.text('Chapter 1'), 'The road began at the mill.');
});

test('choosing where a folder is takes one with its files, and no other', async () => {
  const it = await imported();
  const moved = tempDir();
  fs.cpSync(it.root, moved, { recursive: true });
  const links = new FolderLinks(tempDir());
  await assert.rejects(it.check.locate(it.space, links, it.record.id, tempDir()), /None of the files/);
  await it.check.locate(it.space, links, it.record.id, moved);
  assert.deepEqual((await it.check.check(it.space, links)).folders.map((folder) => [folder.root, folder.linked, folder.there]), [[moved, true, true]]);
});

test('closing or locking the project stops the check, and nothing seen before can be applied', async () => {
  const it = await imported();
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Changed.\n');
  await assert.rejects(it.check.check(it.space, it.links, { onProgress: () => it.space.closeProject() }), /closed|No project|open/i);
  await assert.rejects(it.check.check(it.space, it.links), /closed|No project|open/i);
  it.space.openProject(it.id);
  await assert.rejects(it.check.apply(it.space, [{ key: 'c1', choice: 'folder' }]), /Check the folder again/);
});

test('a folder that isn’t there, or can’t be read, lists nothing as gone', async () => {
  const it = await imported();
  const away = `${it.root}-away`;
  fs.renameSync(it.root, away);
  tempDirs.push(away);
  const result = await it.run();
  assert.deepEqual([result.entries, result.folders[0].there], [[], false]);
});

test('a folder inside it that can’t be listed lists nothing in it as gone', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const it = await imported();
  const closed = at(it.root, 'Book_1_The_Road/Art');
  fs.chmodSync(closed, 0o000);
  try {
    assert.deepEqual((await it.run()).entries, []);
  } finally {
    fs.chmodSync(closed, 0o755);
  }
});

test('the same folder brought in twice is only listed once', async () => {
  const it = await imported();
  const again = new FolderImport();
  await again.scan(it.space, it.root, () => {});
  await again.run(it.space, () => {});
  for (const record of it.space.project.folderImports()) it.links.add(it.id, record.id, it.root);
  put(it.root, 'Book_1_The_Road/Chapter 9.md', 'Nine.\n');
  const result = await it.run();
  assert.deepEqual(result.entries.map((entry) => entry.title), ['Chapter 9.md']);
});

// An import made by 3.10 or earlier: the same project, with none of what 3.11 writes down.
async function fromBefore(files) {
  const it = await imported(files);
  it.space.project.db.exec('DELETE FROM folder_files');
  return it;
}

test('an import from before 3.11 stays crossed off once a missing file is', async () => {
  const it = await fromBefore();
  fs.rmSync(at(it.root, 'Book_1_The_Road/Chapter 3.md'));
  await it.choose({ 'Chapter 3.md': 'leave' });
  assert.deepEqual((await it.run()).entries, []);
});

test('an import from before 3.11: unchanged is quiet, and a chapter saved since counts as changed in the app', async () => {
  const it = await fromBefore();
  assert.deepEqual((await it.run()).entries, []);
  it.write('Chapter 2', 'Edited in the app.');
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Folder one.\n');
  put(it.root, 'Book_1_The_Road/Chapter 2.md', 'Folder two.\n');
  assert.deepEqual(listed(await it.run()), ['both: Chapter 2 [both folder app]', 'folder: Chapter 1 [folder app both]']);
  await it.choose({ 'Chapter 1': 'app', 'Chapter 2': 'folder' });
  assert.equal(it.text('Chapter 2'), 'Folder two.');
  assert.ok(it.versions('Chapter 2').some(([reason, words]) => reason === 'folder' && words === 'Edited in the app.'));
  assert.deepEqual((await it.run()).entries, []);
  put(it.root, 'Book_1_The_Road/Chapter 1.md', 'Folder one again.\n');
  assert.deepEqual(listed(await it.run()), ['both: Chapter 1 [both folder app]']);
});

test('an import from before 3.11: a changed file of several chapters can only be kept beside yours', async () => {
  const it = await fromBefore(MANUSCRIPT);
  // Only its time changed, so every chapter is still in the book word for word.
  put(it.root, 'Book_1_The_Road/Manuscript.md', MANUSCRIPT['Book_1_The_Road/Manuscript.md']);
  assert.deepEqual((await it.run()).entries, []);
  put(it.root, 'Book_1_The_Road/Manuscript.md', manuscript('New mill.', 'Words of the ford.'));
  const [entry] = (await it.run()).entries;
  assert.deepEqual([entry.group, entry.choices, entry.what], ['both', ['both', 'app'], 'A file that made 3 chapters']);
  await it.choose({ 'Manuscript.md': 'both' });
  assert.equal(it.text('The Mill'), 'Words of the mill.');
  assert.equal(it.text('The Mill (from the folder)'), 'New mill.');
  assert.deepEqual((await it.run()).entries, []);
});
