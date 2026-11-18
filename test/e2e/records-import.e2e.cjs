'use strict';
// Bringing records in, in the real app: a folder of Markdown files into a kind made from them, then a spreadsheet into
// that kind, with the author seeing where each column goes first.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recimport-'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recfiles-'));
fs.mkdirSync(path.join(folder, 'notes'));
fs.writeFileSync(path.join(folder, 'one.md'), '# Ada Quill\n\n**Role:** Healer\nAge: 40\n\nShe tends the harbour clinic.\n');
fs.writeFileSync(path.join(folder, 'notes', 'two.md'), '# Bram Tull\n\nRole: Smith\nAge: 52\n\n## History\n\nHe forged the gate.\n');
const sheet = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recsheet-')), 'more.csv');
fs.writeFileSync(sheet, 'Name,Role,Age\nCora Pell,Healer,33\nAda Quill,Thief,99\n');

const answer = (app, files) => app.evaluate(({ dialog }, paths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
}, files);

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  await window.fill('#new-title', 'Import Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await window.click('#mode-records');
  await window.waitForSelector('.records-empty');

  // A folder, with a folder inside it, into a new kind of record. The Role and Age lines become fields.
  await window.click('#empty-bring-in');
  await window.waitForSelector('#records-import[open]');
  await answer(app, [folder]);
  await window.click('#import-choose-folder');
  await window.waitForSelector('.import-table');
  assert.match(await window.innerText('#import-summary'), /Markdown: 2 records from 2 files/);
  assert.deepEqual(await window.locator('.import-table tbody th').allTextContents(), ['Role', 'Age']);
  await window.fill('#import-new-name', 'Character');
  await window.click('#import-run');
  await window.waitForSelector('#import-result');
  assert.match(await window.innerText('#import-result'), /2 made/);
  await window.click('#import-done');
  await window.waitForSelector('.record-table');
  assert.deepEqual(await window.locator('.record-row .name-cell').allTextContents(), ['Ada Quill', 'Bram Tull']);
  assert.deepEqual(await window.locator('.record-table thead th').allTextContents(), ['Name ↑', 'Role', 'Age'], 'sorted by name, with the arrow showing it');
  assert.deepEqual(await window.locator('.record-row').first().locator('td').allTextContents(), ['Ada Quill', 'Healer', '40']);

  // The notes kept what wasn't a field, and not what was.
  await window.locator('.record-row', { hasText: 'Bram Tull' }).click();
  await window.waitForSelector('.record-notes-text');
  const notes = await window.innerText('.record-notes-text');
  assert.ok(notes.includes('He forged the gate.') && notes.includes('History'));
  assert.ok(!notes.includes('Smith'));
  await window.click('#records-back');

  // A spreadsheet into the same kind. A name that's already there is left alone.
  await window.click('#import-records');
  await window.waitForSelector('#records-import[open]');
  await answer(app, [sheet]);
  await window.click('#import-choose-files');
  await window.waitForSelector('.import-table');
  assert.equal(await window.inputValue('select[data-label="Name"]'), '@name');
  assert.deepEqual(await window.locator('.import-table tbody th').allTextContents(), ['Name', 'Role', 'Age']);
  await window.click('#import-run');
  await window.waitForSelector('#import-result');
  assert.match(await window.innerText('#import-result'), /1 made, 1 left alone/);
  await window.click('#import-done');
  await window.waitForFunction(() => document.querySelectorAll('.record-row').length === 3);
  assert.deepEqual(await window.locator('.record-row').first().locator('td').allTextContents(), ['Ada Quill', 'Healer', '40'], 'Ada was not changed');
  assert.deepEqual(errors, []);
  await app.close();
  console.log('records import e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
