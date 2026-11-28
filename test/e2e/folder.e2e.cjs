'use strict';
// Find my files in the real app, from the library screen to the report, with a made-up folder of stories.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const docx = require('docx');
const { FolderImport } = require('../../src/main/folder');
const { Library } = require('../../src/main/storage/library');
const { Workspace } = require('../../src/main/workspace');
const tool = require('./tool.cjs');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-folder-'));
const stories = path.join(work, 'My Stories');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const write = (rel, content) => {
  const full = path.join(stories, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const word = (text) => docx.Packer.toBuffer(new docx.Document({ sections: [{ children: [new docx.Paragraph({ children: [new docx.TextRun(text)] })] }] }));
const answer = (app, value) => app.evaluate(({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
}, value);

// Issue 50. A project with an unfinished run arrives from another computer. It names a folder, which is here too, but nobody on this
// computer chose it: the app mustn't read it on the project's word.
async function pickUpElsewhere() {
  const profile = path.join(work, 'another computer');
  const space = new Workspace(new Library(path.join(profile, 'library')));
  space.createProject('Brought over');
  const elsewhere = new FolderImport();
  await elsewhere.scan(space, stories, () => {});
  assert.equal((await elsewhere.run(space, () => elsewhere.stop())).finished, false);
  space.closeProject();

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  await app.evaluate(({ dialog }) => {
    global.asked = [];
    global.answer = null;
    dialog.showOpenDialog = async (_window, options) => {
      global.asked.push(options);
      return { canceled: !global.answer, filePaths: global.answer ? [global.answer] : [] };
    };
  });
  const folderAnswer = (value) => app.evaluate((_electron, folder) => { global.answer = folder; }, value);
  const findFiles = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'find-files'));

  await window.locator('.project-row', { hasText: 'Brought over' }).locator('button').first().click();
  await window.waitForSelector('#chapter-list');
  await findFiles();
  await window.waitForSelector('#resume-note');
  assert.match(await window.textContent('#resume-note'), /hasn’t been chosen on this computer/);
  assert.equal(await window.locator('#resume-go').count(), 0, 'there’s nothing to pick up until the folder is chosen');
  assert.equal(await window.locator('#resume-error').isVisible(), false);
  assert.equal(await window.textContent('#find-files-dialog .dialog-actions'), 'Forget itChoose the folder');

  // It all fits a small window, however long the folder's path is.
  for (const size of [{ width: 640, height: 480 }, { width: 800, height: 600 }]) {
    await window.setViewportSize(size);
    for (const selector of ['#resume-note', '#resume-choose', '#resume-drop']) {
      const box = await window.locator(selector).boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 0.5 && box.y + box.height <= size.height + 0.5, `${selector} at ${size.width}x${size.height}: ${JSON.stringify(box)}`);
    }
  }

  // Cancelling the system's window changes nothing. Its starting place is never the folder the project names.
  await window.click('#resume-choose');
  await app.evaluate(() => new Promise((done) => { setTimeout(done, 200); }));
  const asked = await app.evaluate(() => global.asked);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].defaultPath, undefined);
  assert.equal(await window.locator('#resume-choose').isVisible(), true);

  // Another folder isn't taken, and the app says why.
  const other = fs.mkdtempSync(path.join(work, 'other-'));
  fs.writeFileSync(path.join(other, 'Thumbs.db'), 'noise');
  await folderAnswer(other);
  await window.click('#resume-choose');
  await window.waitForSelector('#resume-error:not([hidden])');
  assert.match(await window.textContent('#resume-error'), /Most of the files that import was reading aren’t there/);

  await folderAnswer(stories);
  await window.click('#resume-choose');
  await window.waitForSelector('#report-total', { timeout: 60000 });
  assert.match(await window.textContent('#report-total'), /All 10 files accounted for/);
  assert.doesNotMatch(await window.textContent('#report-groups'), /Gone before/);
  await window.click('#report-close');
  assert.deepEqual(errors, []);
  await app.close();
}

