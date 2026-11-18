'use strict';
// The suite half of 3.9: the installed list, the Apps list, a status line and facts for linked apps, and publishing. A
// second AppLink plays RT Markdown Reader, so the real wire format is in use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppLink, call } = require('../src/main/app-link');
const { Inbox } = require('../src/main/inbox');
const { launchInstalled, launchPathFor, readInstalled, removeInstalled, writeInstalled } = require('../src/main/installed');
const { Linking } = require('../src/main/linking');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { cleanSettings } = require('../src/shared/themes');

const fakeVault = () => ({
  available: () => true,
  seal: (text) => Buffer.from(text),
  open: (data) => Buffer.from(data).toString(),
});

function setUp(t, { on = true, launchPath = null, startApp } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-suite-'));
  const folder = path.join(dir, 'shared');
  const tempDir = path.join(dir, 'temp');
  fs.mkdirSync(tempDir);
  const workspace = new Workspace(new Library(path.join(dir, 'library')));
  const settings = { values: cleanSettings({ appLink: on }), save(changes) { this.values = cleanSettings({ ...this.values, ...changes }); return this.values; } };
  const previous = process.env.NMR_LINK_DIR;
  process.env.NMR_LINK_DIR = folder;
  const linking = new Linking({
    workspace, settings, vault: fakeVault(), inbox: new Inbox(), root: path.join(dir, 'library'), tempDir, home: dir, dataDir: dir,
    version: '3.9.0', ask: async () => true, places: () => [], launchPath, ...(startApp ? { startApp } : {}),
  });
  const peers = [];
  t.after(async () => {
    for (const peer of peers) await peer.stop();
    await linking.close();
    workspace.closeProject();
    if (previous === undefined) delete process.env.NMR_LINK_DIR;
    else process.env.NMR_LINK_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const peer = async () => {
    let links = {};
    const documents = [];
    fs.mkdirSync(path.join(dir, 'reader'), { recursive: true });
    const app = new AppLink({
      folder, dataDir: path.join(dir, 'reader'), version: '3.11.0', id: 'rt-markdown-reader', name: 'RT Markdown Reader',
      load: () => ({ ...links }), save: (saved) => { links = saved; }, ask: async () => true, open: async (document) => documents.push(document),
      status: () => ({ state: 'open', line: 'Reading “Notes”' }),
    });
    await app.start();
    peers.push(app);
    return { app, documents, links: () => links };
  };
  return { dir, folder, workspace, settings, linking, peer };
}

const program = (dir, name = 'rt-markdown-reader') => {
  const file = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
  fs.writeFileSync(file, '');
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
  return file;
};

// The installed list

test('an app says it’s installed, and the file holds no secrets and only changes when it needs to', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const launch = program(dir);
  assert.equal(writeInstalled(dir, { id: 'rt-press', name: 'RT Press', version: '1.0.0', launch }), true);
  const file = path.join(dir, 'installed', 'rt-press.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { id: 'rt-press', name: 'RT Press', version: '1.0.0', launch, protocol: 1 });
  const before = fs.statSync(file).mtimeMs;
  writeInstalled(dir, { id: 'rt-press', name: 'RT Press', version: '1.0.0', launch });
  assert.equal(fs.statSync(file).mtimeMs, before, 'unchanged, so not written again');
  writeInstalled(dir, { id: 'rt-press', name: 'RT Press', version: '1.1.0', launch });
  assert.equal(readInstalled(dir)[0].version, '1.1.0', 'an update is written');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'installed')), ['rt-press.json'], 'no temporary file is left');
  assert.equal(writeInstalled(dir, { id: '../evil', name: 'x', version: '1', launch }), false);
  assert.equal(writeInstalled(dir, { id: 'rt-press', name: 'x', version: '1', launch: 'relative/path' }), false);
  removeInstalled(dir, 'rt-press');
  assert.deepEqual(readInstalled(dir), []);
});

