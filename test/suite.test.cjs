'use strict';
// The suite half of 3.9: the installed list, the Apps list, a status line and facts for linked apps, and publishing. A
// second AppLink plays RT Markdown Reader, so the real wire format is in use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { AppLink, call, endpointFor } = require('../src/main/app-link');
const { Versions } = require('../src/main/versions');
const { Inbox } = require('../src/main/inbox');
const { fromInstaller, launchInstalled, launchPathFor, readInstalled, removeInstalled, writeInstalled } = require('../src/main/installed');
const { Linking } = require('../src/main/linking');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { cleanSettings } = require('../src/shared/themes');

const fakeVault = () => ({
  available: () => true,
  seal: (text) => Buffer.from(text),
  open: (data) => Buffer.from(data).toString(),
});

function setUp(t, { on = true, launchPath = null, startApp, versions, platform } = {}) {
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
    version: '3.9.0', ask: async () => true, places: () => [], launchPath, ...(startApp ? { startApp } : {}), ...(versions ? { versions } : {}), ...(platform ? { platform } : {}),
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
  fs.writeFileSync(path.join(folder, 'rt-nonsense.json'), JSON.stringify({ protocol: 0, id: 'rt-nonsense', launch: real }));
  fs.writeFileSync(path.join(folder, 'rt-text.json'), JSON.stringify({ protocol: 'two', id: 'rt-text', launch: real }));
  assert.deepEqual(readInstalled(dir).map((item) => [item.id, item.protocol]).sort(), [['rt-future', 2], ['rt-press', 1]], 'a newer protocol is listed, so it can be told it needs an update');
  assert.equal(fs.existsSync(path.join(folder, 'rt-audio-studio.json')), false, 'the stale one is deleted');
  assert.equal(readInstalled(dir).find((item) => item.id === 'rt-press').known, true);
  assert.equal(readInstalled(dir).find((item) => item.id === 'rt-future').known, false);
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
  assert.deepEqual(apps.map((app) => app.id), ['rt-markdown-reader', 'rt-author-desk', 'rt-press', 'rt-audio-studio', 'recon-browser'], 'every app in the suite but this one, in the shared order');
  const reader = apps[0];
  assert.deepEqual([reader.running, reader.linked, reader.installed, reader.canOpen, reader.state], [true, false, false, false, 'found']);
  const press = apps.find((app) => app.id === 'rt-press');
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
  assert.deepEqual(status.apps.filter((app) => app.installed).map((app) => [app.id, app.running, app.canOpen]), [['rt-press', false, true]]);
  assert.equal(status.apps.every((app) => !app.running), true);
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

// The Apps status, shared by every app

const { DOTS, SUITE_APPS, SUITE_IDS, STATES, UPDATE, dotOf, dotWords, isNewer, linkability, stateOf, updateButton, updateLine } = require('../src/shared/suite-apps');

test('the shared list has every app once, with a name, a line and an https page, and is the one list the launcher trusts', () => {
  assert.deepEqual(SUITE_IDS, ['rt-markdown-reader', 'rt-story-tracker', 'rt-author-desk', 'rt-press', 'rt-audio-studio', 'recon-browser']);
  assert.equal(new Set(SUITE_IDS).size, SUITE_APPS.length);
  for (const app of SUITE_APPS) {
    assert.match(app.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.ok(app.name && app.about, `${app.id} has a name and a line`);
    assert.match(app.page, /^https:\/\/recontowers\.com\//, `${app.id} opens a page on the store`);
  }
  assert.equal(require('../src/main/installed').SUITE_IDS, SUITE_IDS, 'one list, not a second copy');
});

test('an app is in one of four states, in words, and the words are the same everywhere', () => {
  assert.equal(stateOf({ linked: true, running: true, installed: true }), 'linked');
  assert.equal(stateOf({ linked: true }), 'linked', 'a link outlasts the app being closed');
  assert.equal(stateOf({ running: true }), 'found');
  assert.equal(stateOf({ running: true, installed: true }), 'found');
  assert.equal(stateOf({ installed: true }), 'installed');
  assert.equal(stateOf({}), 'missing');
  assert.deepEqual(Object.values(STATES).map((state) => [state.words, state.button]), [['Linked', 'Open'], ['Found, not linked', 'Link'], ['Installed, not running', 'Open'], ['Not installed', 'Get it']]);
});

test('the dot is green, amber, grey or off, and each has words', () => {
  assert.equal(dotOf({ on: false, apps: [{ linked: true }] }), 'off', 'off wins, since nothing can be found or asked');
  assert.equal(dotOf({ on: true, apps: [{ installed: true }, { linked: true }] }), 'green');
  assert.equal(dotOf({ on: true, apps: [{ installed: true }] }), 'amber');
  assert.equal(dotOf({ on: true, apps: [{ running: true }] }), 'amber');
  assert.equal(dotOf({ on: true, apps: [{}, {}] }), 'grey');
  assert.equal(dotOf({ on: true, apps: [] }), 'grey');
  assert.deepEqual(Object.keys(DOTS).sort(), ['amber', 'green', 'grey', 'off']);
  for (const dot of Object.keys(DOTS)) assert.match(dotWords(dot), /^Recon Towers apps: .+/);
  assert.equal(new Set(Object.values(DOTS)).size, 4, 'no two dots say the same thing');
});

test('the Apps list gives each app its state, and Get it opens only a page from the shared list', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const space = setUp(t);
  const opened = [];
  space.linking.openPage = (page) => opened.push(page);
  await space.linking.apply();
  writeInstalled(space.folder, { id: 'rt-press', name: 'RT Press', version: '1', launch: program(dir, 'rt-press') });
  await space.peer();
  const states = () => space.linking.status().then(({ apps }) => Object.fromEntries(apps.map((app) => [app.id, app.state])));
  assert.deepEqual(await states(), { 'rt-markdown-reader': 'found', 'rt-author-desk': 'missing', 'rt-press': 'installed', 'rt-audio-studio': 'missing', 'recon-browser': 'missing' });
  await space.linking.pair('rt-markdown-reader');
  assert.equal((await states())['rt-markdown-reader'], 'linked');
  const apps = (await space.linking.status()).apps;
  assert.deepEqual(apps.map((app) => [app.id, app.canGet]), [['rt-markdown-reader', false], ['rt-author-desk', true], ['rt-press', false], ['rt-audio-studio', true], ['recon-browser', true]]);

  space.linking.getApp('rt-author-desk');
  assert.deepEqual(opened, [SUITE_APPS.find((app) => app.id === 'rt-author-desk').page]);
  for (const bad of ['https://evil.example/', 'rt-story-tracker', '../x', '', undefined, { page: 'https://evil.example/' }]) {
    assert.throws(() => space.linking.getApp(bad), /isn’t known/);
  }
  assert.equal(opened.length, 1, 'nothing else was opened');

  // A program that merely left a file behind is listed, never started, and has nothing to get.
  writeInstalled(space.folder, { id: 'unknown-thing', name: 'Unknown', version: '1', launch: program(dir, 'unknown-thing') });
  const odd = (await space.linking.status()).apps.find((app) => app.id === 'unknown-thing');
  assert.deepEqual([odd.state, odd.canOpen, odd.canGet], ['installed', false, false]);
});

test('an installed file whose program is gone doesn’t count as installed, and looking never links', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const space = setUp(t);
  const gone = program(dir, 'rt-press');
  writeInstalled(space.folder, { id: 'rt-press', name: 'RT Press', version: '1', launch: gone });
  fs.rmSync(gone);
  const press = (await space.linking.status()).apps.find((app) => app.id === 'rt-press');
  assert.deepEqual([press.installed, press.state], [false, 'missing']);
  assert.equal(fs.existsSync(path.join(space.folder, 'installed', 'rt-press.json')), false, 'and the stale file is removed');
  assert.deepEqual(space.linking.load(), {}, 'nothing linked');
});

test('only linked apps are asked what they are doing', async (t) => {
  const space = setUp(t);
  await space.linking.apply();
  const { app } = await space.peer();
  const asked = [];
  const original = space.linking.server.statusOf.bind(space.linking.server);
  space.linking.server.statusOf = (id) => { asked.push(id); return original(id); };
  const before = (await space.linking.status()).apps;
  assert.deepEqual(asked, [], 'found but not linked: not asked');
  assert.equal(before.find((item) => item.id === 'rt-markdown-reader').line, '');
  assert.equal(app.running, true);
  await space.linking.pair('rt-markdown-reader');
  asked.length = 0;
  await space.linking.status();
  assert.deepEqual(asked, ['rt-markdown-reader'], 'linked: asked, once, when the list was looked at');
});

// Updates and compatibility

const latestFile = (apps) => new Versions({ fetchIt: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ apps }) }) });

