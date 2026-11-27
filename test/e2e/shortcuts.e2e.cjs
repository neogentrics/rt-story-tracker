'use strict';
// Changing keyboard shortcuts in the real app: the page, the keys it refuses, the real menu taking the new key, the menu's keys being off
// while the page listens and back afterwards however it stops, and the choice still there the next time. (A test can't press a native menu
// key, so it checks the key on the real menu item.)
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-shortcuts-'));
const profile = path.join(work, 'profile');

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: path.join(work, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  return { app, window, errors };
};

// The key on a real menu item, found by its label anywhere in the menu.
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

const clickMenu = (app, names) => app.evaluate(({ Menu }, route) => {
  let items = Menu.getApplicationMenu().items;
  let item = null;
  for (const name of route) {
    item = items.find((entry) => entry.label === name);
    items = item?.submenu?.items ?? [];
  }
  item.click();
}, names);

// The menu is built again in the main process, a moment after the page asks.
async function becomes(app, label, expected) {
  let found;
  for (let tries = 0; tries < 100; tries += 1) {
    found = await keyOn(app, label);
    if (found === expected) return;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  assert.equal(found, expected, `the key on ${label}`);
}

const mac = process.platform === 'darwin';
const MOD = mac ? 'Meta' : 'Control';
const WORD = mac ? 'Cmd' : 'Ctrl';

(async () => {
  let { app, window, errors } = await launch();
  const says = (text) => window.waitForFunction((wanted) => document.querySelector('#shortcut-message')?.textContent.includes(wanted), text);
  const shown = (id) => window.locator(`#shortcuts-page dd[data-shortcut="${id}"]`).evaluate((cell) => cell.previousElementSibling.textContent);
  const open = async () => {
    await clickMenu(app, ['Help', 'Keyboard Shortcuts']);
    await window.waitForSelector('#help-dialog[open] #shortcuts-page dd[data-shortcut]');
  };

  await open();
  assert.equal(await shown('exportBook'), `${WORD}+E`);
  assert.equal(await shown('trash'), 'No key');
  assert.equal(await window.locator('#shortcuts-reset-all').count(), 0, 'nothing to reset yet');
  assert.equal(await window.locator('[data-reset]').count(), 0);

  // While it listens the menu has no keys, so a key that's already taken reaches the page and runs nothing.
  await window.click('[data-change="exportBook"]');
  await says('Press the keys you want for Export');
  await becomes(app, 'Print…', null);
  await becomes(app, 'Export…', null);
  await window.keyboard.press(`${MOD}+p`);
  await says(`${WORD}+P is already Print.`);
  await window.keyboard.press(`${MOD}+c`);
  await says('is for copying and can’t be changed.');
  await window.keyboard.press(`${MOD}+Shift+B`);
  await says('is for quoting and can’t be changed.');
  await window.keyboard.press('j');
  await says('get in the way of typing');
  assert.equal(await shown('exportBook'), 'Press the keys…', 'a refused key leaves it listening');

  await window.keyboard.press(`${MOD}+j`);
  await says(`Export is now ${WORD}+J.`);
  assert.equal(await shown('exportBook'), `${WORD}+J`);
  await becomes(app, 'Export…', 'CmdOrCtrl+J');
  await becomes(app, 'Print…', 'CmdOrCtrl+P');
  assert.equal(await window.evaluate(() => document.activeElement?.dataset.change), 'exportBook', 'focus stays on the command just changed');

  // The key it left is free now, and the whole thing works from the keyboard.
  await window.focus('[data-change="trash"]');
  await window.keyboard.press('Enter');
  await says('Press the keys you want for Trash');
  await window.keyboard.press(`${MOD}+e`);
  await says(`Trash is now ${WORD}+E.`);
  await becomes(app, 'Trash', 'CmdOrCtrl+E');

  // Escape stops listening and leaves the window open. A second Escape closes it.
  await window.click('[data-change="find"]');
  await becomes(app, 'Find…', null);
  await window.keyboard.press('Escape');
  await says('Left Find as it was.');
  assert.equal(await window.locator('#help-dialog[open]').count(), 1);
  await becomes(app, 'Find…', 'CmdOrCtrl+F');
  await window.keyboard.press('Escape');
  await window.waitForSelector('#help-dialog', { state: 'detached' });

  // Leaving by any other way gives the menu its keys back too: Done, the other tab, and a menu item clicked with the mouse.
  for (const leave of [
    () => window.click('#help-done'),
    () => window.click('#help-tab-center'),
    () => clickMenu(app, ['Help', 'Help Center']),
  ]) {
    await open();
    await window.click('[data-change="find"]');
    await becomes(app, 'Find…', null);
    await leave();
    await becomes(app, 'Find…', 'CmdOrCtrl+F');
    await becomes(app, 'Export…', 'CmdOrCtrl+J');
    if (await window.locator('#help-done').count()) await window.click('#help-done');
    await window.waitForSelector('#help-dialog', { state: 'detached' });
  }
  // Another window that opens on top, as when a document arrives from another app, gets its own typing, and the menu gets its keys back.
  await open();
  await window.click('[data-change="find"]');
  await becomes(app, 'Find…', null);
  await window.evaluate(() => {
    const over = Object.assign(document.createElement('dialog'), { id: 'on-top' });
    over.append(Object.assign(document.createElement('input'), { id: 'on-top-field' }));
    document.body.append(over);
    over.showModal();
  });
  await window.focus('#on-top-field');
  await window.keyboard.type('hello');
  assert.equal(await window.inputValue('#on-top-field'), 'hello', 'the keys went where they were typed');
  await becomes(app, 'Find…', 'CmdOrCtrl+F');
  await window.evaluate(() => document.querySelector('#on-top').remove());
  assert.equal(await shown('find'), `${WORD}+F`);
  await window.click('#help-done');
  await window.waitForSelector('#help-dialog', { state: 'detached' });

  // The page no longer takes keys once it has stopped listening.
  await window.fill('#new-title', 'Typed after');
  await window.focus('#new-title');
  await window.keyboard.press('End');
  await window.keyboard.type(' j');
  assert.equal(await window.inputValue('#new-title'), 'Typed after j');
  assert.deepEqual(errors, []);
  await app.close();

  // The choice is still there the next time, in the menu and on the page.
  ({ app, window, errors } = await launch());
  await becomes(app, 'Export…', 'CmdOrCtrl+J');
  await becomes(app, 'Trash', 'CmdOrCtrl+E');
  await open();
  assert.equal(await shown('exportBook'), `${WORD}+J`);

  // Reset puts one back.
  await window.click('[data-reset="trash"]');
  await says('Trash is back to no key.');
  await becomes(app, 'Trash', null);
  await window.click('[data-reset="exportBook"]');
  await says(`Export is back to ${WORD}+E.`);
  await becomes(app, 'Export…', 'CmdOrCtrl+E');
  assert.equal(await window.locator('#shortcuts-reset-all').count(), 0);

  // A reset that would give one key to two commands is refused.
  await window.click('[data-change="exportBook"]');
  await window.keyboard.press(`${MOD}+j`);
  await says(`Export is now ${WORD}+J.`);
  await window.click('[data-change="trash"]');
  await window.keyboard.press(`${MOD}+e`);
  await says(`Trash is now ${WORD}+E.`);
  await window.click('[data-reset="exportBook"]');
  await says(`${WORD}+E is already Trash.`);
  assert.equal(await shown('exportBook'), `${WORD}+J`);

  await window.click('#shortcuts-reset-all');
  await says('Every shortcut is back to its standard key.');
  await becomes(app, 'Export…', 'CmdOrCtrl+E');
  await becomes(app, 'Trash', null);
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'library', 'settings.json'), 'utf8'));
  assert.deepEqual(saved.shortcuts, {});
  assert.deepEqual(errors, []);
  await app.close();
  console.log('shortcuts e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
