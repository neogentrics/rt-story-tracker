'use strict';
// The two lists in the real app: the lines that resize them, folding series and parts away, and the menu a right-click, the Menu key or
// Shift+F10 opens on every row, with each thing it offers. Also what a right-click in text offers.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-lists-'));

const resize = async (app, window, width, height = 800) => {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await window.waitForFunction((wanted) => Math.abs(window.innerWidth - wanted) <= 2, width);
  await settle(window);
};

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: path.join(profile, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  // A right-click in text asks for the system's menu, which a test can't see. This keeps what was asked for instead of showing it. The
  // app's own menu bar is built the same way, and is left alone.
  await app.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate;
    global.textMenus = [];
    Menu.buildFromTemplate = (template) => {
      if (template.some((item) => item.submenu) || !template.some((item) => item.role === 'copy')) return build.call(Menu, template);
      global.textMenus.push(template);
      return { popup() {} };
    };
  });
  return { app, window, errors };
};

const settle = (window) => window.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const row = (window, list, title) => window.locator(`${list} .row`, { has: window.locator('.row-title', { hasText: exactly(title) }) });
const book = (window, title) => row(window, '#book-list', title);
const chapter = (window, title) => row(window, '#chapter-list', title);
const titles = (window, list) => window.$$eval(`${list} .row`, (rows) => rows.map((one) => `${one.classList.contains('depth-1') ? '  ' : ''}${one.querySelector('.row-title')?.textContent}`));
const wait = (window, list, wanted) => window.waitForFunction(
  ([selector, expected]) => JSON.stringify([...document.querySelectorAll(`${selector} .row`)].map((one) => `${one.classList.contains('depth-1') ? '  ' : ''}${one.querySelector('.row-title')?.textContent}`)) === expected,
  [list, JSON.stringify(wanted)],
  { timeout: 8000 },
).catch(async () => assert.deepEqual(await titles(window, list), wanted, list));

// What the open menu offers, with what can't be chosen marked.
const offered = (window) => window.$$eval('.popup-menu [role="menuitem"]', (items) => items.map((item) => `${item.firstChild.textContent}${item.getAttribute('aria-disabled') ? ' (off)' : ''}`));
const choose = (window, label) => window.locator('.popup-menu [role="menuitem"]', { has: window.locator('span:first-child', { hasText: exactly(label) }) }).click();
async function rightClick(window, line) {
  await line.locator('.row-main').click({ button: 'right' });
  await window.waitForSelector('.popup-menu');
}
async function fromMenu(window, line, ...labels) {
  await rightClick(window, line);
  for (const label of labels) await choose(window, label);
  await window.waitForSelector('.popup-menu', { state: 'detached' });
}
async function nameIt(window, name) {
  await window.fill('.rename', name);
  await window.keyboard.press('Enter');
  await window.waitForSelector('.rename', { state: 'detached' });
}
const focused = (window) => window.evaluate(() => {
  const at = document.activeElement;
  return at?.closest('.popup-menu') ? at.firstChild.textContent : `${at?.className} ${at?.closest('.row')?.querySelector('.row-title')?.textContent ?? ''}`.trim();
});
const widths = (window) => window.evaluate(() => [...document.querySelectorAll('.columns > .column')].map((column) => Math.round(column.getBoundingClientRect().width)));
const splitter = (window, side) => window.locator(`.splitter[data-side="${side}"]`);
const textMenus = (app) => app.evaluate(() => global.textMenus.map((template) => template.map((item) => `${item.label ?? item.role ?? '-'}${item.enabled === false ? ' (off)' : ''}`)));
const forget = (app) => app.evaluate(() => { global.textMenus.length = 0; });
async function textMenu(app) {
  for (let tries = 0; tries < 80; tries += 1) {
    const [first] = await textMenus(app);
    if (first) return first;
    await new Promise((done) => setTimeout(done, 100));
  }
  return null;
}
const pickFromText = (app, label) => app.evaluate((_electron, name) => global.textMenus[0].find((item) => item.label === name).click(), label);

