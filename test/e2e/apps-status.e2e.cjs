'use strict';
// The apps status icon in the real app: a dot that summarises, in words as well as colour, and the panel it opens. A small
// AppLink in this test plays RT Markdown Reader. Nothing is looked at on a timer, finding an app never links it, and "Get it"
// opens only a page from the shared list.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppLink } = require('../../src/main/app-link');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-apps-'));
const shared = path.join(work, 'shared');
const profile = path.join(work, 'profile');

(async () => {
  fs.mkdirSync(path.join(shared, 'installed'), { recursive: true });
  fs.mkdirSync(path.join(work, 'reader'));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: shared, RTST_INSTALLED_LAUNCH: process.execPath },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  window.on('dialog', (dialog) => dialog.accept());
  await app.evaluate(({ dialog, shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (page) => { globalThis.opened.push(page); };
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  await window.fill('#new-title', 'Apps Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');

  const dot = () => window.locator('.apps-dot').getAttribute('data-dot');
  const name = () => window.locator('.apps-button').getAttribute('aria-label');
  const state = (id) => window.locator(`.app-row[data-app="${id}"]`).getAttribute('data-state');
  const waitDot = (value) => window.waitForFunction((wanted) => document.querySelector('.apps-dot').dataset.dot === wanted, value);

  // App Link is off by default: the dot says so in its name, and the panel says so and offers to turn it on.
  await waitDot('off');
  assert.equal(await name(), 'Recon Towers apps: App Link is off');
  assert.equal(await window.locator('.apps-dot').getAttribute('aria-hidden'), 'true', 'the dot is never the only signal');
  await window.click('.apps-button');
  await window.waitForSelector('#apps-dialog[open]');
  assert.equal(await window.locator('#apps-off').isVisible(), true);
  assert.match(await window.innerText('#apps-off'), /App Link is off/);
  assert.deepEqual(await window.locator('#apps-dialog .app-row').evaluateAll((rows) => rows.map((row) => row.dataset.app)), ['rt-markdown-reader', 'rt-author-desk', 'rt-press', 'rt-audio-studio', 'recon-browser'], 'every suite app, from the shared list');
  for (const id of ['rt-markdown-reader', 'rt-author-desk', 'rt-press', 'rt-audio-studio', 'recon-browser']) {
    assert.equal(await state(id), 'missing');
    assert.match(await window.innerText(`.app-row[data-app="${id}"]`), /Not installed/);
  }
  await window.click('#apps-turn-on');
  await window.waitForSelector('#apps-off', { state: 'hidden' });
  await waitDot('grey');
  assert.equal(await name(), 'Recon Towers apps: No other app found');

  // "Get it" opens that app's page from the shared list and nothing else.
  await window.click('[aria-label="Get RT Press"]');
  await window.waitForFunction(() => true);
  const opened = await app.evaluate(() => globalThis.opened);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/recontowers\.com\//);
  assert.deepEqual(await window.locator('.app-row[data-app="rt-press"] button').allTextContents(), ['Get it']);

  // An app that's installed shows up when the panel looks, and not before: nothing is asked on a timer.
  fs.writeFileSync(path.join(shared, 'installed', 'rt-press.json'), JSON.stringify({ protocol: 1, id: 'rt-press', name: 'RT Press', version: '1.0.0', launch: process.execPath }));
  await new Promise((resolve) => { setTimeout(resolve, 1500); });
  assert.equal(await state('rt-press'), 'missing', 'not noticed until it’s looked for');
  assert.equal(await dot(), 'grey');
  await window.click('#apps-refresh');
  await window.waitForFunction(() => document.querySelector('.app-row[data-app="rt-press"]').dataset.state === 'installed');
  assert.match(await window.innerText('.app-row[data-app="rt-press"]'), /Installed, not running/);
  assert.deepEqual(await window.locator('.app-row[data-app="rt-press"] button').allTextContents(), ['Open']);
  await waitDot('amber');
  assert.equal(await name(), 'Recon Towers apps: Apps found, none linked');

  // A running app is found, and finding it links nothing. Linking asks once and turns the dot green.
  let links = {};
  const reader = new AppLink({
    folder: shared, dataDir: path.join(work, 'reader'), version: '3.12.0', id: 'rt-markdown-reader', name: 'RT Markdown Reader',
    load: () => ({ ...links }), save: (saved) => { links = saved; }, ask: async () => true, open: async () => {},
    status: () => ({ state: 'open', line: 'Reading “Notes”' }),
  });
  await reader.start();
  await window.click('#apps-refresh');
  await window.waitForFunction(() => document.querySelector('.app-row[data-app="rt-markdown-reader"]').dataset.state === 'found');
  assert.match(await window.innerText('.app-row[data-app="rt-markdown-reader"]'), /Found, not linked/);
  assert.deepEqual(links, {}, 'finding it linked nothing');
  assert.equal(await dot(), 'amber');
  await window.click('[aria-label="Link RT Markdown Reader"]');
  await window.waitForFunction(() => document.querySelector('.app-row[data-app="rt-markdown-reader"]').dataset.state === 'linked');
  assert.match(await window.innerText('.app-row[data-app="rt-markdown-reader"]'), /Linked/);
  assert.match(await window.innerText('.app-row[data-app="rt-markdown-reader"]'), /Reading “Notes”/, 'a linked app says what it’s doing');
  await waitDot('green');
  assert.equal(await name(), 'Recon Towers apps: An app is linked');
  await window.click('#apps-close');
  await window.waitForSelector('#apps-dialog', { state: 'detached' });
  assert.equal(await dot(), 'green', 'the dot stays right with the panel closed');

  // Remove the link and it's amber again; turn App Link off and it says so.
  await window.click('.apps-button');
  await window.waitForSelector('#apps-dialog[open]');
  await window.click('[aria-label="Remove the link to RT Markdown Reader"]');
  await waitDot('amber');
  await window.uncheck('#pref-link');
  await waitDot('off');
  assert.equal(await window.locator('#apps-off').isVisible(), true);
  assert.equal(await state('rt-markdown-reader'), 'missing', 'with App Link off nothing is looked for, so it isn’t seen running');
  assert.equal(await window.locator('[aria-label="Link RT Markdown Reader"]').count(), 0);
  await window.click('#apps-close');

  // The same panel is in Preferences.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'preferences'));
  await window.waitForSelector('#preferences[open] .app-row[data-app="rt-press"]');
  assert.match(await window.innerText('#preferences .app-row[data-app="rt-press"]'), /Installed, not running/);
  assert.deepEqual(errors, []);
  await reader.stop();
  await app.close();
  console.log('apps status e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
