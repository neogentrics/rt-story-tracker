'use strict';
// Checking the folder for changes, in the real app: a made-up folder is brought in, changed on disk, and the app opened again. Nothing
// changes until it's chosen, the folder is never written to, and a folder not chosen on this computer isn't read.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recheck-e2e-'));
const profile = path.join(work, 'profile');
const stories = path.join(work, 'My Stories');

let written = Date.now();
function put(rel, content) {
  const full = path.join(stories, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  written += 5000;
  fs.utimesSync(full, new Date(written), new Date(written));
}
function snapshot(dir = stories) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? snapshot(full) : [`${path.relative(stories, full)} ${fs.statSync(full).mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex')}`];
  }).sort();
}

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: path.join(work, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  window.on('dialog', (dialog) => dialog.accept());
  await window.waitForSelector('body[data-state="ready"]');
  // What the system's folder window was asked for, and what it answers.
  await app.evaluate(({ dialog }) => {
    global.asked = [];
    global.answer = null;
    dialog.showOpenDialog = async (_window, options) => {
      global.asked.push(options);
      return { canceled: !global.answer, filePaths: global.answer ? [global.answer] : [] };
    };
  });
  return { app, window, errors };
};
const answer = (app, folder) => app.evaluate((_electron, value) => { global.answer = value; }, folder);
const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
const row = (window, title) => window.locator('.change', { has: window.locator('.change-head strong', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const pick = (window, title, label) => row(window, title).getByRole('radio', { name: label, exact: true }).check();
const shownChanges = (window) => window.$$eval('.change', (rows) => rows.map((one) => `${one.dataset.group}: ${one.querySelector('strong').textContent}`).sort());
const said = (window, pattern) => window.waitForFunction((source) => new RegExp(source).test(document.querySelector('#changes-status')?.textContent ?? ''), pattern.source);
const page = (window) => window.textContent('.ProseMirror');
const openChapter = async (window, title) => {
  await window.locator('#chapter-list .row-main', { hasText: title }).first().click();
  await window.waitForFunction((wanted) => document.querySelector('#chapter-title').value === wanted, title);
};

(async () => {
  put('Book_1_The_Road/Chapter 1.md', 'The road began at the mill.\n');
  put('Book_1_The_Road/Chapter 2.md', 'It crossed the ford at noon.\n');
  put('Book_1_The_Road/Chapter 3.md', 'Nobody walked it after dark.\n');

  let { app, window, errors } = await launch();
  await answer(app, stories);
  await window.click('#find-files');
  await window.waitForSelector('#plan-tree');
  await window.click('#plan-go');
  await window.waitForSelector('#report-total', { timeout: 60000 });
  await window.click('#report-close');
  await openChapter(window, 'Chapter 1');

  // Nothing has changed, and the window says so.
  await menu(app, 'folder-changes');
  await window.waitForSelector('#folder-changes[open]');
  await said(window, /Nothing has changed/);
  assert.equal(await window.locator('.change').count(), 0);
  assert.equal(await window.isDisabled('#changes-apply'), true);
  await window.click('#changes-close');

  // A comment on the first chapter, and an edit of the second in the app.
  await openChapter(window, 'Chapter 1');
  await window.click('.ProseMirror');
  await window.keyboard.press('ControlOrMeta+a');
  await window.click('.tool.add-comment');
  await window.fill('.comment-box', 'Check the mill.');
  await window.click('.comment-save');
  await window.waitForSelector('.comment-card');
  await openChapter(window, 'Chapter 2');
  await window.click('.ProseMirror');
  await window.keyboard.press('ControlOrMeta+a');
  await window.keyboard.type('Rewritten here in the app.');
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });
  await openChapter(window, 'Chapter 1');
  await app.close();

  // Changes in the folder while the app is closed.
  put('Book_1_The_Road/Chapter 1.md', 'The road began at the weir.\n');
  put('Book_1_The_Road/Chapter 2.md', 'Rewritten out there in the folder.\n');
  fs.rmSync(path.join(stories, 'Book_1_The_Road', 'Chapter 3.md'));
  put('Book_1_The_Road/Chapter 4.md', 'A fourth chapter.\n');
  const folderNow = snapshot();

  // Opening the project looks by itself, says so quietly, and changes nothing.
  ({ app, window, errors } = await launch());
  await window.waitForSelector('.ProseMirror');
  await window.waitForSelector('#room-message.info:not([hidden])', { timeout: 20000 });
  assert.equal(await window.textContent('#room-message span'), 'The folder has changes: 2 changed, 1 new and 1 moved or gone. Nothing has been changed here.');
  assert.equal(await window.locator('dialog[open]').count(), 0, 'it never opens a window by itself');
  assert.equal(await page(window), 'The road began at the mill.');
  await window.click('#message-action');
  await window.waitForSelector('#folder-changes[open]');
  await said(window, /Nothing has been changed/);
  assert.deepEqual(await shownChanges(window), ['both: Chapter 2', 'folder: Chapter 1', 'gone: Chapter 3.md', 'new: Chapter 4.md']);
  assert.deepEqual(await window.$$eval('.change-group h3', (headings) => headings.map((one) => one.textContent)), ['Changed in both places (1)', 'Changed in the folder (1)', 'New in the folder (1)', 'No longer where it was (1)']);
  // Nothing is chosen to begin with, anywhere.
  assert.deepEqual(await window.$$eval('.change input:checked', (inputs) => inputs.map((input) => input.value)), ['', '', '', '']);
  assert.equal(await window.isDisabled('#changes-apply'), true);
  assert.match(await row(window, 'Chapter 1').locator('.change-warning').textContent(), /It has 1 comment\. If its text is replaced, it stays with the earlier version/);
  const unnamed = await window.$$eval('#folder-changes :is(button, input, select)', (nodes) => nodes.filter((node) => !(node.getAttribute('aria-label') || node.textContent.trim() || [...(node.labels ?? [])].some((label) => label.textContent.trim()))).map((node) => node.outerHTML.slice(0, 80)));
  assert.deepEqual(unnamed, [], 'every control has a name');

  // Side by side, with what differs marked.
  await row(window, 'Chapter 2').locator('.change-compare').click();
  await window.waitForSelector('.compare:not([hidden]) .from-app');
  assert.equal(await row(window, 'Chapter 2').locator('.from-app').textContent(), 'Rewritten here in the app.');
  assert.equal(await row(window, 'Chapter 2').locator('.from-folder').textContent(), 'Rewritten out there in the folder.');
  assert.ok(await row(window, 'Chapter 2').locator('.from-app del').count() > 0 && await row(window, 'Chapter 2').locator('.from-folder ins').count() > 0);
  if (process.env.RTST_SHOTS) await window.screenshot({ path: path.join(process.env.RTST_SHOTS, 'folder-changes.png') });
  await row(window, 'Chapter 2').locator('.change-compare').click();
  assert.equal(await row(window, 'Chapter 2').locator('.compare').isHidden(), true);

  // In a small window everything can still be reached, with no scrolling sideways.
  await window.setViewportSize({ width: 640, height: 420 });
  await window.waitForFunction(() => window.innerWidth === 640);
  assert.equal(await window.$eval('#folder-changes', (dialog) => dialog.scrollWidth > dialog.clientWidth + 1), false);
  for (const selector of ['#changes-apply', '#changes-close', '#changes-bulk']) {
    await window.locator(selector).scrollIntoViewIfNeeded();
    const box = await window.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 640 && box.y + box.height <= 420, `${selector} is reachable: ${JSON.stringify(box)}`);
  }
  await window.setViewportSize({ width: 1200, height: 800 });

  // Choosing all that changed only in the folder leaves the conflict, the new file and the missing one for the author.
  await window.click('#changes-bulk');
  assert.deepEqual(await window.$$eval('.change', (rows) => rows.map((one) => `${one.querySelector('strong').textContent}=${one.querySelector('input:checked').value}`).sort()), ['Chapter 1=folder', 'Chapter 2=', 'Chapter 3.md=', 'Chapter 4.md=']);
  assert.equal(await window.textContent('#changes-apply'), 'Apply 1 choice');
  await window.click('#changes-apply');
  await said(window, /^Applied 1 choice\./);
  await window.click('#changes-close');
  await window.waitForFunction(() => document.querySelector('.ProseMirror').textContent === 'The road began at the weir.');

  // The words it replaced are in the chapter's earlier versions.
  await menu(app, 'history');
  await window.waitForSelector('#history[open] .history-note');
  assert.match(await window.textContent('#history .history-list'), /Before an update from the folder/);
  await window.click('#history-close');
  await openChapter(window, 'Chapter 2');
  assert.equal(await page(window), 'Rewritten here in the app.', 'the conflict is as it was');

  // The Files view has the button too. Keep both for the conflict, and bring in the new file.
  await menu(app, 'attachments');
  await window.waitForSelector('#attachments[open]');
  await window.click('#files-check-folder');
  await window.waitForSelector('#folder-changes[open] .change');
  await pick(window, 'Chapter 2', 'Keep both, as two chapters');
  await pick(window, 'Chapter 4.md', 'Make it a chapter');
  await pick(window, 'Chapter 3.md', 'Stop listing it');
  assert.equal(await row(window, 'Chapter 4.md').locator('select').evaluate((select) => select.selectedOptions[0].textContent), 'The Road');
  await window.click('#changes-apply');
  await said(window, /^Applied 3 choices\./);
  assert.equal(await window.locator('.change').count(), 0);
  await window.click('#changes-close');
  await window.waitForFunction(() => document.querySelectorAll('#chapter-list .row').length === 5);
  assert.deepEqual(await window.$$eval('#chapter-list .row-title', (titles) => titles.map((one) => one.textContent)), ['Chapter 1', 'Chapter 2', 'Chapter 2 (from the folder)', 'Chapter 3', 'Chapter 4']);
  await openChapter(window, 'Chapter 2 (from the folder)');
  assert.equal(await page(window), 'Rewritten out there in the folder.');
  assert.deepEqual(snapshot(), folderNow, 'the folder was only read');
  await app.close();

  // On a computer where the folder wasn't chosen, it isn't read: no notice, and the window asks for it to be chosen.
  put('Book_1_The_Road/Chapter 1.md', 'The road began at the sea.\n');
  fs.rmSync(path.join(profile, 'folder-links.json'));
  ({ app, window, errors } = await launch());
  await window.waitForSelector('.ProseMirror');
  await new Promise((done) => setTimeout(done, 1500));
  assert.equal(await window.locator('#room-message:not([hidden])').count(), 0);
  await menu(app, 'folder-changes');
  await window.waitForSelector('#folder-changes[open] .folder-choose');
  await said(window, /No folder could be read/);
  assert.equal(await window.locator('.change').count(), 0);
  assert.match(await window.textContent('#changes-folders'), /wasn’t chosen on this computer, so it hasn’t been read/);
  // A folder with none of the files in it is refused. The system's window isn't opened at the path the project names.
  const empty = fs.mkdtempSync(path.join(work, 'empty-'));
  await answer(app, empty);
  await window.click('.folder-choose');
  await said(window, /None of the files/);
  await answer(app, stories);
  await window.click('.folder-choose');
  await window.waitForSelector('.change');
  assert.deepEqual(await shownChanges(window), ['folder: Chapter 1']);
  assert.deepEqual(await app.evaluate(() => global.asked.map((options) => options.defaultPath ?? null)), [null, null]);
  await window.click('#changes-close');

  assert.deepEqual(errors, []);
  await app.close();
  console.log('recheck e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
