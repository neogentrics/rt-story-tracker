'use strict';
// The Preferences window in the real app. At 1024 by 768, and at the smallest size the app allows, no section is cut off and nothing needs
// sideways scrolling, even with a very long folder name and word. Every setting is in a section, the keyboard moves through the sections,
// and the two things in General (reopening the last project, and updates) do what they say.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-preferences-'));

// Each section, in order, and the settings that have to be in it.
const SECTIONS = [
  ['general', 'General', ['#pref-reopen', '#pref-check-updates', '#pref-releases']],
  ['appearance', 'Appearance', ['#pref-theme', '#pref-glass', '#pref-page-font', '#pref-ui-font', '#pref-text-size', '#pref-page-width']],
  ['editing', 'Editing', ['#pref-spellcheck', '#new-word', '#dictionary-words']],
  ['backups', 'Backups', ['#backup-folder', '#backup-choose', '#pref-backup-every', '#pref-backup-keep', '#backup-now', '#backup-note']],
  ['lock', 'Password lock', ['#pref-lock-after']],
  ['apps', 'Linked Apps', ['#pref-link', '#linked-apps', '#apps-refresh']],
  ['shortcuts', 'Shortcuts', ['#shortcuts-page', '[data-change="exportBook"]', '[data-change="shortcuts"]']],
];

const launch = async (size, profile) => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: path.join(work, profile), NMR_LINK_DIR: path.join(work, 'shared'), RTST_WINDOW_SIZE: size },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  await app.evaluate(({ dialog, shell }) => {
    globalThis.opened = [];
    globalThis.boxes = [];
    shell.openExternal = async (url) => { globalThis.opened.push(url); };
    dialog.showMessageBox = async (...args) => { globalThis.boxes.push(args.at(-1)); return { response: 0 }; };
  });
  return { app, window, errors };
};

const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);

const keyOn = (app, label) => app.evaluate(({ Menu }, wanted) => {
  const find = (items) => {
    for (const item of items) {
      if (item.label === wanted) return item;
      const inside = item.submenu && find(item.submenu.items);
      if (inside) return inside;
    }
    return null;
  };
  return find(Menu.getApplicationMenu().items).accelerator ?? null;
}, label);

async function becomes(app, label, expected) {
  let found;
  for (let tries = 0; tries < 100; tries += 1) {
    found = await keyOn(app, label);
    if (found === expected) return;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  assert.equal(found, expected, `the key on ${label}`);
}

// Run in the page: everything that's wrong with how the open section fits. An empty list means nothing is cut off.
function problems() {
  const found = [];
  const dialog = document.querySelector('#preferences');
  const scroller = dialog.querySelector('.prefs-panes');
  const nav = dialog.querySelector('.prefs-nav');
  const pane = [...dialog.querySelectorAll('.prefs-pane')].find((one) => !one.hidden);
  const name = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).join('.')}` : ''}`;
  const within = (node, box, what) => {
    const rect = node.getBoundingClientRect();
    if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) found.push(`${what}: ${name(node)} doesn’t fit`);
  };
  const screen = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  within(dialog, screen, 'the window');
  for (const node of dialog.querySelectorAll('[role="tab"], #pref-close, #prefs-help, #prefs-x, .prefs-head h2')) within(node, dialog.getBoundingClientRect(), 'always on show');
  if (nav.scrollHeight > nav.clientHeight + 1 || nav.scrollWidth > nav.clientWidth + 1) found.push('the list of sections needs scrolling');
  for (const node of [document.documentElement, dialog, scroller, pane]) {
    if (node.scrollWidth > node.clientWidth + 1) found.push(`sideways scrolling: ${name(node)} is ${node.scrollWidth} wide in ${node.clientWidth}`);
  }
  const left = scroller.getBoundingClientRect().left;
  const right = left + scroller.clientWidth;
  for (const node of pane.querySelectorAll('*')) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (rect.left < left - 1 || rect.right > right + 1) found.push(`cut off at the side: ${name(node)}`);
    const style = getComputedStyle(node);
    if (!['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(node.tagName) && style.overflowX !== 'visible' && node.scrollWidth > node.clientWidth + 1) found.push(`clipped or scrolling inside: ${name(node)}`);
  }
  // Down to the bottom: the last thing in the section can be brought fully into view.
  scroller.scrollTop = scroller.scrollHeight;
  const box = scroller.getBoundingClientRect();
  const shown = [...pane.querySelectorAll('*')].filter((node) => node.getBoundingClientRect().height > 0);
  const lowest = Math.max(...shown.map((node) => node.getBoundingClientRect().bottom));
  if (lowest > box.bottom + 1) found.push(`the bottom of the section can’t be reached (${Math.round(lowest - box.bottom)}px short)`);
  scroller.scrollTop = 0;
  return found;
}

