'use strict';
// Web clips from Recon Browser: a document of kind research sent over App Link, with its source as front matter. A second
// AppLink plays Recon Browser, so the real wire format is in use. Nothing is filed by itself, nothing is fetched, and a
// locked project never has a clip written to disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { AppLink, LinkError, call } = require('../src/main/app-link');
const { readClip, sourceLine } = require('../src/main/clips');
const { Inbox } = require('../src/main/inbox');
const { writeInstalled } = require('../src/main/installed');
const { Linking } = require('../src/main/linking');
const { Security } = require('../src/main/security');
const { Library } = require('../src/main/storage/library');
const { TrustedComputer } = require('../src/main/storage/trusted');
const { Workspace } = require('../src/main/workspace');
const { cleanSettings } = require('../src/shared/themes');

const MARKER = 'ZZ-CLIP-MARKER-4417';
const PASSWORD = 'a long enough password';
const fakeVault = () => ({
  available: () => true,
  seal: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  open: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
});

const CLIP = `---
title: Medieval Aqueduct Architecture
source_url: https://www.recontowers.com/library/ancient-engineering
source_title: Ancient Civil Infrastructure
source_author: Dr. Elena Vance
source_date: 2026-04-12
accessed: 2026-11-18
category: setting
tags: [research, aqueduct, recon-browser]
---
Aqueducts relied on gravity. ${MARKER}

Source: [Ancient Civil Infrastructure](https://www.recontowers.com/library/ancient-engineering) by Dr. Elena Vance (Accessed: 2026-11-18)
`;

