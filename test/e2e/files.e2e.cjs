'use strict';
// The Files view in the real app, on about two thousand files brought in by Find my files: sections and counts, search, a few at a time,
// looking at a picture, a sound and a document, moving one or many to another section or book, making a chapter, a record and a cover,
// and nothing cut off at 1024 by 768 or at the smallest the app allows.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const docx = require('docx');
const tool = require('./tool.cjs');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-filesview-'));
const stories = path.join(work, 'My Stories');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ART = 1900;

// A real sound, a tenth of a second of silence, so the player has something it can open.
function wav() {
  const samples = 800;
  const data = Buffer.alloc(44 + samples);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples, 4);
  data.write('WAVEfmt ', 8);
  [[16, 16, 4], [20, 1, 2], [22, 1, 2], [24, 8000, 4], [28, 8000, 4], [32, 1, 2], [34, 8, 2]].forEach(([at, value, size]) => data.writeUIntLE(value, at, size));
  data.write('data', 36);
  data.writeUInt32LE(samples, 40);
  data.fill(128, 44);
  return data;
}

const write = (rel, content) => {
  const full = path.join(stories, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const word = (text) => docx.Packer.toBuffer(new docx.Document({ sections: [{ children: [new docx.Paragraph({ children: [new docx.TextRun(text)] })] }] }));
const unique = (text) => Buffer.concat([PNG, Buffer.from(text)]);

// Run in the page: what's wrong with how the Files view fits. An empty list means nothing is cut off.
function problems() {
  const found = [];
  const dialog = document.querySelector('#attachments');
  const box = dialog.getBoundingClientRect();
  if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) found.push('the window doesn’t fit');
  const parts = [document.documentElement, dialog, dialog.querySelector('.files-nav'), dialog.querySelector('.files-bulk'), dialog.querySelector('#attachment-list'), dialog.querySelector('.file-side')];
  for (const node of parts) if (node && !node.hidden && node.scrollWidth > node.clientWidth + 1) found.push(`sideways scrolling in ${node.id || node.className || node.tagName}`);
  const controls = [...dialog.querySelectorAll('.files-head input, .files-head select, .files-nav button, .files-bulk input, .files-bulk select, .files-bulk button, .files-foot button')];
  const firstRows = [...dialog.querySelectorAll('.attachment-row')].slice(0, 6);
  for (const node of [...controls, ...firstRows.flatMap((row) => [...row.children])]) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || node.disabled === undefined && node.tagName === 'SPAN' && !rect.height) continue;
    if (rect.left < box.left - 1 || rect.right > box.right + 1) found.push(`cut off at the side: ${node.id || node.getAttribute('aria-label') || node.className || node.tagName}`);
  }
  for (const node of dialog.querySelectorAll('.files-nav button, .files-foot button, .files-head input')) {
    const rect = node.getBoundingClientRect();
    if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1) found.push(`not on show: ${node.textContent || node.id}`);
  }
  const list = dialog.querySelector('#attachment-list').getBoundingClientRect();
  if (list.height < 150) found.push(`the list is only ${Math.round(list.height)}px high`);
  return found;
}

