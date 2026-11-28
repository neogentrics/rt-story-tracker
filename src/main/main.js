'use strict';
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, powerMonitor, safeStorage, screen, session, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Backups } = require('./backups');
const { exportFile } = require('./export');
const { Importer } = require('./import');
const { Inbox, isWritingFile } = require('./inbox');
const { Versions } = require('./versions');
const { LINKS, detailsText } = require('../shared/family');
const { registerIpc } = require('./ipc');
const { launchPathFor } = require('./installed');
const { Linking } = require('./linking');
const { contextTemplate } = require('./context-menu');
const { FolderLinks } = require('./folder/links');
const { buildMenu } = require('./menu');
const { sizeFrom, windowBounds } = require('./window-size');
const { ITEMS, resolveKeys } = require('../shared/shortcuts');
const { Security } = require('./security');
const { AudioFiles } = require('./read-aloud/audio-files');
const { checkEngine } = require('./read-aloud/engine-check');
const { ReadAloud, workerIn } = require('./read-aloud');
const { runSelfTest, writeInWindow } = require('./self-test');
const { Settings } = require('./settings');
const { Library } = require('./storage/library');
const { TrustedComputer } = require('./storage/trusted');
const { Updater } = require('./updater');
const { Workspace } = require('./workspace');

const selfTestFile = process.argv.find((arg) => arg.startsWith('--self-test='))?.slice('--self-test='.length);
const withMeasure = process.argv.includes('--measure');
const FLUSH_TIMEOUT_MS = 5000;

// A self-test gets its own throwaway profile, so it can never touch an author's library.
const scratch = selfTestFile ? fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-self-test-')) : null;
if (scratch) app.setPath('userData', path.join(scratch, 'profile'));
else if (process.env.RTST_USER_DATA) app.setPath('userData', process.env.RTST_USER_DATA);

let workspace = null;
let settings = null;
let folderLinks = null;
let readAloud = null;
let audioFiles = null;
let backups = null;
let security = null;
let linking = null;
let pendingFile = process.argv.slice(1).find((arg) => arg.toLowerCase().endsWith('.rtstory')) ?? null;
let libraryError = null;
let mainWindow = null;
let flushCount = 0;
let quitting = false;

// Once an update is ready the Help menu says so, as RT Markdown Reader's does, so the menu is built again.
const updater = new Updater((status) => {
  mainWindow?.webContents.send('update:status', status);
  readyVersion = status.state === 'ready' ? status.version : null;
  rebuildMenu();
});
let menuHooks = null;
let readyVersion = null;
// While the Keyboard Shortcuts page is listening for a new key, the menu keys are off, so pressing one reaches the page and doesn't run.
let keysPaused = false;

// The menu is built again when an update is ready, when the author changes a shortcut, and when the page starts and stops listening.
function rebuildMenu() {
  if (!menuHooks) return;
  const keys = resolveKeys(keysPaused ? { ...Object.fromEntries(ITEMS.map((item) => [item.id, ''])) } : settings?.values.shortcuts, process.platform);
  Menu.setApplicationMenu(buildMenu({ ...menuHooks, keys, updateReady: readyVersion, settings: settings?.values }));
}

// View, Look: saved here, and the window is told so it can draw it.
function setLook(surface) {
  if (!settings) return;
  settings.save({ surface });
  rebuildMenu();
  mainWindow?.webContents.send('menu:command', 'settings-changed');
}

// The system's own encrypted storage. On Linux with no keyring Electron falls back to a fixed password, which is no
// protection at all, so that counts as having none.
const systemVault = {
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  seal: (text) => safeStorage.encryptString(text),
  open: (data) => safeStorage.decryptString(data),
};

// A document arriving is the one thing that may bring this window forward by itself.
const inbox = new Inbox({
  onChange: ({ arrived }) => {
    if (!mainWindow) return;
    if (arrived) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow.webContents.send('inbox:changed');
  },
});