(async () => {
  write('Series_The_Long_Road/Book_1_Ash/Chapter 1.docx', await word('Older words here.'));
  write('Series_The_Long_Road/Book_1_Ash/Chapter 1 v2.docx', await word('Newer words here.'));
  write('Series_The_Long_Road/Book_1_Ash/Chapter 2.docx', await word('The second chapter.'));
  write('Series_The_Long_Road/Book_1_Ash/Something Else.docx', await word('Who knows.'));
  write('Series_The_Long_Road/Book_1_Ash/Covers/Front Cover.png', PNG);
  write('Series_The_Long_Road/Book_1_Ash/Art/map.png', Buffer.concat([PNG, PNG]));
  write('Series_The_Long_Road/Book_2_Salt/Chapter 1.docx', await word('Salt begins.'));
  write('Series_The_Long_Road/Book_2_Salt/Chapter 9.docx', await word('This one moves.'));
  write('Unwanted/Chapter 1.docx', await word('Leave this out.'));
  write('Thumbs.db', 'noise');

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: path.join(work, 'profile') },
  });
  const window = await app.firstWindow();
  await window.waitForSelector('body[data-state="ready"]');
  await answer(app, stories);

  // From the library screen: the project is named after the folder, and the plan appears.
  await window.click('#find-files');
  await window.waitForSelector('#plan-tree');
  assert.match(await window.textContent('#plan-summary'), /10 files/);
  assert.match(await window.textContent('#plan-summary'), /never touched/);
  assert.match(await window.textContent('#plan-tree'), /The Long Road/);
  assert.match(await window.textContent('#plan-tree'), /1 earlier version/);

  // What's kept is grouped by section, each file says where it will go, and that can be changed.
  assert.match(await window.textContent('#plan-summary'), /3 files to keep \(Covers 1, Art 1, Notes 1\)/);
  const map = window.locator('[aria-label="What to do with map.png"]');
  assert.equal(await map.inputValue(), 'art');
  assert.equal(await window.locator('.plan-section[data-section="art"] .plan-section-name').getAttribute('aria-expanded'), 'true');
  await map.selectOption('notes');
  await window.waitForSelector('.plan-section[data-section="notes"] [aria-label="What to do with map.png"]');
  assert.equal(await window.locator('.plan-section[data-section="art"]').count(), 0);
  await window.locator('.plan-section[data-section="notes"] .plan-section-name').click();
  await window.waitForSelector('[aria-label="What to do with map.png"]', { state: 'detached' });
  await window.locator('.plan-section[data-section="notes"] .plan-section-name').click();
  await window.locator('[aria-label="What to do with map.png"]').selectOption('art');
  await window.waitForSelector('.plan-section[data-section="art"]');

  // Ask me: the unsure file is a chapter.
  await window.locator('.ask-card[data-ask="unsure"] label', { hasText: 'They’re chapters' }).locator('input').check();
  await window.waitForFunction(() => document.querySelector('#plan-tree').textContent.includes('Something Else'));

  // Rename a book, leave one out, and drag a chapter to another book.
  await window.locator('.plan-row.book .plan-title', { hasText: 'Salt' }).dblclick();
  await window.fill('[aria-label="New title for Salt"]', 'Salt and Stone');
  await window.keyboard.press('Enter');
  await window.waitForFunction(() => document.querySelector('#plan-tree').textContent.includes('Salt and Stone'));
  await window.click('[aria-label="Leave out Unwanted"]');
  await window.waitForFunction(() => !document.querySelector('#plan-tree').textContent.includes('Unwanted'));
  await window.locator('.plan-row.chapter', { hasText: 'Chapter 9' }).dragTo(window.locator('.plan-row.book', { hasText: 'Ash' }));
  await window.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#plan-tree .plan-row')].map((row) => row.textContent);
    return rows.findIndex((text) => text.includes('Chapter 9')) < rows.findIndex((text) => text.includes('Salt and Stone'));
  });

  await window.click('#plan-go');
  await window.waitForSelector('#report-total');
  assert.match(await window.textContent('#report-total'), /All 10 files accounted for/);
  assert.match(await window.textContent('#report-groups'), /Left out: 2/);
  await window.click('#report-close');

  // What came in is ordinary writing.
  await window.locator('#book-list .row', { hasText: 'Ash' }).click();
  await window.locator('#chapter-list .row', { hasText: 'Chapter 1' }).click();
  await window.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent === 'Newer words here.');
  assert.equal(await window.locator('#chapter-list .row', { hasText: 'Chapter 9' }).count(), 1);
  assert.equal(await window.locator('#chapter-list .row', { hasText: 'Something Else' }).count(), 1);
  assert.equal(await window.locator('#book-list .row', { hasText: 'Salt and Stone' }).count(), 1);
  assert.equal(await window.locator('#book-list .row', { hasText: 'Unwanted' }).count(), 0);

  // The older file is in the chapter's history.
  await tool(window, '.history-button');
  await window.waitForSelector('.history-row');
  assert.match(await window.textContent('.history-row'), /From your files/);
  await window.click('#history-close');

  // Attachments show, with a picture's preview.
  await tool(window, '.attachments-button');
  await window.waitForSelector('#attachments[open]');
  assert.match(await window.textContent('#attachment-list'), /map\.png/);
  await window.waitForFunction(() => document.querySelector('.attachment-thumb')?.src.startsWith('data:image/png'));
  await window.click('#attachments-close');

  await app.close();

  await pickUpElsewhere();
  assert.equal(fs.existsSync(path.join(stories, 'Thumbs.db')), true);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  console.log('folder e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