(async () => {
  write('Book_1_Ash/Chapter 1.docx', await word('Ash begins.'));
  write('Book_1_Ash/Chapter 2.docx', await word('Ash goes on.'));
  write('Book_2_Salt/Chapter 1.docx', await word('Salt begins.'));
  write('Book_2_Salt/Chapter 2.docx', await word('Salt goes on.'));
  write('Book_1_Ash/Covers/Front Cover.png', unique('front'));
  write('Book_1_Ash/Covers/Back Cover.png', unique('back'));
  write('Book_1_Ash/Reference/a very long picture name that goes on and on and on past any sensible width of a window.png', unique('long'));
  for (let at = 0; at < ART; at += 1) write(`Book_1_Ash/Art/sketch ${String(at).padStart(4, '0')}.png`, unique(`art ${at}`));
  write('Book_1_Ash/Audio/reading.wav', wav());
  write('Book_1_Ash/Notes/lost chapter.docx', await word('Words that were taken for notes.'));
  write('Book_1_Ash/Notes/Marit.txt', 'Marit keeps the ledger.');
  write('Book_1_Ash/Print/interior.pdf', '%PDF-1.4 not really');
  write('Book_1_Ash/mystery.bin', 'unknown');
  for (let at = 0; at < 30; at += 1) write(`Book_2_Salt/Reference/shore ${at}.png`, unique(`shore ${at}`));

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: path.join(work, 'profile'), NMR_LINK_DIR: path.join(work, 'shared'), RTST_WINDOW_SIZE: '1024x768' },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  window.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) errors.push(message.text()); });
  window.on('dialog', (dialog) => dialog.accept());
  await window.waitForSelector('body[data-state="ready"]');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, stories);

  await window.click('#find-files');
  await window.waitForSelector('#plan-tree', { timeout: 120000 });
  // Thousands of files in one section start closed, and open a hundred at a time.
  const artGroup = window.locator('.plan-section[data-section="art"]').first();
  assert.equal(await artGroup.locator('.plan-section-name').getAttribute('aria-expanded'), 'false');
  assert.equal(await artGroup.locator('li').count(), 0);
  await artGroup.locator('.plan-section-name').click();
  assert.equal(await artGroup.locator('select').count(), 100);
  await window.click('#plan-go');
  await window.waitForSelector('#report-total', { timeout: 300000 });
  await window.click('#report-close');
  await window.locator('#book-list .row', { hasText: 'Ash' }).click();

  const started = Date.now();
  await tool(window, '.attachments-button');
  await window.waitForSelector('#attachments[open] .attachment-row');
  const took = Date.now() - started;
  assert.ok(took < 5000, `the view opened in ${took}ms`);
  const count = async (section) => Number((await window.textContent(`.files-nav [data-section="${section}"] .files-count`)).replaceAll(',', ''));
  const rows = () => window.locator('.attachment-row').count();
  const pick = async (section) => window.click(`.files-nav [data-section="${section}"]`);
  const says = (text) => window.waitForFunction((wanted) => document.querySelector('#files-status').textContent.includes(wanted), text);
  const row = (name) => window.locator('.attachment-row', { has: window.locator(`.attachment-name span:text-is("${name}")`) });
  const find = async (text) => window.fill('#files-search', text);

  assert.deepEqual(
    [await count('cover'), await count('art'), await count('audio'), await count('notes'), await count('finished'), await count('other')],
    [1, ART + 1, 1, 2, 1, 1],
    'the front cover is the book’s, and the rest are sorted',
  );
  assert.equal(await rows(), 100, 'a hundred at a time');
  assert.match(await window.textContent('#files-more'), /Show 100 more of/);
  await window.click('#files-more');
  assert.equal(await rows(), 200);
  assert.deepEqual(await window.evaluate(problems), [], 'all files at 1024 by 768');
  // On a usual window each file is one line, so many can be seen at once.
  const tallest = await window.evaluate(() => Math.max(...[...document.querySelectorAll('.attachment-row')].slice(0, 40).map((node) => node.getBoundingClientRect().height)));
  assert.ok(tallest <= 62, `a file's row is ${tallest}px high`);
  const barRows = await window.evaluate(() => new Set([...document.querySelectorAll('.files-bulk > *')].map((node) => Math.round((node.getBoundingClientRect().top + node.getBoundingClientRect().bottom) / 20))).size);
  assert.equal(barRows, 1, 'and the actions for many files are on one line');
  // Only the pictures near the top have been read.
  await new Promise((resolve) => { setTimeout(resolve, 1200); });
  const read = await window.locator('img.attachment-thumb[src^="data:"]').count();
  assert.ok(read > 0 && read < 80, `${read} pictures read, not all of them`);
  assert.equal(await window.locator('.cover-row').count(), 1);

  // Looking: a picture, a sound that really loads, a document, and a file that can't be shown.
  await pick('cover');
  await window.click('[aria-label="Look at Back Cover.png"]');
  await window.waitForFunction(() => document.querySelector('.file-picture')?.naturalWidth > 0);
  assert.deepEqual(await window.evaluate(problems), [], 'with a picture open');
  await pick('audio');
  await window.click('[aria-label="Look at reading.wav"]');
  await window.waitForFunction(() => document.querySelector('audio.file-sound')?.duration > 0);
  await pick('notes');
  await window.click('[aria-label="Look at lost chapter.docx"]');
  await window.waitForFunction(() => document.querySelector('.file-text')?.textContent.includes('taken for notes'));
  await pick('other');
  assert.equal(await row('mystery.bin').locator('.file-look').count(), 0);

  // One file changes section.
  await row('mystery.bin').locator('.file-section').selectOption('notes');
  await says('mystery.bin is now under Notes.');
  assert.deepEqual([await count('other'), await count('notes')], [0, 3]);

  // Many at once: everything a search finds, to another section, then to another book.
  await pick('all');
  await find('sketch 00');
  assert.equal(await rows(), 100);
  assert.equal(await window.isDisabled('#bulk-section'), true, 'nothing is chosen yet');
  await window.check('#files-select-all');
  assert.match(await window.textContent('#files-selected'), /100 files selected/);
  await window.selectOption('#bulk-section', 'other');
  await says('100 files moved to Other files.');
  assert.equal(await count('other'), 100);
  await pick('other');
  await find('');
  await window.check('#files-select-all');
  const salt = await window.locator('#bulk-place option', { hasText: 'Salt' }).getAttribute('value');
  await window.selectOption('#bulk-place', salt);
  await says('100 files moved to “Salt”.');
  assert.equal(await count('other'), 0);
  assert.match(await window.textContent('#files-selected'), /0 files here/);
  // Choosing another section lets go of what was ticked, so an action can't reach a file that isn't on show.
  await pick('cover');
  await window.check('[aria-label="Select Back Cover.png"]');
  await pick('audio');
  assert.equal(await window.isDisabled('#bulk-trash'), true);

  // The whole project, then back.
  await window.selectOption('#files-scope', { label: 'In the whole project' });
  await window.waitForFunction(() => document.querySelector('.files-nav [data-section="art"] .files-count').textContent !== '0');
  assert.equal(await count('other'), 100);
  await window.selectOption('#files-scope', { index: 0 });
  await window.waitForFunction(() => document.querySelector('.files-nav [data-section="other"] .files-count').textContent === '0');

  // A picture becomes the cover, and the one it replaces is kept.
  await pick('cover');
  await row('Back Cover.png').locator('.file-more').selectOption('cover');
  await says('is now the cover of “Ash”');
  assert.equal(await count('cover'), 2);
  assert.equal(await row('Earlier cover.png').count(), 1);

  // Writing filed as notes becomes a chapter. The sidebar shows it, and the file is in the Trash.
  await pick('notes');
  await row('lost chapter.docx').locator('.file-more').selectOption('chapter');
  await window.waitForSelector('#file-where');
  assert.equal(await window.locator('#file-where option:checked').textContent(), 'Ash');
  assert.deepEqual(await window.evaluate(problems), [], 'while it asks where');
  await window.click('#file-where-go');
  await says('Made a chapter in “Ash” from lost chapter.docx');
  assert.equal(await row('lost chapter.docx').count(), 0);

  // A record needs a kind of record first.
  await row('Marit.txt').locator('.file-more').selectOption('record');
  await says('Make a kind of record first');
  await window.evaluate(() => window.storyTracker.createRecordType({ title: 'Character', fields: [] }));
  await row('Marit.txt').locator('.file-more').selectOption('record');
  await window.waitForSelector('#file-where');
  await window.click('#file-where-go');
  await says('Made the record “Marit” from Marit.txt');

  await row('mystery.bin').locator('.file-more').selectOption('trash');
  await says('mystery.bin is in the Trash.');

  // The smallest the app allows.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 560));
  await window.waitForFunction(() => innerWidth <= 900);
  await pick('all');
  await find('a very long picture name');
  assert.deepEqual(await window.evaluate(problems), [], 'a long name at 900 by 560');
  await window.click('.attachment-row .file-look');
  await window.waitForSelector('.file-picture');
  assert.deepEqual(await window.evaluate(problems), [], 'with a file open at 900 by 560');
  if (process.env.RTST_SHOTS) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
    await find('');
    await window.click('#file-side-close');
    await new Promise((resolve) => { setTimeout(resolve, 900); });
    await window.screenshot({ path: path.join(process.env.RTST_SHOTS, 'files.png') });
    await window.click('.attachment-row .file-look');
    await window.waitForSelector('.file-picture');
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    await window.screenshot({ path: path.join(process.env.RTST_SHOTS, 'files-look.png') });
  }

  await window.click('#attachments-close');
  await window.waitForSelector('#attachments', { state: 'detached' });
  assert.ok((await window.locator('#chapter-list .row', { hasText: 'lost chapter' }).count()) === 1, 'the new chapter is in the list');
  assert.deepEqual(errors, []);
  await app.close();
  console.log(`files e2e passed (${ART + 43} files; the view opened in ${took}ms)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