async function askToLink({ name }) {
  const box = {
    type: 'question',
    message: `Link ${name} with RT Story Tracker?`,
    detail: `${name} will be able to send documents here, and you choose where each one goes. It can’t read or change anything on its own.\n\nOnly say yes if you’ve just asked it to link.`,
    buttons: ['Link', 'Don’t Link'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  if (mainWindow) mainWindow.focus();
  const { response } = await (mainWindow ? dialog.showMessageBox(mainWindow, box) : dialog.showMessageBox(box));
  return response === 0;
}

// A Markdown or text file this app was started with, or handed: someone chose Open With, or another app did it for them.
function takeWritingFile(file) {
  try {
    inbox.take({ from: 'Another app', path: file });
  } catch (error) {
    dialog.showMessageBox(mainWindow, { type: 'info', message: error.message });
  }
}

function openLibrary() {
  try {
    const root = path.join(app.getPath('userData'), 'library');
    workspace = new Workspace(new Library(root));
    settings = new Settings(root);
    folderLinks = new FolderLinks(app.getPath('userData'));
    readAloud = new ReadAloud({
      // The voices are downloaded to here, if the author asks for them. They're never part of the app.
      root: path.join(app.getPath('userData'), 'voices'),
      worker: workerIn(app.getAppPath()),
      fetch: (url, options) => net.fetch(url, options),
      fork: forkVoice,
      open: () => Boolean(workspace.project),
      // Only a test, running from the source, can have a voice that plays a tone and a download that downloads nothing.
      fake: !app.isPackaged && process.env.RTST_FAKE_VOICES === '1',
    });
    audioFiles = new AudioFiles();
    // Closing or locking a project ends the voice, which holds its words in memory, and any audio export with it.
    workspace.whenClosed(() => {
      readAloud.hush();
      audioFiles.abandonAll();
    });
    backups = new Backups(workspace, settings);
    security = new Security({
      workspace,
      backups,
      trusted: new TrustedComputer(root, systemVault),
      onProgress: (progress) => mainWindow?.webContents.send('security:progress', progress),
      onLocked: () => linking?.clearSent(),
    });
    linking = new Linking({
      workspace,
      settings,
      inbox,
      root,
      vault: systemVault,
      home: app.getPath('home'),
      dataDir: app.getPath('userData'),
      version: app.getVersion(),
      ask: askToLink,
      openPage: (page) => shell.openExternal(page),
      // Only what the site's one small file says, kept for a day in this file.
      // A test can point it at a server on this computer, and nothing else can: the address is the site's.
      versions: new Versions({ file: path.join(root, 'versions-cache.json'), ...(/^http:\/\/127\.0\.0\.1:\d+\//.test(process.env.RTST_VERSIONS_URL ?? '') ? { url: process.env.RTST_VERSIONS_URL } : {}) }),
      // Only an installed copy says it's installed. Running from the source isn't.
      launchPath: process.env.RTST_INSTALLED_LAUNCH || (app.isPackaged ? launchPathFor({ execPath: process.execPath, appImage: process.env.APPIMAGE }) : null),
    });
    linking.registerInstalled();
    session.defaultSession.setSpellCheckerEnabled(settings.values.spellcheck);
  } catch (error) {
    libraryError = error.message;
  }
}

function status() {
  if (!workspace) throw new Error(libraryError ?? 'The library has not opened.');
  return { version: app.getVersion(), update: updater.status };
}

// Asks the window to save whatever it's holding, and waits for it. A window that doesn't answer can't stop the app
// closing, and it can lose no more than the last few seconds.
function requestFlush(window) {
  return new Promise((resolve) => {
    if (window.isDestroyed() || window.webContents.isCrashed()) {
      resolve(false);
      return;
    }
    flushCount += 1;
    const channel = `app:flushed:${flushCount}`;
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(channel);
      resolve(false);
    }, FLUSH_TIMEOUT_MS);
    ipcMain.once(channel, (_event, saved) => {
      clearTimeout(timer);
      resolve(saved);
    });
    window.webContents.send('app:flush', channel);
  });
}

async function textMenu(window, params) {
  // The writing page is the only place with comments and find and replace.
  const onPage = params.isEditable
    && await window.webContents.executeJavaScript("Boolean(document.activeElement?.closest('.pane .ProseMirror'))").catch(() => false);
  if (window.isDestroyed()) return;
  const template = contextTemplate(params, {
    onPage,
    replace: (word) => window.webContents.replaceMisspelling(word),
    learn: (word) => window.webContents.session.addWordToSpellCheckerDictionary(word),
    send: (command) => window.webContents.send('menu:command', command),
  });
  if (template.length) Menu.buildFromTemplate(template).popup({ window });
}

// A test can ask for a smaller window, such as the 1024 by 768 screen of a hosted Windows computer, with RTST_WINDOW_SIZE=1024x768.
function windowSize() {
  // A test can pretend the screen is smaller than it is, with RTST_WORK_AREA, or ask for a size with RTST_WINDOW_SIZE.
  const work = sizeFrom(process.env.RTST_WORK_AREA) ?? screen.getPrimaryDisplay().workAreaSize;
  return windowBounds(work, sizeFrom(process.env.RTST_WINDOW_SIZE));
}

function createWindow({ show = true } = {}) {
  // A window that closed while it was listening for a new shortcut can't give the menu its keys back, so a new one does.
  if (keysPaused) {
    keysPaused = false;
    rebuildMenu();
  }
  const window = new BrowserWindow({
    ...windowSize(),
    show: false,
    title: 'RT Story Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (show) window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => {
    if (window === mainWindow) BrowserWindow.getAllWindows().forEach((other) => other.close());
  });
  window.webContents.on('context-menu', (_event, params) => textMenu(window, params));
  // The saved work is safe in the database, so a crashed window just starts again.
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit' && !window.isDestroyed()) window.webContents.reload();
  });

  let saved = false;
  window.on('close', (event) => {
    if (saved || selfTestFile) return;
    event.preventDefault();
    requestFlush(window).finally(() => {
      saved = true;
      // Stopping the close above also cancelled any quit, and on a Mac closing the window wouldn't start it again.
      if (quitting) app.quit();
      else window.close();
    });
  });

  window.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  return window;
}

// The process that speaks (read-aloud/index.js). It's Electron's own kind of child, so a sentence being made never holds up the window.
function forkVoice(script) {
  return utilityProcess.fork(script, [], { serviceName: 'RT Story Tracker voices', stdio: 'ignore' });
}

// The speech engine and the MP3 encoder both load from inside the installed app, so this is only proven by doing it from there. The
// encoder has to be a file of its own outside the app's archive, so that it can be replaced.
async function voiceFromHere() {
  const engine = await checkEngine({ fork: forkVoice, worker: workerIn(app.getAppPath()) });
  if (engine !== 'ready') return engine;
  const encoded = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'lame.min.js';
    script.onload = () => {
      const encoder = new window.lamejs.Mp3Encoder(1, 44100, 64);
      const tone = Int16Array.from({ length: 44100 }, (_, at) => Math.round(8000 * Math.sin(at / 20)));
      resolve(encoder.encodeBuffer(tone).length + encoder.flush().length);
    };
    script.onerror = () => resolve(0);
    document.head.append(script);
  })`);
  if (!(encoded > 1000)) return 'the MP3 encoder made nothing';
  if (app.isPackaged) {
    const outside = (...parts) => path.join(process.resourcesPath, 'app.asar.unpacked', ...parts);
    const missing = [['dist', 'renderer', 'lame.min.js'], ['dist', 'renderer', 'lame.all.js'], ['licences', 'LGPL-3.0.txt'], ['licences', 'GPL-3.0.txt']]
      .filter((parts) => !fs.existsSync(outside(...parts)));
    if (missing.length) return `not beside the app, as the MP3 encoder’s licence needs: ${missing.map((parts) => parts.at(-1)).join(', ')}`;
  }
  return 'ready';
}

function timeout(ms, value) {
  return new Promise((resolve) => setTimeout(resolve, ms, value));
}

async function windowState(window) {
  if (window.webContents.isLoading()) {
    const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    await Promise.race([loaded, timeout(30000)]);
  }
  for (let tries = 0; tries < 100; tries += 1) {
    const state = await Promise.race([
      window.webContents.executeJavaScript("document.body.dataset.state ?? ''"),
      timeout(5000, ''),
    ]);
    if (state) return state;
    await timeout(100);
  }
  return 'timed out';
}

// Print files load fonts from inside the installed app, so this is only proven by doing it from there.
async function exportFromHere() {
  const project = workspace.open();
  for (const format of ['pdf', 'epub', 'docx']) {
    const file = path.join(scratch, `self-test.${format}`);
    const { size } = await exportFile(project, { scope: 'project', format, file });
    if (size < 1000) return `${format} came out empty`;
  }
  return 'exported';
}

// The readers for Word, e-books and PDF are libraries that load from inside the installed app, so this proves them there.
async function importFromHere() {
  for (const format of ['pdf', 'epub', 'docx']) {
    const { importedWords } = await new Importer().inspect(path.join(scratch, `self-test.${format}`));
    if (importedWords < 5) return `${format} came back with ${importedWords} words`;
  }
  const project = workspace.open();
  const picture = await project.addAttachment(project.id, { name: 'self-test.pdf', source: path.join(scratch, 'self-test.pdf') });
  const back = await project.attachments.read(project.attachment(picture.id).file);
  if (!back.equals(fs.readFileSync(path.join(scratch, 'self-test.pdf')))) return 'an attachment came back different';
  return 'imported';
}

// The password stretching and the new key are native code inside the installed app, so this proves them there.
async function lockFromHere() {
  const { id } = workspace.open();
  const password = 'correct horse battery staple';
  security.makeRecovery();
  await security.setPassword({ password });
  workspace.closeProject();
  if (workspace.library.describe(id).state !== 'locked') return 'it wasn’t locked';
  const refused = await security.unlock({ id, how: 'password', secret: 'the wrong password' }).then(() => false, () => true);
  if (!refused) return 'a wrong password opened it';
  await security.unlock({ id, how: 'password', secret: password });
  const project = workspace.open();
  const [attachment] = project.listAttachments(id);
  const back = await project.attachments.read(project.attachment(attachment.id).file);
  return back.equals(fs.readFileSync(path.join(scratch, 'self-test.pdf'))) ? 'locked' : 'an attachment came back different';
}

// The window goes first and is closed before the storage work, because that work holds up this process, and a window
// still loading behind it can stall for good.
async function selfTest() {
  let report;
  try {
    console.log('Self-test: waiting for the window');
    const state = await windowState(mainWindow);
    console.log(`Self-test: window is ${state}`);
    const writing = await Promise.race([
      writeInWindow(mainWindow, workspace, requestFlush).catch((error) => error.message),
      timeout(60000, 'timed out'),
    ]);
    console.log(`Self-test: writing is ${writing}`);
    const printed = await Promise.race([exportFromHere().catch((error) => error.message), timeout(120000, 'timed out')]);
    console.log(`Self-test: print export is ${printed}`);
    const imported = await Promise.race([importFromHere().catch((error) => error.message), timeout(60000, 'timed out')]);
    console.log(`Self-test: import is ${imported}`);
    const locked = await Promise.race([lockFromHere().catch((error) => error.message), timeout(60000, 'timed out')]);
    console.log(`Self-test: lock is ${locked}`);
    const voice = await Promise.race([voiceFromHere().catch((error) => error.message), timeout(90000, 'timed out')]);
    console.log(`Self-test: voice is ${voice}`);
    workspace.closeProject();
    mainWindow.destroy();
    report = runSelfTest(path.join(scratch, 'work'), { withMeasure });
    report.checks.push({ name: 'opens the window', passed: state === 'ready', detail: state });
    report.checks.push({ name: 'writes and saves a chapter in the window', passed: writing === 'saved', detail: writing });
    report.checks.push({ name: 'exports a print PDF, an e-book and a Word file', passed: printed === 'exported', detail: printed });
    report.checks.push({ name: 'reads those three files back in, and keeps an attachment', passed: imported === 'imported', detail: imported });
    report.checks.push({ name: 'locks a project with a password and opens it again', passed: locked === 'locked', detail: locked });
    report.checks.push({ name: 'starts the speech engine, and encodes MP3 with an encoder that can be replaced', passed: voice === 'ready', detail: voice });
    report.ok = report.ok && state === 'ready' && writing === 'saved' && printed === 'exported' && imported === 'imported' && locked === 'locked' && voice === 'ready';
  } catch (error) {
    report = { ok: false, error: error.stack };
  }
  report.packaged = app.isPackaged;
  report.version = app.getVersion();
  fs.writeFileSync(selfTestFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Self-test: finished, ok is ${report.ok}`);
  try {
    fs.rmSync(path.join(scratch, 'work'), { recursive: true, force: true, maxRetries: 5 });
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // Chromium can still hold the small profile folder on Windows. The large test files are gone by now.
  }
  app.exit(report.ok ? 0 : 1);
}