test('a file for an app that’s gone is cleared away, and a bad file is ignored', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = program(dir, 'rt-press');
  writeInstalled(dir, { id: 'rt-press', name: 'RT Press', version: '1', launch: real });
  writeInstalled(dir, { id: 'rt-audio-studio', name: 'RT Audio Studio', version: '1', launch: path.join(dir, 'uninstalled') });
  const folder = path.join(dir, 'installed');
  fs.writeFileSync(path.join(folder, 'garbage.json'), '{ not json');
  fs.writeFileSync(path.join(folder, 'rt-author-desk.json'), JSON.stringify({ protocol: 1, id: 'someone-else', launch: real }));
  fs.writeFileSync(path.join(folder, 'rt-future.json'), JSON.stringify({ protocol: 2, id: 'rt-future', launch: real }));
  assert.deepEqual(readInstalled(dir).map((item) => item.id), ['rt-press']);
  assert.equal(fs.existsSync(path.join(folder, 'rt-audio-studio.json')), false, 'the stale one is deleted');
  assert.equal(readInstalled(dir)[0].known, true);
});

test('only the suite’s own apps are started, only real programs, with no arguments and no shell', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const started = [];
  const start = (command, args, options) => {
    started.push({ command, args, options });
    return { unref() {} };
  };
  const real = program(dir, 'rt-press');
  launchInstalled({ id: 'rt-press', name: 'RT Press', launch: real, known: true }, { start });
  assert.deepEqual(started[0].args, []);
  assert.equal(started[0].command, real);
  assert.equal(started[0].options.shell, false);
  assert.throws(() => launchInstalled({ id: 'other', name: 'Other', launch: real, known: false }, { start }), /only starts the Recon Towers apps/);
  assert.throws(() => launchInstalled({ id: 'rt-press', name: 'RT Press', launch: path.join(dir, 'gone'), known: true }, { start }), /can’t be found/);
  assert.throws(() => launchInstalled({ id: 'rt-press', name: 'RT Press', launch: dir, known: true }, { start }), /can’t be found/, 'a folder is not a program');
  if (process.platform !== 'win32') {
    const plain = path.join(dir, 'notes.txt');
    fs.writeFileSync(plain, '');
    assert.throws(() => launchInstalled({ id: 'rt-press', name: 'RT Press', launch: plain, known: true }, { start }), /can’t be found/, 'a file that can’t run');
  }
  assert.equal(started.length, 1);
  const bundle = path.join(dir, 'RT Press.app');
  fs.mkdirSync(bundle);
  launchInstalled({ id: 'rt-press', name: 'RT Press', launch: bundle, known: true }, { start, platform: 'darwin' });
  assert.deepEqual([started[1].command, started[1].args], ['open', ['-a', bundle]], 'a Mac app is opened as an app');
});

test('the start path is the .app on a Mac and the AppImage when there is one', () => {
  assert.equal(launchPathFor({ execPath: '/Applications/RT Story Tracker.app/Contents/MacOS/RT Story Tracker', platform: 'darwin' }), '/Applications/RT Story Tracker.app');
  assert.equal(launchPathFor({ execPath: '/tmp/.mount_x/app', appImage: '/home/a/RTStoryTracker.AppImage', platform: 'linux' }), '/home/a/RTStoryTracker.AppImage');
  assert.equal(launchPathFor({ execPath: 'C:\\Programs\\RT Story Tracker.exe', platform: 'win32' }), 'C:\\Programs\\RT Story Tracker.exe');
});

test('this app writes its own file when it’s an installed copy, and not when it’s run from the source', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = setUp(t, { launchPath: null });
  assert.equal(source.linking.registerInstalled(), false);
  assert.equal(fs.existsSync(path.join(source.folder, 'installed')), false);
  const installed = setUp(t, { launchPath: program(dir, 'rt-story-tracker'), on: false });
  assert.equal(installed.linking.registerInstalled(), true, 'written even with App Link off, since it connects to nothing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed.folder, 'installed', 'rt-story-tracker.json'), 'utf8')).version, '3.9.0');
});

// The Apps list

test('the Apps list joins installed, running and linked, and finding an app never links it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const space = setUp(t);
  await space.linking.apply();
  writeInstalled(space.folder, { id: 'rt-press', name: 'RT Press', version: '1.0.0', launch: program(dir, 'rt-press') });
  writeInstalled(space.folder, { id: 'rt-story-tracker', name: 'Me', version: '9', launch: program(dir, 'rt-story-tracker') });
  const { links } = await space.peer();
  const apps = (await space.linking.status()).apps;
  assert.deepEqual(apps.map((app) => app.id), ['rt-markdown-reader', 'rt-press'], 'this app isn’t listed to itself');
  const reader = apps[0];
  assert.deepEqual([reader.running, reader.linked, reader.installed, reader.canOpen], [true, false, false, false]);
  const press = apps[1];
  assert.deepEqual([press.running, press.linked, press.installed, press.canOpen, press.version], [false, false, true, true, '1.0.0']);
  assert.deepEqual(links(), {}, 'nothing was linked by looking');
  await space.linking.pair('rt-markdown-reader');
  const after = (await space.linking.status()).apps.find((app) => app.id === 'rt-markdown-reader');
  assert.equal(after.linked, true);
  assert.equal(after.line, 'Reading “Notes”', 'a linked app that’s running says what it’s doing');
});

