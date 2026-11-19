'use strict';
// Versions of a record in the real app: a kind that keeps versions, an author-only field and notes, freezing for a book (which
// can't be undone), a correction, canon lock, and printing a PDF with the author-only part left out. The PDF is read back and
// searched, because a leak into the file is the thing that matters.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-versions-'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-versions-pdf-'));
const SECRET = 'ZZ-AUTHOR-ONLY-7731';

async function pdfText(file) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  const document = await loading.promise;
  let text = '';
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    text += `${(await page.getTextContent()).items.map((item) => item.str).join(' ')}\n`;
  }
  await loading.destroy();
  return text;
}

const saved = (window) => window.waitForSelector('.record-page .save-state[data-state="saved"]', { timeout: 15000 });

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
  window.on('dialog', (dialog) => dialog.accept());
  await window.fill('#new-title', 'Versions Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await window.click('#add-book');
  await window.waitForSelector('#book-list .row:nth-child(2)');
  await window.keyboard.press('Escape');

  // A kind that keeps versions. Rank is for print. The second field isn't, because a field is for the author alone until said.
  await window.click('#mode-records');
  await window.waitForSelector('.records-empty');
  await window.click('#own-type');
  await window.waitForSelector('#type-dialog[open]');
  await window.fill('#type-name', 'Character');
  await window.check('#versioning-on');
  await window.waitForSelector('#label-word');
  await window.locator('#type-dialog .field-item').first().locator('input[type="text"]').fill('Rank');
  await window.locator('#type-dialog .field-item').first().locator('.audience-pick').selectOption('print');
  await window.click('#add-field');
  await window.locator('#type-dialog .field-item').nth(1).locator('input[type="text"]').fill('Secret');
  assert.equal(await window.locator('#type-dialog .field-item').nth(1).locator('.audience-pick').inputValue(), 'author');
  await window.click('#type-save');
  await window.waitForSelector('#type-dialog', { state: 'detached' });

  await window.click('#new-record');
  await window.waitForSelector('.record-page');
  await window.fill('.record-title', 'Marit Vance');
  await window.fill('.record-field:has-text("Rank") input', 'Captain');
  await window.fill('.record-field:has-text("Secret") input', `${SECRET} did it`);
  assert.match(await window.innerText('.record-field:has-text("Secret")'), /author only/);
  assert.doesNotMatch(await window.innerText('.record-field:has-text("Rank")'), /author only/);
  await window.locator('.print-notes-host .ProseMirror').click();
  await window.keyboard.type('PRINT-OK a short biography.');
  await window.locator('.author-notes .ProseMirror').click();
  await window.keyboard.type(`${SECRET} author words.`);
  await saved(window);

  // Freezing names the book and warns it can't be undone. There is no way to unfreeze, anywhere.
  await window.click('#freeze-record');
  await window.waitForSelector('#freeze-dialog[open]');
  const sure = await window.innerText('#freeze-sure');
  assert.match(sure, /Freeze “Marit Vance” as Revision 1 for “Versions Test”/);
  assert.match(sure, /can never be changed or unfrozen/);
  await window.click('#freeze-confirm');
  await window.waitForSelector('.version-chip.frozen');
  assert.match(await window.innerText('.version-strip'), /Revision 1\s*· Versions Test · frozen\s*Revision 2 · draft/);
  assert.equal(await window.getByText(/unfreeze/i).count(), 0, 'nothing on the page offers to unfreeze');
  assert.equal(await window.getByRole('button', { name: /unfreeze|undo/i }).count(), 0);

  // The frozen version is read-only, and says so.
  await window.click('.version-chip.frozen');
  await window.waitForSelector('#frozen-banner');
  assert.match(await window.innerText('#frozen-banner'), /can’t be changed or unfrozen\. Fixes go in Revision 2/);
  assert.match(await window.innerText('#frozen-label'), /Revision 1/);
  assert.equal(await window.locator('.version-view :is(input, textarea, select)').count(), 0, 'nothing to type in');
  assert.equal(await window.locator('.version-view [contenteditable="true"]').count(), 0);

  // A mistake is written down against it, and the fix goes in the next revision.
  await window.click('#correct-version');
  await window.fill('#correction-note', 'The rank was wrong.');
  await window.click('#correction-save');
  await window.waitForSelector('.correction-count');
  assert.match(await window.innerText('.correction-count'), /1 correction waiting for this revision/);
  await window.fill('.record-field:has-text("Rank") input', 'Admiral');
  await saved(window);

  // Another book is Revision 2. The same book can't be used twice, and nothing changed means nothing to freeze.
  await window.click('#freeze-record');
  await window.waitForSelector('#freeze-dialog[open]');
  assert.deepEqual(await window.locator('#freeze-book option').allTextContents(), ['New book'], 'a book that has a version isn’t offered again');
  await window.click('#freeze-confirm');
  await window.waitForFunction(() => document.querySelectorAll('.version-chip.frozen').length === 2);
  await window.locator('.version-chip.frozen').nth(1).click();
  await window.waitForSelector('#frozen-banner');
  assert.match(await window.innerText('.version-view'), /Rank: “Captain” → “Admiral”/);
  assert.match(await window.innerText('.version-view'), /Corrects version 1: The rank was wrong\./);
  await window.click('#version-back');
  await window.waitForSelector('.record-title');
  await window.fill('.record-field:has-text("Rank") input', 'Commodore');
  await saved(window);
  await window.click('#freeze-record');
  await window.waitForSelector('#room-message:has-text("Every book already has a version")');

  // Canon lock: read-only until the author says yes.
  await window.check('#canon-lock');
  await window.waitForSelector('#edit-anyway');
  assert.equal(await window.locator('.record-title').isDisabled(), true);
  assert.equal(await window.locator('.record-field:has-text("Rank") input').isDisabled(), true);
  await window.click('#edit-anyway');
  await window.waitForFunction(() => !document.querySelector('.record-title').disabled);
  await window.fill('.record-field:has-text("Rank") input', 'Fleet Admiral');
  await saved(window);
  assert.match(await window.innerText('.lock-banner'), /stays locked/);

  // Print: the latest frozen version, with the label, and nothing for the author alone.
  const pdf = path.join(out, 'records.pdf');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, pdf);
  await window.click('.print-record');
  await window.waitForSelector('#print-records[open]');
  assert.match(await window.innerText('#print-records'), /fields marked author only, and your own notes, are left out/);
  await window.click('#print-save');
  await window.waitForSelector('#print-result:has-text("1 page")', { timeout: 30000 });
  const text = await pdfText(pdf);
  assert.match(text, /record · revision 2/i, 'the label says which revision');
  assert.match(text, /Marit Vance/);
  assert.match(text, /Rank/);
  assert.match(text, /Admiral/, 'the printable part is there');
  assert.doesNotMatch(text, /Commodore|Fleet/, 'a frozen version prints as it was frozen, not as it is being edited now');
  assert.match(text, /PRINT-OK a short biography/);
  assert.doesNotMatch(text, new RegExp(SECRET), 'the author-only part is not in the file');
  assert.doesNotMatch(text, /author words|did it|Secret/);
  assert.ok(fs.readFileSync(pdf).includes(Buffer.from('%PDF')));
  await window.click('#print-records button:has-text("Close")');

  // Everything is still there after a restart: the versions, the lock, and the author-only notes for the author.
  await app.close();
  const again = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile },
  });
  const second = await again.firstWindow();
  await second.waitForSelector('body[data-state="ready"]');
  await second.click('#mode-records');
  await second.waitForSelector('.record-browser');
  await second.locator('.record-row', { hasText: 'Marit Vance' }).click();
  await second.waitForSelector('.version-chip.frozen');
  assert.equal(await second.locator('.version-chip.frozen').count(), 2);
  assert.equal(await second.locator('#canon-lock').isChecked(), true);
  assert.match(await second.innerText('.author-notes .ProseMirror'), new RegExp(SECRET));
  assert.deepEqual(errors, []);
  await again.close();
  console.log('versions e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
