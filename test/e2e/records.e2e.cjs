'use strict';
// Records in the real app: a template, a kind of our own with numbering, links both ways, @ in a chapter, looking a
// record up beside the page, a saved view, the Trash, and all of it still there after a restart.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-records-'));

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  return { app, window, errors };
};

const saved = (window) => window.waitForSelector('.record-page .save-state[data-state="saved"]', { timeout: 15000 });
const typeRow = (window, title) => window.locator('#type-list .row', { hasText: title });
const MOD = 'ControlOrMeta';

(async () => {
  let { app, window, errors } = await launch();
  window.on('dialog', (dialog) => dialog.accept());
  await window.fill('#new-title', 'Records Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');

  // The first time, Records offers ways to start.
  await window.click('#mode-records');
  await window.waitForSelector('.records-empty');
  assert.equal(await window.locator('.template-card').count(), 3);
  await window.click('.template-card[data-template="series"] .use-template');
  await window.waitForSelector('.record-browser');
  assert.deepEqual(await window.locator('#type-list .row-title').allTextContents(), ['Character', 'Place', 'Object', 'Group']);

  // Two characters. The first is named, given a choice and saved by itself.
  await window.click('#new-record');
  await window.waitForSelector('.record-page');
  await window.fill('.record-title', 'Marit Vance');
  await window.selectOption('.record-field[data-field] select', 'Main');
  await saved(window);
  await window.click('#records-back');
  await window.waitForSelector('.record-browser');
  await window.click('#new-record');
  await window.waitForSelector('.record-page');
  await window.fill('.record-title', 'Jon Reed');
  await saved(window);
  await window.click('#records-back');
  await window.waitForSelector('.record-row');
  assert.deepEqual(await window.locator('.record-row .name-cell').allTextContents(), ['Jon Reed', 'Marit Vance'], 'sorted by name');

  // A kind of our own: numbered, with a link to a character and a number.
  await window.click('#add-type');
  await window.waitForSelector('#type-dialog[open]');
  await window.fill('#type-name', 'Weapon');
  await window.fill('#type-dialog .field-item input[type="text"]', 'Owner');
  await window.selectOption('#type-dialog .field-item select', 'link');
  await window.locator('#type-dialog .field-extra select').selectOption({ label: 'Character' });
  await window.click('#add-field');
  await window.locator('#type-dialog .field-item').nth(1).locator('input[type="text"]').fill('Weight');
  await window.locator('#type-dialog .field-item').nth(1).locator('select').selectOption('number');
  await window.check('#numbering-on');
  await window.fill('#type-dialog input[aria-label="Prefix"]', 'W-');
  await window.click('#type-save');
  await window.waitForSelector('#type-dialog', { state: 'detached' });
  await window.waitForSelector('.browser-head h2:has-text("Weapon")');

  // A weapon gets the next free number, and links to its owner by typing a few letters.
  await window.click('#new-record');
  await window.waitForSelector('.record-page');
  assert.equal(await window.inputValue('.record-number'), 'W-001');
  await window.fill('.record-title', 'Dawn Blade');
  await window.fill('.record-field.kind-number input', '4.5');
  await window.click('.record-field.kind-link .chip-add');
  await window.fill('.record-picker .picker-input', 'mar');
  await window.waitForSelector('.record-picker .picker-row:has-text("Marit Vance")');
  await window.keyboard.press('Enter');
  await window.waitForSelector('.record-field.kind-link .chip:has-text("Marit Vance")');
  await saved(window);

  // The same number can't go on two records, and the message says who has it.
  await window.click('#records-back');
  await window.click('#new-record');
  await window.waitForSelector('.record-page');
  assert.equal(await window.inputValue('.record-number'), 'W-002');
  await window.fill('.record-number', 'W-001');
  await window.press('.record-number', 'Tab');
  await window.waitForSelector('#room-message:has-text("already used by “Dawn Blade”")');
  await saved(window);
  assert.equal(await window.inputValue('.record-number'), 'W-002', 'the number goes back to what it was');
  await window.fill('.record-title', 'Second Blade');
  await window.click('.next-number');
  assert.equal(await window.inputValue('.record-number'), 'W-003', 'W-002 is its own, so the next free one is W-003');
  await saved(window);

  // Following the link goes to the owner, who shows what points at them.
  await window.click('#records-back');
  await window.locator('.record-row', { hasText: 'Dawn Blade' }).click();
  await window.waitForSelector('.record-page .record-title');
  await window.click('.record-field.kind-link .chip-open');
  await window.waitForFunction(() => document.querySelector('.record-title')?.value === 'Marit Vance');
  await window.waitForSelector('.record-backlinks .backlink:has-text("Dawn Blade")');
  assert.match(await window.locator('.record-backlinks .backlink').first().innerText(), /Weapon · Owner/);
  await window.click('#records-back');
  await window.waitForFunction(() => document.querySelector('.record-title')?.value === 'Dawn Blade');

  // @ in a chapter links a record, and the name stays in the text as ordinary words.
  await window.click('#mode-write');
  await window.locator('.pane').first().locator('.ProseMirror').click();
  await window.keyboard.type('Today ');
  await window.keyboard.type('@Mar');
  await window.waitForSelector('.mention-pop .mention-row:has-text("Marit Vance")');
  await window.keyboard.press('Enter');
  await window.keyboard.type('went home.');
  await window.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('Marit Vance went home.'));
  assert.equal(await window.locator('.ProseMirror .mention-mark').first().innerText(), 'Marit Vance');
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });

  // Ctrl or Cmd and click on the name looks the record up beside the page, with the writing still open.
  await window.click('.ProseMirror .mention-mark', { modifiers: [MOD] });
  await window.waitForSelector('#lookup-panel .record-page');
  assert.equal(await window.inputValue('#lookup-panel .record-title'), 'Marit Vance');
  // The page is really there: wide enough to read, and nothing is on top of it, including the panel that was just opened. In a
  // narrow window (RTST_WINDOW_SIZE=900x600 is the smallest) it's the lists that step aside.
  const page = await window.locator('.page-text').first().boundingBox();
  const panel = await window.locator('#lookup-panel').boundingBox();
  assert.ok(page && page.width >= 300, `the page is at least 300 wide (it is ${page?.width})`);
  assert.ok(page.x + page.width <= panel.x + 1, 'the look-up panel is beside the page, not over it');
  assert.equal(await window.evaluate(() => {
    const box = document.querySelector('.page-text').getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 40));
    return Boolean(top?.closest('.page-text'));
  }), true, 'nothing covers the page');
  await window.click('#lookup-panel .lookup-head button[aria-label="Close the look-up panel"]');
  await window.waitForSelector('#lookup-panel', { state: 'hidden' });

  // The record knows which chapter it's in, and a click goes there.
  await window.click('#mode-records');
  await typeRow(window, 'Character').locator('.row-main').click();
  await window.locator('.record-row', { hasText: 'Marit Vance' }).click();
  await window.waitForSelector('.record-backlinks h4:has-text("Mentioned in chapters")');
  await window.click('.record-backlinks .backlink:has-text("Chapter 1")');
  await window.waitForSelector('#mode-write.active');
  await window.waitForSelector('.ProseMirror .mention-mark');

  // A view is a way of looking, saved with the kind.
  await window.click('#mode-records');
  await typeRow(window, 'Weapon').locator('.row-main').click();
  await window.waitForSelector('.record-table');
  await window.click('.filter-toggle');
  await window.click('.add-filter');
  await window.selectOption('.filter-row select[aria-label="Field"]', { label: 'Weight' });
  await window.selectOption('.filter-row select[aria-label="Test"]', 'more');
  await window.fill('.filter-row input[aria-label="Value"]', '1');
  await window.waitForFunction(() => document.querySelectorAll('.record-row').length === 1);
  assert.deepEqual(await window.locator('.record-row .name-cell').allTextContents(), ['Dawn Blade']);
  await window.click('.view-save-new');
  await window.fill('.view-name', 'Heavy ones');
  await window.press('.view-name', 'Enter');
  await window.waitForSelector('.view-tab.active:has-text("Heavy ones")');
  await window.click('.view-tab:has-text("All")');
  await window.waitForFunction(() => document.querySelectorAll('.record-row').length === 2);
  await window.click('.mode-button:has-text("Cards")');
  await window.waitForSelector('.record-card');
  assert.equal(await window.locator('.record-card').count(), 2);

  // The Trash gives it back, number and all.
  await window.click('.mode-button:has-text("Table")');
  await window.locator('.record-row', { hasText: 'Second Blade' }).click();
  await window.waitForSelector('.record-page');
  await window.click('.record-head button[aria-label$="to Trash"]');
  await window.waitForSelector('#message-action');
  await window.waitForFunction(() => document.querySelectorAll('.record-row').length === 1);
  await window.click('#message-action');
  await window.waitForFunction(() => document.querySelector('.record-title')?.value === 'Second Blade');
  assert.equal(await window.inputValue('.record-number'), 'W-003');

  // Everything is still there after a restart, including the view and the link.
  await window.click('#records-back');
  await app.close();
  ({ app, window, errors: errors } = await launch());
  await window.click('#mode-records');
  await window.waitForSelector('.record-browser');
  await typeRow(window, 'Weapon').locator('.row-main').click();
  await window.waitForSelector('.view-tab:has-text("Heavy ones")');
  await window.click('.view-tab:has-text("Heavy ones")');
  await window.waitForFunction(() => document.querySelectorAll('.record-row').length === 1);
  await window.locator('.record-row', { hasText: 'Dawn Blade' }).click();
  await window.waitForSelector('.record-field.kind-link .chip:has-text("Marit Vance")');
  assert.equal(await window.inputValue('.record-number'), 'W-001');
  assert.deepEqual(errors, [], 'the window raised no errors');
  await app.close();
  console.log('records e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