test('with App Link off, installed apps are still listed but nothing is running or asked', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const space = setUp(t, { on: false });
  writeInstalled(space.folder, { id: 'rt-press', name: 'RT Press', version: '1.0.0', launch: program(dir, 'rt-press') });
  const status = await space.linking.status();
  assert.equal(status.on, false);
  assert.deepEqual(status.apps.map((app) => [app.id, app.running, app.canOpen]), [['rt-press', false, true]]);
});

test('Open starts an installed app that isn’t running, and nothing else', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const started = [];
  const space = setUp(t, { startApp: (entry) => started.push(entry.id) });
  await space.linking.apply();
  writeInstalled(space.folder, { id: 'rt-press', name: 'RT Press', version: '1', launch: program(dir, 'rt-press') });
  writeInstalled(space.folder, { id: 'unknown-thing', name: 'Unknown', version: '1', launch: program(dir, 'unknown-thing') });
  await space.linking.openApp('rt-press');
  assert.deepEqual(started, ['rt-press']);
  await space.linking.openApp('unknown-thing');
  assert.deepEqual(started, ['rt-press', 'unknown-thing'], 'the check on which apps may start is in the launcher, which refuses');
  await assert.rejects(() => space.linking.openApp('not-installed'), /isn’t installed/);
  await assert.rejects(() => space.linking.openApp('../../x'), /isn’t known/);
  await space.peer();
  writeInstalled(space.folder, { id: 'rt-markdown-reader', name: 'RT Markdown Reader', version: '1', launch: program(dir) });
  await space.linking.openApp('rt-markdown-reader');
  assert.deepEqual(started, ['rt-press', 'unknown-thing'], 'an app that’s already running isn’t started again');
  const apps = (await space.linking.status()).apps;
  assert.equal(apps.find((app) => app.id === 'unknown-thing').canOpen, false);
});

// Status