(async () => {
  let { app, window, errors } = await launch();
  await resize(app, window, 1200);
  await window.fill('#new-title', 'First Book');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await window.click('.ProseMirror');
  await window.keyboard.type('Words in the first chapter.');
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });

  // With nothing to fold, there's nothing to collapse.
  assert.equal(await window.locator('.fold-all:visible').count(), 0);

  // The lines beside the lists: named, resized by the arrow keys, reset by Enter.
  assert.deepEqual(await window.$$eval('.splitter', (lines) => lines.map((line) => [line.getAttribute('role'), line.getAttribute('aria-label'), line.getAttribute('aria-orientation'), line.tabIndex])), [
    ['separator', 'Width of the books list', 'vertical', 0],
    ['separator', 'Width of the chapters list', 'vertical', 0],
  ]);
  const [usualBooks, usualChapters] = await widths(window);
  const now = (side) => splitter(window, side).getAttribute('aria-valuenow').then(Number);
  await splitter(window, 'books').focus();
  await window.keyboard.press('ArrowRight');
  assert.equal((await widths(window))[0], usualBooks + 16);
  await window.keyboard.press('Shift+ArrowRight');
  assert.equal((await widths(window))[0], usualBooks + 80);
  assert.equal(await now('books'), usualBooks + 80, 'the line says how wide the list is');
  await window.keyboard.press('ArrowLeft');
  assert.equal((await widths(window))[0], usualBooks + 64);
  await window.keyboard.press('Home');
  assert.equal((await widths(window))[0], 130, 'never narrower than it can be read');
  await window.keyboard.press('End');
  let sizes = await widths(window);
  assert.ok(sizes[2] >= 318, `the page keeps room to be written in: ${sizes}`);
  assert.equal(sizes[0], Number(await splitter(window, 'books').getAttribute('aria-valuemax')));
  await window.keyboard.press('Enter');
  assert.deepEqual((await widths(window)).slice(0, 2), [usualBooks, usualChapters], 'Enter goes back to the usual width');

  // By dragging, and a double click goes back.
  const drag = async (side, by) => {
    const box = await splitter(window, side).boundingBox();
    const x = box.x + box.width / 2;
    await window.mouse.move(x, box.y + 120);
    await window.mouse.down();
    await window.mouse.move(x + by, box.y + 120, { steps: 6 });
    await window.mouse.up();
    await settle(window);
  };
  await drag('chapters', 70);
  assert.ok(Math.abs((await widths(window))[1] - (usualChapters + 70)) <= 2, `dragged: ${await widths(window)}`);
  await splitter(window, 'chapters').dblclick();
  await settle(window);
  assert.equal((await widths(window))[1], usualChapters);
  await drag('books', 55);
  await drag('chapters', 30);
  const chosen = (await widths(window)).slice(0, 2);

  // A series, and moving a book into it from the book's menu.
  await window.click('#add-series');
  await nameIt(window, 'The Saga');
  await wait(window, '#book-list', ['First Book', 'The Saga']);
  await rightClick(window, book(window, 'The Saga'));
  assert.deepEqual(await offered(window), ['Rename', 'Add a book', 'Collapse', 'Move up', 'Move down (off)', 'Move to Trash']);
  assert.equal(await window.getAttribute('.popup-menu', 'aria-label'), 'Actions for The Saga');
  await window.keyboard.press('Escape');

  await rightClick(window, book(window, 'First Book'));
  assert.deepEqual(await offered(window), ['Open', 'Rename', 'Book details…', 'Move to a series…', 'Move up (off)', 'Move down', 'Duplicate', 'Export…', 'Move to Trash']);
  await choose(window, 'Move to a series…');
  assert.deepEqual(await offered(window), ['‹ Back', 'The Saga']);
  await window.keyboard.press('ArrowLeft');
  assert.equal(await focused(window), 'Move to a series…', 'back in the first list, where it was');
  await window.keyboard.press('ArrowRight');
  assert.equal(await focused(window), 'The Saga');
  await window.keyboard.press('Enter');
  await wait(window, '#book-list', ['The Saga', '  First Book']);

  // Adding a book from the series, then taking one out of it again.
  await fromMenu(window, book(window, 'The Saga'), 'Add a book');
  await window.waitForSelector('.rename');
  await nameIt(window, 'Second Book');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);
  await fromMenu(window, book(window, 'Second Book'), 'Move to a series…', 'Not in a series');
  await wait(window, '#book-list', ['The Saga', '  First Book', 'Second Book']);
  await fromMenu(window, book(window, 'Second Book'), 'Move to a series…', 'The Saga');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);
  await fromMenu(window, book(window, 'Second Book'), 'Move up');
  await wait(window, '#book-list', ['The Saga', '  Second Book', '  First Book']);
  await fromMenu(window, book(window, 'Second Book'), 'Move down');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);

  // Folding a series: by its arrow, the arrow keys, its menu, and Collapse all and Expand all.
  const arrow = book(window, 'The Saga').locator('.row-fold');
  assert.deepEqual([await arrow.getAttribute('aria-label'), await arrow.getAttribute('aria-expanded')], ['Collapse The Saga', 'true']);
  await arrow.click();
  await wait(window, '#book-list', ['The Saga']);
  assert.deepEqual([await arrow.getAttribute('aria-label'), await arrow.getAttribute('aria-expanded')], ['Expand The Saga', 'false']);
  assert.ok(await book(window, 'The Saga').evaluate((node) => node.classList.contains('holds-selected')), 'a folded series says the open book is inside');
  assert.match(await focused(window), /^row-fold The Saga$/, 'the arrow keeps the focus');
  await book(window, 'The Saga').locator('.row-main').focus();
  await window.keyboard.press('ArrowRight');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);
  assert.match(await focused(window), /^row-main The Saga$/);
  await window.keyboard.press('ArrowLeft');
  await wait(window, '#book-list', ['The Saga']);
  await fromMenu(window, book(window, 'The Saga'), 'Expand');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);
  await fromMenu(window, book(window, 'The Saga'), 'Collapse');
  await wait(window, '#book-list', ['The Saga']);
  await window.click('[aria-label="Expand all series"]');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);
  await window.click('[aria-label="Collapse all series"]');
  await wait(window, '#book-list', ['The Saga']);

  // Both the fold and the widths are still there after the app is closed, and opening it doesn't unfold the series the open chapter is in.
  const openTitle = await window.inputValue('#chapter-title');
  await app.close();
  ({ app, window, errors } = await launch());
  await resize(app, window, 1200);
  await window.waitForSelector('.ProseMirror');
  await wait(window, '#book-list', ['The Saga']);
  assert.equal(await window.inputValue('#chapter-title'), openTitle);
  assert.ok(await book(window, 'The Saga').evaluate((node) => node.classList.contains('holds-selected')));
  assert.deepEqual((await widths(window)).slice(0, 2), chosen, 'the widths are remembered');

  // In a smaller window the lists give way so the page keeps its room, and in a bigger one they're as wide as they were left.
  await splitter(window, 'books').focus();
  await window.keyboard.press('End');
  const widest = (await widths(window)).slice(0, 2);
  for (const width of [1000, 800]) {
    await resize(app, window, width);
    await window.waitForFunction(() => document.querySelector('.page-column').getBoundingClientRect().width >= 318, null, { timeout: 5000 }).catch(() => null);
    sizes = await widths(window);
    assert.ok(sizes[2] >= 318 && sizes[0] >= 130 && sizes[1] >= 130 && sizes[0] + sizes[1] + sizes[2] <= width + 2, `at ${width}: ${sizes}`);
  }
  // Very small, the two lists share a column and only one line is needed.
  await resize(app, window, 660, 500);
  await window.waitForFunction(() => document.querySelector('.columns > .column:nth-child(2)').classList.contains('shares-column'));
  assert.equal(await splitter(window, 'chapters').isVisible(), false);
  assert.equal(await splitter(window, 'books').isVisible(), true);
  sizes = await widths(window);
  assert.ok(sizes[0] === sizes[1] && sizes[2] >= 318, `sharing a column: ${sizes}`);
  await resize(app, window, 1200);
  await window.waitForFunction((wanted) => Math.abs(document.querySelector('.columns > .column').getBoundingClientRect().width - wanted) <= 1, widest[0]);
  assert.deepEqual((await widths(window)).slice(0, 2), widest, 'a small window doesn’t change what was chosen');
  // With the look-up panel open in a wide window, the page and the panel both keep their room.
  await resize(app, window, 1500);
  await splitter(window, 'books').focus();
  await window.keyboard.press('End');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'lookup'));
  await window.waitForSelector('.lookup-pane:not([hidden])');
  await window.waitForFunction(() => document.querySelector('.pane').getBoundingClientRect().width >= 318, null, { timeout: 5000 }).catch(() => null);
  const beside = await window.evaluate(() => [document.querySelector('.pane').getBoundingClientRect().width, document.querySelector('.lookup-pane').getBoundingClientRect().width].map(Math.round));
  assert.ok(beside[0] >= 318 && beside[1] >= 300, `the page and the look-up panel: ${beside}`);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'lookup'));
  await window.waitForSelector('.lookup-pane', { state: 'hidden' });
  await splitter(window, 'books').focus();
  await window.keyboard.press('Enter');
  await resize(app, window, 1200);

  await window.click('[aria-label="Expand all series"]');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  Second Book']);

  if (process.env.RTST_SHOTS) {
    await rightClick(window, book(window, 'First Book'));
    await window.screenshot({ path: path.join(process.env.RTST_SHOTS, 'lists-menu.png') });
    await window.keyboard.press('Escape');
    await window.click('#add-part');
    await nameIt(window, 'A Part');
    await chapter(window, 'A Part').locator('.row-main').focus();
    await window.keyboard.press('Shift+Tab');
    await splitter(window, 'books').focus();
    await window.screenshot({ path: path.join(process.env.RTST_SHOTS, 'lists-lines.png') });
    await fromMenu(window, chapter(window, 'A Part'), 'Move to Trash');
  }

  // The keyboard: Shift+F10 and the Menu key open the same menu, the arrows move through it, and Escape gives the focus back.
  await book(window, 'First Book').locator('.row-main').click();
  await wait(window, '#chapter-list', ['Chapter 1']);
  await chapter(window, 'Chapter 1').locator('.row-main').focus();
  for (const key of ['Shift+F10', 'ContextMenu']) {
    await window.keyboard.press(key);
    await window.waitForSelector('.popup-menu');
    await settle(window);
    assert.equal(await window.locator('.popup-menu').count(), 1, `${key} opens one menu`);
    assert.equal(await focused(window), 'Open');
    await window.keyboard.press('ArrowDown');
    assert.equal(await focused(window), 'Open beside');
    await window.keyboard.press('End');
    assert.equal(await focused(window), 'Move to Trash');
    await window.keyboard.press('ArrowDown');
    assert.equal(await focused(window), 'Open', 'round to the top');
    await window.keyboard.press('ArrowUp');
    await window.keyboard.press('Home');
    assert.equal(await focused(window), 'Open');
    await window.keyboard.press('Escape');
    await window.waitForSelector('.popup-menu', { state: 'detached' });
    assert.match(await focused(window), /^row-main Chapter 1$/, `${key}: the focus goes back to the row`);
  }
  await window.keyboard.press('Shift+F10');
  await window.keyboard.press('Tab');
  await window.waitForSelector('.popup-menu', { state: 'detached' });
  await rightClick(window, chapter(window, 'Chapter 1'));
  await window.click('.room-header .bar-title');
  await window.waitForSelector('.popup-menu', { state: 'detached' });
  assert.deepEqual(await textMenus(app), [], 'a row never shows the text menu as well');

  // A chapter's menu, and every action in it.
  await rightClick(window, chapter(window, 'Chapter 1'));
  assert.deepEqual(await offered(window), ['Open', 'Open beside', 'Rename', 'Duplicate', 'Move up (off)', 'Move down (off)', 'Move to another book…', 'Export…', 'Move to Trash']);
  await choose(window, 'Rename');
  await nameIt(window, 'Opening');
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Opening');
  await window.click('#add-chapter');
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 2');
  await fromMenu(window, chapter(window, 'Opening'), 'Open');
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Opening');
  await fromMenu(window, chapter(window, 'Chapter 2'), 'Open beside');
  await window.waitForSelector('.pane:nth-of-type(2) .ProseMirror');
  await window.click('.close-pane');
  await window.waitForSelector('.close-pane', { state: 'detached' });
  await fromMenu(window, chapter(window, 'Chapter 2'), 'Move up');
  await wait(window, '#chapter-list', ['Chapter 2', 'Opening']);
  await fromMenu(window, chapter(window, 'Chapter 2'), 'Move down');
  await wait(window, '#chapter-list', ['Opening', 'Chapter 2']);

  await fromMenu(window, chapter(window, 'Opening'), 'Duplicate');
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)', 'Chapter 2']);
  await window.waitForFunction(() => document.querySelector('#room-message').textContent.includes('Made “Opening (copy)”.'));
  assert.match(await focused(window), /^row-main Opening \(copy\)$/);
  await chapter(window, 'Opening (copy)').locator('.row-main').click();
  await window.waitForFunction(() => document.querySelector('.ProseMirror').textContent === 'Words in the first chapter.');

  await rightClick(window, chapter(window, 'Chapter 2'));
  await choose(window, 'Move to another book…');
  assert.deepEqual(await offered(window), ['‹ Back', 'Second Book']);
  await choose(window, 'Second Book');
  await book(window, 'Second Book').locator('.row-main').click();
  await wait(window, '#chapter-list', ['Chapter 1', 'Chapter 2']);

  // Export from a row offers that chapter or book first, whatever is open.
  await book(window, 'First Book').locator('.row-main').click();
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)']);
  await fromMenu(window, chapter(window, 'Opening (copy)'), 'Export…');
  const scope = () => window.$eval('#export-scope', (select) => select.selectedOptions[0].textContent);
  await window.waitForSelector('#export[open]');
  assert.equal(await scope(), 'This chapter: Opening (copy)');
  await window.keyboard.press('Escape');
  await window.waitForSelector('#export[open]', { state: 'detached' });
  await fromMenu(window, book(window, 'Second Book'), 'Export…');
  await window.waitForSelector('#export[open]');
  assert.equal(await scope(), 'This book: Second Book', 'the book that was clicked, not the one that’s open');
  await window.keyboard.press('Escape');
  await window.waitForSelector('#export[open]', { state: 'detached' });

  // Trash, with Undo.
  await fromMenu(window, chapter(window, 'Opening (copy)'), 'Move to Trash');
  await wait(window, '#chapter-list', ['Opening']);
  await window.click('#message-action');
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)']);

  // A part's menu.
  await window.click('#add-part');
  await nameIt(window, 'Part One');
  await rightClick(window, chapter(window, 'Part One'));
  assert.deepEqual(await offered(window), ['Add a chapter', 'Rename', 'Collapse', 'Move up', 'Move down (off)', 'Move to Trash']);
  await choose(window, 'Add a chapter');
  await window.waitForSelector('#chapter-list .row.depth-1');
  const inPart = (await titles(window, '#chapter-list')).at(-1).trim();
  await fromMenu(window, chapter(window, 'Part One'), 'Collapse');
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)', 'Part One']);
  // A search looks inside folded parts, and clearing it folds them again.
  await window.fill('#chapter-filter', inPart);
  assert.deepEqual(await window.$$eval('#chapter-list .row:not([hidden]) .row-title', (found) => found.map((one) => one.textContent)), [inPart]);
  await window.fill('#chapter-filter', '');
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)', 'Part One']);
  // Adding to a folded part opens it, so the new chapter is seen.
  await fromMenu(window, chapter(window, 'Part One'), 'Add a chapter');
  await window.waitForFunction(() => document.querySelectorAll('#chapter-list .row.depth-1').length === 2);
  assert.equal(await chapter(window, 'Part One').locator('.row-fold').getAttribute('aria-expanded'), 'true');
  await window.click('[aria-label="Collapse all parts"]');
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)', 'Part One']);
  await window.click('[aria-label="Expand all parts"]');
  await window.waitForFunction(() => document.querySelectorAll('#chapter-list .row.depth-1').length === 2);
  await fromMenu(window, chapter(window, 'Part One'), 'Rename');
  await nameIt(window, 'The Middle');
  await fromMenu(window, chapter(window, 'The Middle'), 'Move up');
  await window.waitForFunction(() => document.querySelector('#chapter-list .row:nth-child(2) .row-title').textContent === 'The Middle');
  await fromMenu(window, chapter(window, 'The Middle'), 'Move down');
  await window.waitForFunction(() => document.querySelector('#chapter-list .row:nth-child(3) .row-title').textContent === 'The Middle');
  await fromMenu(window, chapter(window, 'The Middle'), 'Move to Trash');
  await wait(window, '#chapter-list', ['Opening', 'Opening (copy)']);
  await window.click('#message-action');
  await window.waitForFunction(() => document.querySelectorAll('#chapter-list .row').length === 5);

  // The rest of a book's menu.
  await fromMenu(window, book(window, 'Second Book'), 'Open');
  await wait(window, '#chapter-list', ['Chapter 1', 'Chapter 2']);
  await fromMenu(window, book(window, 'Second Book'), 'Rename');
  await nameIt(window, 'The Return');
  await fromMenu(window, book(window, 'The Return'), 'Book details…');
  await window.waitForSelector('#details[open]');
  assert.equal(await window.textContent('#details h2'), 'Book details: The Return');
  await window.keyboard.press('Escape');
  await window.waitForSelector('#details[open]', { state: 'detached' });
  await fromMenu(window, book(window, 'The Return'), 'Duplicate');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  The Return', '  The Return (copy)']);
  await fromMenu(window, book(window, 'The Return (copy)'), 'Move to Trash');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  The Return']);
  await window.click('#message-action');
  await wait(window, '#book-list', ['The Saga', '  First Book', '  The Return', '  The Return (copy)']);

  // The rest of a series' menu.
  await fromMenu(window, book(window, 'The Saga'), 'Rename');
  await nameIt(window, 'The Long Saga');
  await window.click('#add-series');
  await nameIt(window, 'Another Series');
  await fromMenu(window, book(window, 'Another Series'), 'Move up');
  await wait(window, '#book-list', ['Another Series', 'The Long Saga', '  First Book', '  The Return', '  The Return (copy)']);
  await fromMenu(window, book(window, 'Another Series'), 'Move down');
  await wait(window, '#book-list', ['The Long Saga', '  First Book', '  The Return', '  The Return (copy)', 'Another Series']);
  await fromMenu(window, book(window, 'Another Series'), 'Move to Trash');
  await wait(window, '#book-list', ['The Long Saga', '  First Book', '  The Return', '  The Return (copy)']);
  await window.click('#message-action');
  await wait(window, '#book-list', ['The Long Saga', '  First Book', '  The Return', '  The Return (copy)', 'Another Series']);

  // The empty part of each list has a menu too.
  const below = async (list) => {
    const box = await window.locator(list).boundingBox();
    await window.mouse.click(box.x + box.width / 2, box.y + box.height - 8, { button: 'right' });
    await window.waitForSelector('.popup-menu');
  };
  await below('#book-list');
  assert.deepEqual(await offered(window), ['Add a book', 'Add a series', 'Collapse all series', 'Expand all series']);
  await choose(window, 'Add a book');
  await window.waitForSelector('.rename');
  await nameIt(window, 'Loose Book');
  await wait(window, '#book-list', ['The Long Saga', '  First Book', '  The Return', '  The Return (copy)', 'Another Series', 'Loose Book']);
  await below('#chapter-list');
  assert.deepEqual(await offered(window), ['Add a chapter', 'Add a part', 'Collapse all parts (off)', 'Expand all parts (off)']);
  await choose(window, 'Add a chapter');
  await wait(window, '#chapter-list', ['Chapter 1', 'Chapter 2']);

  // A menu opened at the very bottom of a short window stays inside it.
  await resize(app, window, 700, 420);
  await rightClick(window, chapter(window, 'Chapter 2'));
  const box = await window.locator('.popup-menu').boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 700 && box.y + box.height <= 420, `inside the window: ${JSON.stringify(box)}`);
  await window.locator('.popup-menu [role="menuitem"]').last().scrollIntoViewIfNeeded();
  await window.keyboard.press('Escape');
  await resize(app, window, 1200);

  // Text keeps the system's menu: a field being renamed has cut, copy and paste, and the writing page adds comments and find.
  await fromMenu(window, chapter(window, 'Chapter 2'), 'Rename');
  await forget(app);
  await window.click('.rename', { button: 'right' });
  const inField = await textMenu(app);
  assert.deepEqual(inField?.map((line) => line.replace(' (off)', '')).slice(-5), ['cut', 'copy', 'paste', '-', 'selectAll']);
  assert.equal(await window.locator('.popup-menu').count(), 0, 'not the row’s menu');
  await window.locator('.rename').press('Escape');

  await window.click('.ProseMirror');
  await window.keyboard.type('Something to remark on');
  await window.keyboard.press('ControlOrMeta+a');
  await forget(app);
  const words = await window.locator('.ProseMirror p').first().boundingBox();
  await window.mouse.click(words.x + 30, words.y + words.height / 2, { button: 'right' });
  const onPage = await textMenu(app);
  assert.deepEqual(onPage?.slice(-8).map((line) => line.replace(/^(cut|copy|paste) \(off\)$/, '$1')), ['cut', 'copy', 'paste', '-', 'selectAll', '-', 'Comment on the Selected Words', 'Find and Replace…']);
  await pickFromText(app, 'Comment on the Selected Words');
  await window.waitForSelector('.comment-form:not([hidden])');
  await window.fill('.comment-box', 'Look at this again');
  await window.click('.comment-save');
  await window.waitForSelector('.comment-card');
  await pickFromText(app, 'Find and Replace…');
  await window.waitForSelector('.find-bar:not([hidden])');
  await window.keyboard.press('Escape');
  await window.waitForFunction(() => document.activeElement?.closest('.ProseMirror'));

  // The keys open the same menu on the writing page. Chromium does that itself, and a test's key presses only reach it on Linux.
  if (process.platform === 'linux') {
    for (const key of ['Shift+F10', 'ContextMenu']) {
      await window.focus('.ProseMirror');
      await forget(app);
      await window.keyboard.press(key);
      assert.equal((await textMenu(app))?.at(-1), 'Find and Replace…', `${key} on the writing page`);
    }
  }

  // Where there's nothing to type in and nothing selected, a right-click shows nothing.
  await window.evaluate(() => getSelection().removeAllRanges());
  await window.click('#project-words');
  await window.evaluate(() => getSelection().removeAllRanges());
  await forget(app);
  await window.click('#open-library', { button: 'right' });
  await new Promise((done) => setTimeout(done, 700));
  assert.deepEqual(await textMenus(app), []);

  assert.deepEqual(errors, []);
  await app.close();
  console.log('lists e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
