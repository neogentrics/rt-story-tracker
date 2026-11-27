'use strict';
// This app's side of App Link, and Open in RT Markdown Reader. docs/design/working-with-rt-markdown-reader.md has the
// reasoning. It stays off until the author turns it on, and a locked project never leaves through here.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APP_ID, APP_NAME, AppLink, LinkError, MIN_PROTOCOL, PROTOCOL, sharedFolder, validId } = require('./app-link');
const { exportFile, safeName } = require('./export');
const { fromInstaller, launchInstalled, readInstalled, writeInstalled } = require('./installed');
const { writeFileSafely } = require('./storage/keys');
const { SUITE_APPS, UPDATE, appById, isNewer, linkability, stateOf, updateButton, updateLine } = require('../shared/suite-apps');

const READER_ID = 'rt-markdown-reader';
const LINKS_FILE = 'app-links.bin';
const OLD_LINKS_FILE = 'links.bin';
const SENT_FOLDER = /^rtst-send-[0-9a-f]{16}$/;
const LOCKED_WORDS = 'A locked project is never sent to another app. Take the password off first if you want to.';
const NOT_FOUND_WORDS = 'RT Markdown Reader isn’t on this computer, or it’s somewhere this app can’t find. If it’s running, link the two in Preferences.';

// Where the installers put it. There's no other way to ask for an app by name on Windows or Linux.
function readerPlaces({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.RTST_READER_APP) return [env.RTST_READER_APP];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programs = [path.join(local, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
    return programs.flatMap((dir) => ['neo-markdown-reader', 'rt-markdown-reader', 'RT Markdown Reader'].map((name) => path.join(dir, name, 'RT Markdown Reader.exe')));
  }
  if (platform === 'darwin') return ['/Applications/RT Markdown Reader.app', path.join(home, 'Applications', 'RT Markdown Reader.app')];
  return ['/opt/RT Markdown Reader/neo-markdown-reader', '/opt/RT Markdown Reader/rt-markdown-reader', '/usr/bin/neo-markdown-reader', '/usr/bin/rt-markdown-reader'];
}

function launchReader(app, file, { platform = process.platform, start = spawn } = {}) {
  const [command, args] = platform === 'darwin' && app.endsWith('.app') ? ['open', ['-a', app, file]] : [app, [file]];
  start(command, args, { detached: true, stdio: 'ignore' }).unref();
}

const nodesOf = (node, kind) => (node.kind === kind ? [node] : node.children.flatMap((child) => nodesOf(child, kind)));

class Linking {
  // launchPath is where this app starts from, for the installed list, and is null when it isn't an installed copy.
  // startApp starts another installed app, and openPage opens a web page for the person.
  constructor({ workspace, settings, vault, inbox, root, home, dataDir, version, ask, places = readerPlaces, launch = launchReader, launchPath = null, startApp = launchInstalled, openPage = () => {}, versions = null, platform = process.platform, tempDir = os.tmpdir() }) {
    Object.assign(this, { workspace, settings, vault, inbox, root, home, dataDir, version, ask, places, launch, launchPath, startApp, openPage, platform, tempDir });
    // Where the latest versions come from (a Versions, made by the app). Without one nothing is asked and no nudge is shown.
    this.versions = versions ?? { answer: null, check: async () => ({ state: 'unavailable', apps: {} }) };
    this.file = path.join(root, LINKS_FILE);
    // Links made under this app's old App Link id can't work, so they go, and the app offers to link again.
    fs.rmSync(path.join(root, OLD_LINKS_FILE), { force: true });
    this.memory = null;
    this.server = null;
    this.sentFolder = null;
    this.sweep();
  }

  // Keys go in the system's encrypted storage. Where it has none, they last until the app closes, and never touch a file.
  load() {
    if (this.memory) return { ...this.memory };
    if (!this.vault.available()) return {};
    try {
      const saved = JSON.parse(this.vault.open(fs.readFileSync(this.file)));
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  save(links) {
    if (!this.vault.available()) {
      this.memory = { ...links };
      return;
    }
    writeFileSafely(this.file, this.vault.seal(JSON.stringify(links)));
  }

  async apply() {
    if (!this.settings.values.appLink) {
      await this.stop();
      return;
    }
    if (this.server) return;
    const server = new AppLink({
      folder: sharedFolder({ home: this.home }),
      dataDir: this.dataDir,
      version: this.version,
      load: () => this.load(),
      save: (links) => this.save(links),
      ask: this.ask,
      open: (document) => this.inbox.take(document),
      status: () => this.describe(),
      facts: this.factProvider(),
    });
    await server.start();
    this.server = server;
  }

  async stop() {
    const { server } = this;
    this.server = null;
    await server?.stop();
  }

  async setOn(on) {
    this.settings.save({ appLink: on === true });
    try {
      await this.apply();
      return this.status();
    } catch {
      this.settings.save({ appLink: false });
      return { ...(await this.status()), error: 'App Link couldn’t start.' };
    }
  }

  sharedFolder() {
    return sharedFolder({ home: this.home });
  }

  // Says this app is installed, so other apps can find it while it's closed. It holds no secrets, so it's written whether or
  // not App Link is on. Nothing connects to anything because of it.
  registerInstalled() {
    if (!this.launchPath) return false;
    try {
      return writeInstalled(this.sharedFolder(), { id: APP_ID, name: APP_NAME, version: this.version, launch: this.launchPath });
    } catch {
      return false;
    }
  }

  // What the person sees: every app in the suite, whether it's on this computer, running or linked, and a line about what a
  // linked app that's running is doing. An app that isn't there is still listed, so it can be got. Something else that left an
  // installed file is listed too, with no button to start it. Finding an app never links it, and nothing here is asked on a
  // timer: it's looked at when the person asks.
  async apps({ latest = {} } = {}) {
    const rows = new Map();
    const row = (id, name) => {
      if (!rows.has(id)) rows.set(id, { id, name, about: '', version: '', installed: false, running: false, linked: false, known: false, canOpen: false, line: '' });
      return rows.get(id);
    };
    for (const app of SUITE_APPS) {
      if (app.id !== APP_ID) Object.assign(row(app.id, app.name), { about: app.about, known: true });
    }
    const launches = new Map();
    for (const item of readInstalled(this.sharedFolder())) {
      if (item.id === APP_ID) continue;
      launches.set(item.id, item.launch);
      Object.assign(row(item.id, item.name), { installed: true, version: item.version, known: item.known, protocol: item.protocol, minProtocol: item.minProtocol });
    }
    const running = this.server ? await this.server.found() : [];
    for (const item of running) {
      // What a running app says about itself is newer than the file it left, so it wins.
      Object.assign(row(item.id, item.name), { running: true, version: item.version || rows.get(item.id)?.version || '', protocol: item.protocol, minProtocol: item.minProtocol, accepts: item.accepts });
    }
    for (const [id, link] of Object.entries(this.load())) {
      const found = row(id, link.name);
      found.linked = true;
      if (!found.known) found.name = link.name || found.name;
    }
    const list = [...rows.values()];
    for (const item of list) {
      item.canOpen = item.installed && item.known && !item.running;
      item.state = stateOf(item);
      item.canGet = item.known && !item.installed && !item.running;
      // Whether it can be linked at all. Only the protocol and the kinds of document decide: never its version number.
      const fit = item.protocol ? linkability({ mine: { protocol: PROTOCOL, minProtocol: MIN_PROTOCOL, accepts: ['markdown', 'text'] }, theirs: item }) : { ok: true };
      item.needsUpdate = fit.ok ? '' : fit.who;
      item.canLink = item.state === 'found' && fit.ok;
      // A nudge, and only a nudge: it never takes away a button that would otherwise be there.
      const newest = latest[item.id]?.version;
      item.update = item.version && newest && isNewer(newest, item.version) ? { have: item.version, latest: newest, line: updateLine({ have: item.version, latest: newest }), action: updateButton({ platform: this.platform, launch: launches.get(item.id), installer: this.platform === 'win32' && fromInstaller(launches.get(item.id)), running: item.running }) } : null;
    }
    await Promise.all(list.filter((item) => item.linked && item.running && this.server).map(async (item) => {
      try {
        item.line = (await this.server.statusOf(item.id)).line;
      } catch {
        // It didn't say, which is no reason to hide it.
      }
    }));
    const place = (item) => (item.known ? SUITE_APPS.findIndex((app) => app.id === item.id) : SUITE_APPS.length);
    return list.sort((a, b) => place(a) - place(b) || a.name.localeCompare(b.name));
  }

  // "Get it": opens the app's page on the store. The address comes from the shared list by id, never from the window.
  getApp(id) {
    const app = appById(id);
    if (!app || app.id === APP_ID || !/^https:\/\//.test(app.page)) throw new Error('That app isn’t known.');
    // An app that's newer than this one's list may have a page of its own, which the site's file gives. Only ever an https page on the site.
    this.openPage(this.versions.answer?.apps?.[id]?.url || app.page);
  }

  // `refresh` is the person pressing Refresh, which asks the site again. Otherwise the answer from the last day is used.
  async status({ refresh = false } = {}) {
    let updates = { state: 'unavailable', apps: {} };
    try {
      updates = await this.versions.check({ force: refresh === true });
    } catch {
      updates = { state: 'unreachable', apps: {} };
    }
    return { on: this.settings.values.appLink, safe: this.vault.available(), apps: await this.apps({ latest: updates.apps }), updates: updates.state };
  }

  // Looked at when the app starts, if App Link is on. The panel looks when it opens.
  checkVersions() {
    if (!this.settings.values.appLink) return Promise.resolve();
    return this.versions.check().catch(() => {});
  }

  async openApp(id) {
    if (!validId(id)) throw new Error('That app isn’t known.');
    const entry = readInstalled(this.sharedFolder()).find((item) => item.id === id);
    if (!entry) throw new Error('That app isn’t installed here.');
    if (!this.server || !(await this.server.found()).some((item) => item.id === id)) this.startApp(entry);
    return this.status();
  }

  // What this app tells a linked app about itself. A project with a password says nothing, open or not, and says the same
  // as no project at all, so the answer can't be used to find out that one exists.
  describe() {
    const space = this.workspace;
    if (!space.project || space.locked) return { state: 'idle' };
    if (space.busy > 0) return { state: 'busy', line: 'Busy with a long job' };
    const title = space.project.title();
    const { mode, chapterId } = space.activity;
    if (mode === 'records') return { state: 'open', line: `Looking at records in “${title}”` };
    const chapter = chapterId ? space.project.getItem(chapterId) : null;
    if (chapter?.kind === 'chapter' && !chapter.trashedAt) return { state: 'open', line: `Editing “${chapter.title}” in “${title}”` };
    return { state: 'open', line: `Open: “${title}”` };
  }

  // Numbers a linked app can ask for. Only the project that's open, and only if it has no password. No writing.
  factProvider() {
    const names = ['book.progress'];
    return {
      list: () => names,
      get: (name) => {
        const space = this.workspace;
        if (name !== 'book.progress') throw new LinkError('not_found', 'This app doesn’t have that.');
        if (!space.project || space.locked) throw new LinkError('not_found', 'No project is open.');
        const books = nodesOf(space.outline(), 'book');
        return {
          project: space.project.title(),
          books: books.map((book) => ({ title: book.title, words: book.words, chapters: nodesOf(book, 'chapter').length })),
        };
      },
    };
  }

  async pair(id) {
    if (!this.server || !validId(id)) throw new Error('Turn on App Link first.');
    await this.server.pairWith(id);
    return this.status();
  }

  async unlink(id) {
    if (validId(id)) await this.server?.unlink(id);
    return this.status();
  }

  // A chapter or a book, as Markdown. The exporter only writes files, so it passes through one that's removed at once.
  async markdownOf(project, { scope, id }) {
    const folder = fs.mkdtempSync(path.join(this.tempDir, 'rtst-make-'));
    const file = path.join(folder, 'out.md');
    try {
      await exportFile(project, { scope, id, format: 'md', file });
      return fs.readFileSync(file, 'utf8');
    } finally {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
    }
  }

  // Through the link if there is one and the app's running. If not, the same way as Open With, so no link is needed and it
  // starts the app if it's closed.
  async openInReader({ scope, id, publish = false }) {
    if (this.workspace.locked) throw new Error(LOCKED_WORDS);
    const project = this.workspace.open();
    const item = project.getItem(id);
    if (!item || !['chapter', 'book'].includes(item.kind) || item.kind !== scope) throw new Error('Choose a chapter or a book.');
    const text = await this.markdownOf(project, { scope, id });
    const name = `${safeName(item.title)}.md`;
    if (this.server && Object.hasOwn(this.load(), READER_ID)) {
      try {
        await this.server.send(READER_ID, { name, text, ...(publish === true ? { intent: 'publish' } : {}) });
        return { how: 'link' };
      } catch (error) {
        if (!(error instanceof LinkError) || !['not_running', 'not_linked', 'timed_out'].includes(error.code)) throw error;
      }
    }
    return this.openThroughSystem(name, text);
  }

  openThroughSystem(name, text) {
    const app = this.places().find((place) => fs.existsSync(place));
    if (!app) throw new Error(NOT_FOUND_WORDS);
    if (!this.sentFolder) {
      this.sentFolder = path.join(this.tempDir, `rtst-send-${crypto.randomBytes(8).toString('hex')}`);
      fs.mkdirSync(this.sentFolder);
    }
    const file = path.join(this.sentFolder, name);
    fs.writeFileSync(file, text);
    this.launch(app, file);
    return { how: 'system' };
  }

  // The app that opened a file may still be reading it, so these wait for the app to close, and for the next start if it
  // didn't get that far. Only ever this app's own folders.
  sweep() {
    for (const name of fs.readdirSync(this.tempDir)) {
      if (SENT_FOLDER.test(name) || /^rtst-make-/.test(name)) fs.rmSync(path.join(this.tempDir, name), { recursive: true, force: true, maxRetries: 2 });
    }
  }

  clearSent() {
    if (this.sentFolder) fs.rmSync(this.sentFolder, { recursive: true, force: true, maxRetries: 2 });
    this.sentFolder = null;
  }

  async close() {
    this.clearSent();
    await this.stop();
  }
}

module.exports = { Linking, launchReader, readerPlaces };