function openProject(space) {
  const { outline } = space.workspace.createProject('Salt Road');
  const chapter = outline.children[0].children[0];
  space.workspace.saveChapter({ id: chapter.id, title: 'The Ledger', body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Secret words here.' }] }] }) });
  return { chapter, book: outline.children[0] };
}

async function asLinked(space) {
  await space.linking.apply();
  const peer = await space.peer();
  await space.linking.pair('rt-markdown-reader');
  const key = peer.links()['rt-story-tracker'].key;
  const endpoint = space.linking.server.file ? JSON.parse(fs.readFileSync(space.linking.server.file, 'utf8')).endpoint : null;
  const ask = (method, params = {}) => call(endpoint, method, { app: 'rt-markdown-reader', key, ...params });
  return { peer, ask, endpoint };
}

test('status says what’s open, and never any writing', async (t) => {
  const space = setUp(t);
  const { ask } = await asLinked(space);
  assert.deepEqual(await ask('status'), { state: 'idle' }, 'nothing open');
  const { chapter } = openProject(space);
  assert.deepEqual(await ask('status'), { state: 'open', line: 'Open: “Salt Road”' });
  space.workspace.setActivity({ mode: 'write', chapterId: chapter.id });
  assert.deepEqual(await ask('status'), { state: 'open', line: 'Editing “The Ledger” in “Salt Road”' });
  space.workspace.setActivity({ mode: 'records', chapterId: chapter.id });
  assert.deepEqual(await ask('status'), { state: 'open', line: 'Looking at records in “Salt Road”' });
  space.workspace.busy = 1;
  assert.deepEqual(await ask('status'), { state: 'busy', line: 'Busy with a long job' });
  space.workspace.busy = 0;
  assert.ok(!JSON.stringify(await ask('status')).includes('Secret'));
  space.workspace.trashItem(chapter.id);
  space.workspace.setActivity({ mode: 'write', chapterId: chapter.id });
  assert.equal((await ask('status')).line, 'Open: “Salt Road”', 'a chapter in the Trash isn’t named');
});

test('a project with a password says nothing, the same as no project at all', async (t) => {
  const space = setUp(t);
  const { ask } = await asLinked(space);
  openProject(space);
  space.workspace.locked = true;
  assert.deepEqual(await ask('status'), { state: 'idle' });
  await assert.rejects(() => ask('get_fact', { fact: 'book.progress' }), /No project is open/);
  space.workspace.closeProject();
  await assert.rejects(() => ask('get_fact', { fact: 'book.progress' }), /No project is open/, 'and the refusal is the same when there is none');
});

test('only a linked app can ask, and what it can ask for is listed', async (t) => {
  const space = setUp(t);
  const { ask, endpoint } = await asLinked(space);
  for (const method of ['status', 'facts', 'get_fact']) {
    await assert.rejects(() => call(endpoint, method, { app: 'rt-markdown-reader', key: 'wrong', fact: 'book.progress' }), /isn’t linked/);
    await assert.rejects(() => call(endpoint, method, { fact: 'book.progress' }), /isn’t linked/);
  }
  assert.deepEqual(await ask('facts'), { facts: ['book.progress'] });
  await assert.rejects(() => ask('get_fact', { fact: 'secret.chapters' }), /doesn’t have that/);
});

test('a book’s progress is words and counts, by book, and nothing else', async (t) => {
  const space = setUp(t);
  const { ask } = await asLinked(space);
  const { book } = openProject(space);
  space.workspace.addItem({ kind: 'chapter', parentId: book.id, title: 'Two' });
  space.workspace.addItem({ kind: 'book', parentId: space.workspace.outline().id, title: 'Second Book' });
  const answer = await ask('get_fact', { fact: 'book.progress' });
  assert.deepEqual(answer, { fact: 'book.progress', value: { project: 'Salt Road', books: [{ title: 'Salt Road', words: 3, chapters: 2 }, { title: 'Second Book', words: 0, chapters: 0 }] } });
  assert.ok(!JSON.stringify(answer).includes('Secret'));
});

test('this app can ask another for status and for a fact', async (t) => {
  const space = setUp(t);
  await space.linking.apply();
  const peer = await space.peer();
  peer.app.facts = { list: () => ['book.published'], get: (name, params) => ({ name, params }) };
  await space.linking.pair('rt-markdown-reader');
  assert.deepEqual(await space.linking.server.statusOf('rt-markdown-reader'), { state: 'open', line: 'Reading “Notes”' });
  assert.deepEqual(await space.linking.server.askFact('rt-markdown-reader', 'book.published', { title: 'X' }), { name: 'book.published', params: { title: 'X' } });
  await assert.rejects(() => space.linking.server.askFact('rt-markdown-reader', 'nope'), /doesn’t have that/);
  await assert.rejects(() => space.linking.server.statusOf('rt-press'), /isn’t linked/);
});

test('what the window reports is checked before it’s kept', () => {
  const space = new Workspace(new Library(fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-act-'))));
  const { outline } = space.createProject('P');
  const chapter = outline.children[0].children[0].id;
  assert.throws(() => space.setActivity({ mode: 'elsewhere' }), /isn’t somewhere/);
  space.setActivity({ mode: 'write', chapterId: 'made-up' });
  assert.equal(space.activity.chapterId, null);
  space.setActivity({ mode: 'write', chapterId: outline.children[0].id });
  assert.equal(space.activity.chapterId, null, 'only a chapter counts');
  space.setActivity({ mode: 'write', chapterId: chapter });
  assert.equal(space.activity.chapterId, chapter);
  space.closeProject();
  assert.deepEqual(space.activity, { mode: 'write', chapterId: null });
});

// Publishing

test('a chapter sent to publish carries the hint, and an app that doesn’t know it still gets the document', async (t) => {
  const space = setUp(t);
  await space.linking.apply();
  const { chapter } = openProject(space);
  const peer = await space.peer();
  await space.linking.pair('rt-markdown-reader');
  await space.linking.openInReader({ scope: 'chapter', id: chapter.id, publish: true });
  assert.equal(peer.documents[0].intent, 'publish');
  assert.match(peer.documents[0].text, /Secret words here/);
  await space.linking.openInReader({ scope: 'chapter', id: chapter.id });
  assert.equal(peer.documents[1].intent, undefined, 'a plain open has no hint');
  space.workspace.locked = true;
  await assert.rejects(() => space.linking.openInReader({ scope: 'chapter', id: chapter.id, publish: true }), /never sent/);
});