// What the About window shows. Nothing about the person or the project is in it, so it can be copied into a bug report as it is.
function aboutInfo() {
  const system = { win32: 'Windows', darwin: 'macOS' }[process.platform] ?? 'Linux';
  return {
    version: app.getVersion(),
    year: new Date().getFullYear(),
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${system} ${os.release()} (${process.arch})`,
  };
}

// The About window is in the page, like RT Markdown Reader's. With no window open, a short version in a message box.
function showAbout() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:command', 'about');
    return;
  }
  dialog.showMessageBox({ type: 'none', title: 'About RT Story Tracker', message: 'RT Story Tracker', detail: `Version ${app.getVersion()}\n${LINKS.website()}` });
}

async function checkForUpdatesFromMenu() {
  const result = await updater.check();
  const messages = {
    current: { message: 'You’re up to date', detail: `RT Story Tracker ${app.getVersion()} is the latest version.` },
    downloading: { message: `Version ${result.version} is downloading`, detail: 'You’ll be asked to restart when it’s ready.' },
    ready: { message: `Version ${result.version} is ready to install`, detail: 'Choose Help, then Restart to Update, or press Restart to update at the top of the window.' },
    available: { message: `Version ${result.version} is available`, detail: 'This copy can’t update itself. Choose Download at the top of the window.' },
    off: { message: 'Updates are off in this copy of the app', detail: '' },
    error: { type: 'warning', message: 'Couldn’t check for updates', detail: result.message ? `${result.message}` : 'Check your internet connection and try again.' },
  };
  dialog.showMessageBox(mainWindow, { type: 'info', title: 'Check for Updates', buttons: ['OK'], ...(messages[result.state] ?? messages.current) });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A double-clicked .rtstory file: Windows and Linux pass it to a second copy of the app, and Mac sends this event.
  const openFile = (file) => {
    if (isWritingFile(file)) takeWritingFile(file);
    else if (mainWindow?.webContents.isLoading() === false) mainWindow.webContents.send('app:openFile', file);
    else pendingFile = file;
  };
  app.on('open-file', (event, file) => {
    event.preventDefault();
    openFile(file);
  });

  app.on('second-instance', (_event, argv) => {
    const file = argv.slice(1).find((arg) => arg.toLowerCase().endsWith('.rtstory') || isWritingFile(arg));
    if (file) openFile(file);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    openLibrary();
    registerIpc({
      status,
      checkForUpdates: checkForUpdatesFromMenu,
      menuKeys: {
        // A shortcut or the look was changed: the menu is built again with it.
        changed: () => rebuildMenu(),
        pause: (paused) => {
          keysPaused = paused === true;
          rebuildMenu();
        },
      },
      aboutApp: {
        info: aboutInfo,
        // The window names a link, never an address: the addresses are the shared file's.
        open: (id) => {
          if (!Object.hasOwn(LINKS, id)) throw new Error('That link isn’t known.');
          shell.openExternal(LINKS[id](app.getVersion()));
        },
        copy: () => {
          const text = detailsText(aboutInfo());
          clipboard.writeText(text);
          return text;
        },
      },
      workspace: () => {
        if (!workspace) throw new Error(libraryError ?? 'The library has not opened.');
        return workspace;
      },
      settings: () => {
        if (!settings) throw new Error(libraryError ?? 'The library has not opened.');
        return settings;
      },
      updater,
      folderLinks: () => folderLinks,
      readAloud: () => readAloud,
      audioFiles: () => audioFiles,
      backups: () => backups,
      security: () => security,
      linking: () => linking,
      inbox: () => inbox,
      window: () => mainWindow,
      takeFile: () => {
        const file = pendingFile;
        pendingFile = null;
        return file;
      },
    });
    menuHooks = {
      send: (command) => mainWindow?.webContents.send('menu:command', command),
      checkForUpdates: checkForUpdatesFromMenu,
      about: showAbout,
      version: app.getVersion(),
      setLook,
    };
    rebuildMenu();
    mainWindow = createWindow({ show: !selfTestFile });
    // A locked project shouldn't stay open behind a locked screen or a sleeping laptop.
    for (const event of ['lock-screen', 'suspend']) powerMonitor.on(event, () => mainWindow?.webContents.send('menu:command', 'auto-lock'));
    if (selfTestFile) {
      selfTest();
    } else {
      updater.start();
      backups?.start();
      linking?.apply().catch(() => {});
      linking?.checkVersions();
      const given = process.argv.slice(1).find(isWritingFile);
      if (given) takeWritingFile(given);
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !selfTestFile) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    security?.close();
    linking?.close();
  });
}
