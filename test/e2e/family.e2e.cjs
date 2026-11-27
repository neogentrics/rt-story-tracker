'use strict';
// Looking like the rest of the family, in the real app: a bar across the top of the library with Preferences and the apps icon, the
// Reader's Help menu, About in the window with its links and Copy Version Details, and the Help Center and Shortcuts pages.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-family-'));

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: path.join(work, 'profile'), NMR_LINK_DIR: path.join(work, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await app.evaluate(({ clipboard, dialog, shell }) => {
    globalThis.opened = [];
    globalThis.copied = [];
    globalThis.boxes = [];
    shell.openExternal = async (url) => { globalThis.opened.push(url); };
    clipboard.writeText = (text) => { globalThis.copied.push(text); };
    dialog.showMessageBox = async (...args) => { globalThis.boxes.push(args.at(-1)); return { response: 0 }; };
  });
  // A menu item is clicked the way the menu would.
  const menu = (names) => app.evaluate(({ Menu }, path_) => {
    let items = Menu.getApplicationMenu().items;
    let item = null;
    for (const name of path_) {
      item = items.find((entry) => entry.label === name);
      items = item?.submenu?.items ?? [];
    }
    item.click();
  }, names);
  const labels = (name) => app.evaluate(({ Menu }, wanted) => Menu.getApplicationMenu().items.find((entry) => entry.label === wanted).submenu.items.map((item) => (item.type === 'separator' ? '-' : item.label)), name);

  // The library has a bar across the top, with Preferences, where the themes and fonts are, and the apps icon.
  await window.waitForSelector('.library-bar');
  assert.equal(await window.locator('#library-prefs').isVisible(), true);
  assert.equal(await window.locator('.library-bar .apps-button').isVisible(), true);
  assert.match(await window.locator('.library-bar .apps-button').getAttribute('aria-label'), /^Recon Towers apps: /);
  await window.click('#library-prefs');
  await window.waitForSelector('#preferences[open]');
  await window.click('#prefs-tab-appearance');
  const before = await window.evaluate(() => document.documentElement.dataset.theme);
  const options = await window.locator('#pref-theme option').evaluateAll((list) => list.map((option) => option.value));
  const other = options.find((value) => value !== before && value !== 'system');
  await window.selectOption('#pref-theme', other);
  assert.equal(await window.evaluate(() => document.documentElement.dataset.theme), other, 'a theme chosen from the library applies at once');
  assert.ok(await window.locator('#pref-ui-font, #pref-page-font, [id^="pref-"][id$="font"]').count() >= 1, 'and so are the fonts');
  await window.click('#pref-close');
  await window.click('.library-bar .apps-button');
  await window.waitForSelector('#apps-dialog[open]');
  await window.click('#apps-close');

  // The Help menu is the Reader's. On a Mac, About is where a Mac keeps it, in the app's own menu, and Help doesn't repeat it.
  const isMac = process.platform === 'darwin';
  const aboutLabel = `About RT Story Tracker ${version}`;
  const aboutItem = [isMac ? 'RT Story Tracker' : 'Help', aboutLabel];
  const help = ['Help Center', 'Keyboard Shortcuts', '-', 'Check for Updates…'];
  assert.deepEqual(await labels('Help'), isMac ? help : [...help, '-', aboutLabel]);
  if (isMac) assert.equal((await labels('RT Story Tracker'))[0], aboutLabel, 'About, with the version, opens the app menu');
  assert.equal((await labels('Edit')).includes('Find Next'), true);

  // About, in the window.
  await menu(aboutItem);
  await window.waitForSelector('#about-dialog[open]');
  assert.equal(await window.innerText('#about-title'), 'RT Story Tracker');
  assert.equal(await window.innerText('#about-version'), `Version ${version}`);
  assert.match(await window.innerText('#about-blurb'), /write a book/);
  assert.equal(await window.locator('#about-dialog .about-logo').isVisible(), true);
  assert.deepEqual(await window.locator('.about-links li a').allInnerTexts(), ['Website', 'What’s new in this version', 'Report a problem or suggest a feature', 'Source code']);
  assert.match(await window.innerText('#about-tech'), /^Electron \S+ · Chromium \S+ · Node \S+ · (Windows|macOS|Linux) /);
  assert.match(await window.innerText('#about-copyright'), /^© \d{4} Recon Towers\. All rights reserved\.$/);
  for (const [id, expected] of [
    ['website', 'https://recontowers.com/projects/storytracker/'],
    ['notes', `https://github.com/neogentrics/rt-story-tracker/releases/tag/v${version}`],
    ['issue', 'https://github.com/neogentrics/rt-story-tracker/issues/new'],
    ['source', 'https://github.com/neogentrics/rt-story-tracker'],
    ['license', 'https://github.com/neogentrics/rt-story-tracker/blob/master/LICENSE'],
    ['notices', 'https://github.com/neogentrics/rt-story-tracker/blob/master/THIRD_PARTY_NOTICES.md'],
  ]) {
    await window.click(`#about-${id}`);
    assert.equal((await app.evaluate(() => globalThis.opened)).at(-1), expected, id);
  }
  assert.equal(await window.locator('#about-dialog').evaluate((dialog) => dialog.open), true, 'following a link leaves it open');
  await window.click('#about-copy');
  await window.waitForSelector('#about-copied:has-text("Version details copied")');
  const copied = (await app.evaluate(() => globalThis.copied)).at(-1);
  assert.match(copied, new RegExp(`^RT Story Tracker ${version.replaceAll('.', '\\.')}\\nElectron \\S+ · Chromium \\S+ · Node \\S+\\n(Windows|macOS|Linux) `));
  for (const private_ of [os.hostname(), os.userInfo().username, os.homedir(), work]) assert.equal(copied.includes(private_), false, 'nothing about the person is copied');
  await window.click('#about-done');
  await window.waitForSelector('#about-dialog', { state: 'detached' });

  // Help Center and Keyboard Shortcuts are pages in the app. (F1 is the menu item's own key, which a test can't press: the unit test
  // checks it's on the item.)
  await menu(['Help', 'Help Center']);
  await window.waitForSelector('#help-dialog[open] #help-page');
  assert.ok((await window.locator('.help-topic').count()) >= 5);
  await window.click('#help-tab-shortcuts');
  await window.waitForSelector('#shortcuts-page kbd');
  assert.match(await window.innerText('#shortcuts-page'), /Export/);
  assert.ok((await window.locator('#shortcuts-page kbd').allInnerTexts()).some((text) => /^(Ctrl|Cmd)\+E$/.test(text)));
  await window.click('#help-done');
  await window.waitForSelector('#help-dialog', { state: 'detached' });
  await menu(['Help', 'Keyboard Shortcuts']);
  await window.waitForSelector('#help-dialog[open] #shortcuts-page');
  await window.keyboard.press('Escape');
  await window.waitForSelector('#help-dialog', { state: 'detached' });

  // Check for Updates still says something, in a box.
  await menu(['Help', 'Check for Updates…']);
  await new Promise((resolve) => { setTimeout(resolve, 800); });
  assert.ok((await app.evaluate(() => globalThis.boxes)).length >= 1);

  // The same menu works from inside a project.
  await window.fill('#new-title', 'Family Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  assert.equal(await window.locator('.room-header .apps-button').isVisible(), true);
  await menu(aboutItem);
  await window.waitForSelector('#about-dialog[open]');
  await window.click('#about-done');
  assert.deepEqual(errors, []);
  await app.close();
  console.log('family e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