function setUp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-clip-'));
  const root = path.join(dir, 'library');
  const folder = path.join(dir, 'shared');
  const tempDir = path.join(dir, 'temp');
  fs.mkdirSync(tempDir);
  const workspace = new Workspace(new Library(root));
  const settings = { values: cleanSettings({ appLink: true }), save(changes) { this.values = cleanSettings({ ...this.values, ...changes }); return this.values; } };
  const inbox = new Inbox();
  const previous = process.env.NMR_LINK_DIR;
  process.env.NMR_LINK_DIR = folder;
  const linking = new Linking({ workspace, settings, vault: fakeVault(), inbox, root, tempDir, home: dir, dataDir: dir, version: '3.10.0', ask: async () => true, places: () => [] });
  const peers = [];
  t.after(async () => {
    for (const peer of peers) await peer.stop();
    await linking.close();
    workspace.closeProject();
    if (previous === undefined) delete process.env.NMR_LINK_DIR;
    else process.env.NMR_LINK_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const browser = async () => {
    let links = {};
    fs.mkdirSync(path.join(dir, 'browser'), { recursive: true });
    const app = new AppLink({
      folder, dataDir: path.join(dir, 'browser'), version: '1.3.0', id: 'recon-browser', name: 'Recon Browser',
      load: () => ({ ...links }), save: (saved) => { links = saved; }, ask: async () => true, open: async () => {},
    });
    await app.start();
    peers.push(app);
    await app.pairWith('rt-story-tracker');
    return app;
  };
  return { dir, root, folder, workspace, inbox, linking, browser };
}

const textOf = (space, chapterId) => space.workspace.loadChapter(chapterId).body;
const books = (space) => space.workspace.outline().children.filter((node) => node.kind === 'book');

// The clip as it arrives

test('a document of kind research is a clip, shown with its source, and an ordinary one is not', async (t) => {
  const space = setUp(t);
  await space.linking.apply();
  const browser = await space.browser();
  await browser.send('rt-story-tracker', { name: 'Medieval Aqueduct Architecture', text: CLIP, kind: 'research' });
  await browser.send('rt-story-tracker', { name: 'Plain.md', text: 'Just words.' });
  const [clip, plain] = space.inbox.list();
  assert.equal(clip.from, 'Recon Browser');
  assert.equal(clip.clip.line, 'Ancient Civil Infrastructure, by Dr. Elena Vance, 2026-04-12');
  assert.equal(clip.clip.category, 'setting');
  assert.deepEqual(clip.options.map((option) => option.mode), ['none'], 'a clip is one chapter');
  assert.equal(plain.clip, null);
  assert.ok(clip.words > 5);
  assert.equal(JSON.stringify(space.inbox.list()).includes(MARKER), false, 'the window is told what it is, never the words');
});

test('the front matter is read and made safe, bad front matter is ignored, and no front matter still works', () => {
  const { source, body, title } = readClip(CLIP);
  assert.equal(title, 'Medieval Aqueduct Architecture');
  assert.deepEqual(source, {
    source_url: 'https://www.recontowers.com/library/ancient-engineering',
    source_title: 'Ancient Civil Infrastructure',
    source_author: 'Dr. Elena Vance',
    source_date: '2026-04-12',
    accessed: '2026-11-18',
    category: 'setting',
    tags: ['research', 'aqueduct', 'recon-browser'],
  });
  assert.match(body, /^Aqueducts relied on gravity\./);
  assert.match(body, /\nSource: \[Ancient Civil Infrastructure\]/);

  const odd = readClip('---\nsource_url: javascript:alert(1)\nsource_title: "Quoted\u0007 Title"\nsource_date: yesterday\ncategory: nonsense\ntags:\n  - one\n  - two\n  - one\nunknown: x\n---\nBody words.');
  assert.deepEqual(odd.source, { source_title: 'Quoted Title', tags: ['one', 'two'] }, 'only a web address, a real date and a known category survive');
  assert.equal(readClip('---\nsource_url: file:///etc/passwd\n---\nx').source.source_url, undefined);
  assert.equal(readClip('---\nsource_url: https://user:pass@example.com/\n---\nx').source.source_url, undefined, 'no passwords in an address');

  const unclosed = readClip('---\nsource_title: Never closed\n\nThe words are still here.');
  assert.deepEqual(unclosed.source, {});
  assert.match(unclosed.body, /The words are still here\./);
  const none = readClip('Only words, no front matter.');
  assert.deepEqual(none.source, {});
  assert.equal(none.body, 'Only words, no front matter.');
  assert.equal(sourceLine(none.source), '');
  assert.deepEqual(readClip('---\r\nsource_title: Windows\r\n---\r\nWords.').source, { source_title: 'Windows' });
});

test('a clip with no front matter is still a clip', () => {
  const inbox = new Inbox();
  inbox.take({ from: 'Recon Browser', name: 'Just a quote', text: 'Words only.', kind: 'research' });
  const [item] = inbox.list();
  assert.deepEqual([item.name, item.clip.line, item.words], ['Just a quote', '', 2]);
});

test('an unknown kind is a plain document, as it was before kinds', () => {
  const inbox = new Inbox();
  inbox.take({ from: 'x', name: 'a.md', text: 'Words.', kind: 'something-else' });
  assert.equal(inbox.list()[0].clip, null);
});

// Where it lands

test('a clip is added as one chapter in Research, made if missing, with the source at the top', async (t) => {
  const space = setUp(t);
  space.workspace.createProject('Salt Road');
  space.inbox.take({ from: 'Recon Browser', name: 'Medieval Aqueduct Architecture', text: CLIP, kind: 'research' });
  const [item] = space.inbox.list();
  const result = await space.inbox.add(space.workspace, { id: item.id, bookId: null, mode: 'none' });
  const research = books(space).find((book) => book.title === 'Research');
  assert.ok(research, 'the Research book was made');
  assert.equal(result.bookId, research.id);
  assert.equal(result.chapters, 1);
  const chapter = space.workspace.outline().children.find((book) => book.id === research.id).children[0];
  assert.equal(chapter.title, 'Medieval Aqueduct Architecture');
  const body = JSON.parse(textOf(space, chapter.id));
  const lines = body.content.slice(0, 7).map((block) => block.content[0].text);
  assert.deepEqual(lines, [
    'source_url: https://www.recontowers.com/library/ancient-engineering',
    'source_title: Ancient Civil Infrastructure',
    'source_author: Dr. Elena Vance',
    'source_date: 2026-04-12',
    'accessed: 2026-11-18',
    'category: setting',
    'tags: research, aqueduct, recon-browser',
  ]);
  assert.match(JSON.stringify(body), new RegExp(MARKER));
  assert.match(JSON.stringify(body), /Source: .*Ancient Civil Infrastructure/, 'the source line at the end is kept');
  assert.equal(JSON.stringify(body).includes('---'), false, 'the fence itself is not left in the text');
  assert.deepEqual(space.inbox.list(), []);

  // The next clip goes into the same book, even with another capitalisation, and the author can pick another book.
  space.workspace.rename({ id: research.id, title: 'research' });
  space.inbox.take({ from: 'Recon Browser', name: 'Second clip', text: 'More words.', kind: 'research' });
  const second = await space.inbox.add(space.workspace, { id: space.inbox.list()[0].id, bookId: null, mode: 'none' });
  assert.equal(second.bookId, research.id);
  assert.equal(books(space).filter((book) => /^research$/i.test(book.title)).length, 1);
  assert.equal(second.chapters, 1);
  const other = books(space).find((book) => book.title !== 'Research');
  space.inbox.take({ from: 'Recon Browser', name: 'Third clip', text: 'Other words.', kind: 'research' });
  const third = await space.inbox.add(space.workspace, { id: space.inbox.list()[0].id, bookId: other.id, mode: 'none' });
  assert.equal(third.bookId, other.id, 'the author’s choice wins');
});

test('a clip added to the wrong place can be thrown away, and a failed add leaves it waiting', async (t) => {
  const space = setUp(t);
  space.workspace.createProject('Salt Road');
  space.inbox.take({ from: 'Recon Browser', name: 'Clip', text: 'Words.', kind: 'research' });
  const [item] = space.inbox.list();
  await assert.rejects(space.inbox.add(space.workspace, { id: item.id, bookId: 'no-such-book', mode: 'none' }));
  assert.equal(space.inbox.list().length, 1, 'still waiting');
  assert.equal(books(space).some((book) => book.title === 'Research'), false, 'nothing half-made');
  space.inbox.drop(item.id);
  assert.deepEqual(space.inbox.list(), []);
});

// What must not happen

test('a locked project holds the clip in memory, and no file holds it until the author adds it', async (t) => {
  const space = setUp(t);
  const { id } = space.workspace.createProject('Salt Road');
  const security = new Security({ workspace: space.workspace, trusted: new TrustedComputer(space.root, fakeVault()) });
  security.makeRecovery();
  await security.setPassword({ password: PASSWORD });
  space.workspace.closeProject();
  await space.linking.apply();
  const browser = await space.browser();
  await browser.send('rt-story-tracker', { name: 'Held', text: CLIP, kind: 'research' });
  assert.equal(space.inbox.list().length, 1);
  const holds = () => fs.readdirSync(space.dir, { recursive: true }).filter((name) => {
    const full = path.join(space.dir, String(name));
    return fs.statSync(full).isFile() && fs.readFileSync(full).includes(MARKER);
  });
  assert.deepEqual(holds(), [], 'nothing in the profile, the shared folder or the temp folder has the words');
  await assert.rejects(space.inbox.add(space.workspace, { id: space.inbox.list()[0].id, bookId: null, mode: 'none' }), /No project is open/);
  assert.deepEqual(holds(), []);
  assert.equal(space.inbox.list().length, 1);
  await security.unlock({ id, how: 'password', secret: PASSWORD });
  await space.inbox.add(space.workspace, { id: space.inbox.list()[0].id, bookId: null, mode: 'none' });
  assert.deepEqual(space.inbox.list(), []);
  assert.deepEqual(holds().filter((name) => /\.(md|txt|json)$/i.test(name) && !/library/.test(name)), [], 'and still nowhere outside the encrypted project');
});

test('a picture in a clip is never fetched, on arrival or when it is added', async (t) => {
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    response.end('x');
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const space = setUp(t);
  space.workspace.createProject('Salt Road');
  const text = `---\nsource_url: ${base}/page\n---\nBefore. ![A weir](${base}/weir.png "title") After.\n\n<img src="${base}/raw.png" alt="Raw">\n\n![](${base}/bare.png)\n\n[A link](${base}/link)\n`;
  space.inbox.take({ from: 'Recon Browser', name: 'With pictures', text, kind: 'research' });
  space.inbox.list();
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  assert.deepEqual(hits, [], 'nothing was requested on arrival');
  const added = await space.inbox.add(space.workspace, { id: space.inbox.list()[0].id, bookId: null, mode: 'none' });
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  assert.deepEqual(hits, [], 'nothing was requested when it was added either');
  const chapter = space.workspace.outline().children.find((book) => book.id === added.bookId).children[0];
  const stored = textOf(space, chapter.id);
  assert.match(stored, /\[Image: A weir \(http:\/\/127\.0\.0\.1:\d+\/weir\.png\)\]/, 'the reference stays, as words');
  assert.match(stored, /\[Image: Raw \(http:\/\/127\.0\.0\.1:\d+\/raw\.png\)\]/);
  assert.match(stored, /\[Image: \(http:\/\/127\.0\.0\.1:\d+\/bare\.png\)\]/);
  assert.equal(stored.includes('"image"'), false, 'no picture node in the chapter');
});

test('at most 20 clips wait, and one can’t be bigger than 8 MB', async (t) => {
  const inbox = new Inbox();
  for (let at = 0; at < 20; at += 1) inbox.take({ from: 'Recon Browser', name: `Clip ${at}`, text: 'words', kind: 'research' });
  assert.throws(() => inbox.take({ from: 'Recon Browser', name: 'One more', text: 'words', kind: 'research' }), (error) => error instanceof LinkError && error.code === 'busy');
  assert.equal(inbox.list().length, 20);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-clip-big-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const big = path.join(dir, 'big.md');
  fs.writeFileSync(big, Buffer.alloc(8 * 1024 * 1024 + 1, 'a'));
  assert.throws(() => new Inbox().take({ from: 'Recon Browser', path: big, kind: 'research' }), (error) => error.code === 'not_allowed');

  const space = setUp(t);
  await space.linking.apply();
  const browser = await space.browser();
  const info = JSON.parse(fs.readFileSync(path.join(space.folder, 'rt-story-tracker.json'), 'utf8'));
  const key = browser.load()['rt-story-tracker'].key;
  await assert.rejects(call(info.endpoint, 'open_document', { app: 'recon-browser', key, name: 'Huge', text: 'a'.repeat(9 * 1024 * 1024), kind: 'research' }), Error);
  assert.deepEqual(space.inbox.list(), [], 'nothing waits from the too-big one');
});

test('an app that isn’t linked can’t send a clip', async (t) => {
  const space = setUp(t);
  await space.linking.apply();
  const info = JSON.parse(fs.readFileSync(path.join(space.folder, 'rt-story-tracker.json'), 'utf8'));
  await assert.rejects(call(info.endpoint, 'open_document', { app: 'recon-browser', key: 'nope', name: 'x', text: 'y', kind: 'research' }), /isn’t linked/);
  assert.deepEqual(space.inbox.list(), []);
});

// The Apps panel

test('Recon Browser shows in the Apps panel when it’s installed or running, and starts only from the installed list', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-clip-apps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const program = path.join(dir, process.platform === 'win32' ? 'recon-browser.exe' : 'recon-browser');
  fs.writeFileSync(program, '');
  if (process.platform !== 'win32') fs.chmodSync(program, 0o755);
  const started = [];
  const space = setUp(t);
  space.linking.startApp = (entry) => started.push(entry.id);
  await space.linking.apply();
  const missing = (await space.linking.status()).apps.find((app) => app.id === 'recon-browser');
  assert.deepEqual([missing.state, missing.canOpen, missing.canGet], ['missing', false, true], 'not installed, not running: listed, to be got');
  await assert.rejects(() => space.linking.openApp('recon-browser'), /isn’t installed/);

  writeInstalled(space.folder, { id: 'recon-browser', name: 'Recon Browser', version: '1.3.0', launch: program });
  const installed = (await space.linking.status()).apps.find((app) => app.id === 'recon-browser');
  assert.deepEqual([installed.name, installed.installed, installed.running, installed.known, installed.canOpen], ['Recon Browser', true, false, true, true]);
  await space.linking.openApp('recon-browser');
  assert.deepEqual(started, ['recon-browser']);

  const browser = await space.browser();
  const running = (await space.linking.status()).apps.find((app) => app.id === 'recon-browser');
  assert.deepEqual([running.running, running.linked, running.canOpen], [true, true, false], 'running and linked, so there is nothing to start');
  assert.equal(browser.running, true);
});