const openSection = async (window, id) => {
  await window.click(`#prefs-tab-${id}`);
  if (id === 'apps') await window.waitForSelector('#linked-apps .app-row');
  if (id === 'shortcuts') await window.waitForSelector('#shortcuts-page dd[data-shortcut]');
};

(async () => {
  const longFolder = path.join(work, 'a-folder-with-a-very-long-name-indeed'.repeat(3), 'Backups-of-every-project-kept-for-a-long-time'.repeat(2));
  fs.mkdirSync(longFolder, { recursive: true });

  for (const size of ['1024x768', '900x560']) {
    const { app, window, errors } = await launch(size, `fit-${size}`);
    const [width] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    assert.equal(width, Number(size.split('x')[0]), `the app window is ${size}`);
    await window.evaluate((folder) => window.storyTracker.saveSettings({ backupFolder: folder }), longFolder);
    await window.evaluate(() => window.storyTracker.addWord('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogochllanfairpwllgwyngyll'));
    await menu(app, 'preferences');
    await window.waitForSelector('#preferences[open]');

    assert.deepEqual(await window.locator('.prefs-nav [role="tab"]').allTextContents(), SECTIONS.map(([, label]) => label));
    const box = await window.locator('#preferences').boundingBox();
    assert.ok(box.width <= 900 && box.height <= 640, 'no bigger than about 900 by 640');
    assert.ok(box.width >= Math.min(900, (await window.evaluate(() => innerWidth)) - 60), 'and sized to the app window');

    // The check has to catch what it's for: something too wide in a section.
    await window.evaluate(() => document.querySelector('#prefs-pane-general').insertAdjacentHTML('beforeend', '<div id="probe" style="width:1400px;height:10px"></div>'));
    assert.ok((await window.evaluate(problems)).some((line) => line.includes('sideways')), 'the check sees sideways scrolling');
    await window.evaluate(() => document.querySelector('#probe').remove());

    for (const [id, label, settings] of SECTIONS) {
      await openSection(window, id);
      assert.equal(await window.getAttribute(`#prefs-tab-${id}`, 'aria-selected'), 'true');
      assert.equal(await window.locator('.prefs-pane:visible').count(), 1, 'one section at a time');
      assert.equal(await window.innerText('.prefs-pane:visible h3'), label);
      for (const setting of settings) assert.equal(await window.locator(`#prefs-pane-${id} ${setting}`).count(), 1, `${setting} is in ${label}`);
      assert.deepEqual(await window.evaluate(problems), [], `${label} at ${size}`);
    }
    // With App Link on there are more buttons in Linked Apps, and it still fits.
    await openSection(window, 'apps');
    await window.check('#pref-link');
    await window.waitForSelector('#apps-off', { state: 'hidden' });
    assert.deepEqual(await window.evaluate(problems), [], `Linked Apps with App Link on at ${size}`);
    await window.uncheck('#pref-link');
    await window.click('#pref-close');
    await window.waitForSelector('#preferences', { state: 'detached' });
    assert.deepEqual(errors, []);
    await app.close();
  }

  // The window follows the app window as it's resized.
  let { app, window, errors } = await launch('1280x820', 'work');
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  const wide = await window.locator('#preferences').boundingBox();
  assert.deepEqual([Math.round(wide.width), Math.round(wide.height)], [900, 640]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 560));
  await window.waitForFunction(() => document.querySelector('#preferences').getBoundingClientRect().width < 900);
  assert.deepEqual(await window.evaluate(problems), []);

  // It opens on General, with the focus in the list, and the arrow keys move through the sections.
  const focused = () => window.evaluate(() => document.activeElement?.id);
  assert.equal(await focused(), 'prefs-tab-general');
  await window.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'prefs-tab-appearance');
  assert.equal(await window.locator('#prefs-pane-appearance').isVisible(), true);
  await window.keyboard.press('End');
  assert.equal(await focused(), 'prefs-tab-shortcuts');
  await window.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'prefs-tab-general', 'and round again');

  // General: updates.
  await window.click('#pref-releases');
  await window.click('#pref-check-updates');
  for (let tries = 0; tries < 100 && !(await app.evaluate(() => globalThis.boxes.length)); tries += 1) await new Promise((resolve) => { setTimeout(resolve, 50); });
  assert.equal((await app.evaluate(() => globalThis.opened)).at(-1), 'https://github.com/neogentrics/rt-story-tracker/releases');
  assert.equal((await app.evaluate(() => globalThis.boxes)).at(-1).title, 'Check for Updates');

  // Shortcuts can be changed here, and leaving the section, or the window, stops it listening.
  await openSection(window, 'shortcuts');
  await window.click('[data-change="exportBook"]');
  await becomes(app, 'Print…', null);
  await window.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+j`);
  await becomes(app, 'Export…', 'CmdOrCtrl+J');
  await window.click('#shortcuts-reset-all');
  await becomes(app, 'Export…', 'CmdOrCtrl+E');
  for (const leave of [() => window.click('#prefs-tab-general'), () => window.click('#pref-close')]) {
    if (!(await window.locator('#preferences[open]').count())) await menu(app, 'preferences');
    await openSection(window, 'shortcuts');
    await window.click('[data-change="find"]');
    await becomes(app, 'Find…', null);
    await leave();
    await becomes(app, 'Find…', 'CmdOrCtrl+F');
  }
  // Escape while it listens leaves Preferences open.
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  await openSection(window, 'shortcuts');
  await window.click('[data-change="find"]');
  await becomes(app, 'Find…', null);
  await window.keyboard.press('Escape');
  await becomes(app, 'Find…', 'CmdOrCtrl+F');
  assert.equal(await window.locator('#preferences[open]').count(), 1);

  // Keyboard Shortcuts from Help is the same editor, and only one of the two windows is open, so neither can hold old keys.
  await menu(app, 'shortcuts');
  await window.waitForSelector('#help-dialog[open] #shortcuts-page dd[data-shortcut]');
  assert.deepEqual([await window.locator('#preferences').count(), await window.locator('#shortcuts-page').count()], [0, 1]);
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  assert.equal(await window.locator('#help-dialog').count(), 0);

  // Help Center, bottom left.
  await window.click('#prefs-help');
  await window.waitForSelector('#help-dialog[open] #help-page');
  assert.equal(await window.locator('#preferences').count(), 0);
  await window.click('#help-done');

  // General: reopening the last project. It's on to begin with, and off means the library.
  await window.fill('#new-title', 'Reopen Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  assert.deepEqual(errors, []);
  await app.close();
  ({ app, window, errors } = await launch('1024x768', 'work'));
  await window.waitForSelector('.ProseMirror');
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  assert.equal(await window.isChecked('#pref-reopen'), true);
  await window.uncheck('#pref-reopen');
  await window.click('#pref-close');
  await app.close();
  ({ app, window, errors } = await launch('1024x768', 'work'));
  await window.waitForSelector('.project-row');
  assert.equal(await window.locator('.ProseMirror').count(), 0, 'it starts in the library');
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  assert.equal(await window.isChecked('#pref-reopen'), false);
  assert.deepEqual(errors, []);
  await app.close();
  console.log('preferences e2e passed (7 sections at 1024x768 and 900x560)');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