// An app that answers `hello` with whatever it's told to, on its own socket, so a protocol this app doesn't speak can be tried.
async function fakeApp(t, space, { id = 'rt-press', name = 'RT Press', hello }) {
  const dir = path.join(space.dir, `fake-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const endpoint = endpointFor(dir);
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      const request = JSON.parse(chunk.split('\n')[0]);
      sock.write(`${JSON.stringify({ id: request.id, result: request.method === 'hello' ? { app: id, name, ...hello } : {} })}\n`);
    });
  });
  await new Promise((resolve) => { server.listen(endpoint, resolve); });
  t.after(() => server.close());
  fs.mkdirSync(space.folder, { recursive: true });
  fs.writeFileSync(path.join(space.folder, `${id}.json`), JSON.stringify({ protocol: hello.protocol, id, name, version: hello.version, endpoint }));
}

test('the wording is the same in every app, and a version is only ever "newer" when both are plain version numbers', () => {
  assert.deepEqual([UPDATE.available, UPDATE.needs, UPDATE.unreachable], ['Update available', 'Needs an update to link', 'Couldn’t check for updates']);
  assert.deepEqual([UPDATE.open, UPDATE.download], ['Open to update', 'Download']);
  assert.equal(updateLine({ have: '3.7.1', latest: '3.9.0' }), 'you have 3.7.1, the latest is 3.9.0');
  assert.equal(isNewer('3.9.0', '3.7.1'), true);
  assert.equal(isNewer('3.10.0', '3.9.9'), true, 'numbers, not text');
  assert.equal(isNewer('3.7.1', '3.7.1'), false);
  assert.equal(isNewer('3.7.0', '3.7.1'), false);
  for (const odd of ['latest', '3.7', '3.7.1-beta', '', null, undefined, '9'.repeat(50)]) {
    assert.equal(isNewer(odd, '1.0.0'), false);
    assert.equal(isNewer('9.9.9', odd), false);
  }
});

test('which button an update gets: Open for an app that updates itself, Download for the rest', () => {
  assert.equal(updateButton({ platform: 'win32', launch: 'C:/Programs/RT Press.exe', installer: true }), 'open', 'the installed Windows copy updates itself');
  assert.equal(updateButton({ platform: 'win32', launch: 'D:/Tools/RTPress-1.0.0-Portable.exe' }), 'download', 'a portable copy can’t');
  assert.equal(updateButton({ platform: 'win32' }), 'download', 'nor is it taken for granted when where it runs from isn’t known');
  assert.equal(updateButton({ platform: 'linux', launch: '/home/a/RTPress.AppImage' }), 'open');
  assert.equal(updateButton({ platform: 'linux', launch: '/usr/bin/rt-press' }), 'download');
  assert.equal(updateButton({ platform: 'darwin', launch: '/Applications/RT Press.app' }), 'download');
  assert.equal(updateButton({ platform: 'win32', launch: 'C:/x.exe', installer: true, running: true }), '', 'an app that’s open updates itself, so there is nothing to press');
  assert.equal(updateButton({ platform: 'win32', launch: 'C:/x.exe', running: true }), 'download', 'but an open portable copy still needs the download');
});

test('a Windows copy counts as installed only with the installer’s uninstaller beside it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-kind-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const launch = program(dir, 'RT Press');
  assert.equal(fromInstaller(launch), false, 'a program on its own, as a portable or unpacked copy is');
  fs.writeFileSync(path.join(dir, 'Uninstall.txt'), '');
  fs.writeFileSync(path.join(dir, 'unins-notes.exe'), '');
  assert.equal(fromInstaller(launch), false, 'something that only looks a bit like it');
  fs.writeFileSync(path.join(dir, 'Uninstall RT Press.exe'), '');
  assert.equal(fromInstaller(launch), true);
  for (const odd of ['', undefined, path.join(dir, 'gone', 'RT Press.exe')]) assert.equal(fromInstaller(odd), false);
});

test('only the protocol and the kinds of document decide whether two apps link, never the version number', () => {
  const mine = { protocol: 1, minProtocol: 1, accepts: ['markdown', 'text'] };
  assert.deepEqual(linkability({ mine, theirs: { protocol: 1, accepts: ['markdown'] } }), { ok: true });
  assert.deepEqual(linkability({ mine, theirs: { protocol: 1, version: '0.0.1', accepts: ['markdown'] } }), { ok: true }, 'a very old release links fine');
  assert.deepEqual(linkability({ mine, theirs: { protocol: 1, version: '99.0.0' } }), { ok: true }, 'and so does a very new one');
  assert.deepEqual(linkability({ mine, theirs: { protocol: 2, minProtocol: 1 } }), { ok: true }, 'a newer protocol that still accepts this one');
  assert.deepEqual(linkability({ mine, theirs: { protocol: 2, minProtocol: 2 } }), { ok: false, who: 'us' }, 'this app is the old one');
  assert.deepEqual(linkability({ mine: { ...mine, protocol: 2, minProtocol: 2 }, theirs: { protocol: 1 } }), { ok: false, who: 'them' }, 'the other app is the old one');
  assert.equal(linkability({ mine, theirs: {} }).ok, false, 'no protocol at all');
  assert.equal(linkability({ mine, theirs: { protocol: 1, accepts: ['audio'] } }).ok, false, 'nothing in common to send');
  assert.equal(linkability({ mine, theirs: { protocol: 1, accepts: [] } }).ok, true, 'an app that sends and accepts nothing, such as a browser, still links');
});

test('a newer version shows the nudge, with the right button, and never blocks a link', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const versions = latestFile({
    'rt-markdown-reader': { version: '3.12.0', url: 'https://recontowers.com/apps/rt-markdown-reader/' },
    'rt-press': { version: '1.2.0' },
    'rt-audio-studio': { version: '1.0.0' },
  });
  const space = setUp(t, { versions, platform: 'win32' });
  await space.linking.apply();
  // RT Press as the Windows installer leaves it, with its uninstaller beside it.
  const installed = path.join(dir, 'installed-press');
  fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed, 'Uninstall RT Press.exe'), '');
  writeInstalled(space.folder, { id: 'rt-press', name: 'RT Press', version: '1.0.0', launch: program(installed, 'rt-press') });
  writeInstalled(space.folder, { id: 'rt-audio-studio', name: 'RT Audio Studio', version: '1.0.0', launch: program(dir, 'rt-audio-studio') });
  await space.peer();
  const find = async (id) => (await space.linking.status()).apps.find((app) => app.id === id);

  const reader = await find('rt-markdown-reader');
  assert.deepEqual([reader.version, reader.update.have, reader.update.latest, reader.update.line], ['3.11.0', '3.11.0', '3.12.0', 'you have 3.11.0, the latest is 3.12.0']);
  assert.equal(reader.update.action, 'download', 'it’s open and nothing says how it was installed, so the download is offered, which suits any copy');
  assert.equal(reader.canLink, true, 'and the nudge doesn’t stop the link');
  const press = await find('rt-press');
  assert.deepEqual([press.update.line, press.update.action, press.needsUpdate], ['you have 1.0.0, the latest is 1.2.0', 'open', '']);
  assert.equal((await find('rt-audio-studio')).update, null, 'the same version is no nudge');
  assert.equal((await find('rt-author-desk')).update, null, 'and an app that isn’t installed has nothing to update');

  // The same app as a portable copy has no uninstaller beside it.
  fs.rmSync(path.join(installed, 'Uninstall RT Press.exe'));
  assert.equal((await find('rt-press')).update.action, 'download');
  fs.writeFileSync(path.join(installed, 'Uninstall RT Press.exe'), '');

  space.linking.platform = 'darwin';
  assert.equal((await find('rt-press')).update.action, 'download');

  await space.linking.pair('rt-markdown-reader');
  const linked = await find('rt-markdown-reader');
  assert.deepEqual([linked.state, linked.linked, linked.update.latest], ['linked', true, '3.12.0'], 'linked, with the nudge still showing');
  assert.equal((await space.linking.status()).updates, 'ok');
});

test('Download opens the page the site gave for that app, and otherwise the one in the shared list', async (t) => {
  const space = setUp(t, { versions: latestFile({ 'rt-press': { version: '1.2.0', url: 'https://recontowers.com/apps/rt-press/' } }) });
  const opened = [];
  space.linking.openPage = (page) => opened.push(page);
  await space.linking.status();
  space.linking.getApp('rt-press');
  space.linking.getApp('rt-author-desk');
  assert.deepEqual(opened, ['https://recontowers.com/apps/rt-press/', SUITE_APPS.find((app) => app.id === 'rt-author-desk').page]);
});

test('an app on a protocol this one doesn’t speak is found, says it needs an update, and can’t be linked', async (t) => {
  const space = setUp(t, { versions: latestFile({}) });
  await space.linking.apply();
  await fakeApp(t, space, { hello: { protocol: 2, minProtocol: 2, version: '2.0.0', accepts: ['markdown'] } });
  const press = (await space.linking.status()).apps.find((app) => app.id === 'rt-press');
  assert.deepEqual([press.state, press.running, press.needsUpdate, press.canLink], ['found', true, 'us', false]);
  await assert.rejects(() => space.linking.pair('rt-press'), /Needs an update to link/);
  assert.deepEqual(space.linking.load(), {}, 'and nothing was linked');
});

test('the kinds an app lists never decide whether it can be linked: the protocol does', async (t) => {
  for (const kinds of [undefined, [], ['audio'], ['research']]) {
    assert.deepEqual(linkability({ mine: { protocol: 1, minProtocol: 1, accepts: ['markdown', 'text'], kinds: ['research'] }, theirs: { protocol: 1, accepts: ['markdown'], kinds } }), { ok: true }, String(kinds));
  }
  assert.equal(linkability({ mine: { protocol: 1, minProtocol: 1, kinds: ['research'] }, theirs: { protocol: 2, minProtocol: 2, kinds: ['research'] } }).ok, false, 'the same kinds don’t make up for the protocol');
  const space = setUp(t, { versions: latestFile({}) });
  await space.linking.apply();
  await fakeApp(t, space, { hello: { protocol: 1, version: '1.0.0', accepts: ['markdown'], kinds: ['page', 'Bad Kind'] } });
  const press = (await space.linking.status()).apps.find((app) => app.id === 'rt-press');
  assert.deepEqual([press.kinds, press.needsUpdate, press.canLink], [['page'], '', true]);
});

test('an app that is only ahead, or only different, still links: an ordinary release never breaks a link', async (t) => {
  const space = setUp(t, { versions: latestFile({}) });
  await space.linking.apply();
  await fakeApp(t, space, { hello: { protocol: 2, minProtocol: 1, version: '9.0.0', accepts: ['markdown', 'audio'] } });
  const press = (await space.linking.status()).apps.find((app) => app.id === 'rt-press');
  assert.deepEqual([press.needsUpdate, press.canLink, press.version], ['', true, '9.0.0']);
});

test('an app that’s installed on a newer protocol, but not running, says it needs an update too', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-inst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const space = setUp(t, { versions: latestFile({}) });
  fs.mkdirSync(path.join(space.folder, 'installed'), { recursive: true });
  fs.writeFileSync(path.join(space.folder, 'installed', 'rt-press.json'), JSON.stringify({ protocol: 2, minProtocol: 2, id: 'rt-press', name: 'RT Press', version: '2.0.0', launch: program(dir, 'rt-press') }));
  const press = (await space.linking.status()).apps.find((app) => app.id === 'rt-press');
  assert.deepEqual([press.state, press.needsUpdate, press.canLink], ['installed', 'us', false]);
});

test('the answer is asked for when the panel opens, kept for a day, and asked again on Refresh; an unreachable file is said, and carried on from', async (t) => {
  let asked = 0;
  let down = false;
  const clock = { at: 10_000_000 };
  const versions = new Versions({
    now: () => clock.at,
    fetchIt: async () => {
      asked += 1;
      if (down) throw new Error('offline');
      return { ok: true, status: 200, text: async () => JSON.stringify({ apps: { 'rt-press': { version: '1.2.0' } } }) };
    },
  });
  const space = setUp(t, { versions });
  await space.linking.status();
  await space.linking.status();
  assert.equal(asked, 1, 'opening it twice in a day asks once');
  down = true;
  await space.linking.status({ refresh: true });
  assert.equal(asked, 2);
  const unreachable = await space.linking.status();
  assert.equal(unreachable.updates, 'unreachable');
  assert.equal(unreachable.apps.length, 5, 'and the panel carries on with everything else');
  assert.equal(asked, 2, 'a failure isn’t asked again at every click');
  const none = setUp(t);
  assert.equal((await none.linking.status()).updates, 'unavailable', 'with no file yet, nothing is said');
});

test('on start the site is asked only when App Link is on', async (t) => {
  let asked = 0;
  const versions = new Versions({ fetchIt: async () => { asked += 1; return { ok: false, status: 404, text: async () => '' }; } });
  await setUp(t, { versions, on: false }).linking.checkVersions();
  assert.equal(asked, 0);
  await setUp(t, { versions, on: true }).linking.checkVersions();
  assert.equal(asked, 1);
});
