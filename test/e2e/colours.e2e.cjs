'use strict';
// Highlighting and letter colours (issue 54), in the real app: choosing them by mouse and keyboard, what's saved, undo, Find and word
// counts, every theme in all three Looks in small windows with the contrast measured from the pixels on screen, a restart, the Word and
// PDF files the app writes, and what the app says where colour can't go.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { strFromU8, unzipSync } = require('fflate');
const { AppLink } = require('../../src/main/app-link');
const { screenColours } = require('../../src/shared/colour');
const { THEMES } = require('../../src/shared/themes');
const { frames, measure } = require('./measure.cjs');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-colours-'));
const profile = path.join(work, 'profile');
const shared = path.join(work, 'shared');
const SMALL = [{ width: 640, height: 480 }, { width: 800, height: 600 }];
const WORDS = [
  'Highlights: yellow green turquoise pink grey peach end.',
  'Letters: red orange leaf blue purple slate navy end.',
  'Both: crimson on gold today.',
  'Plain words to try things on.',
];
// What's chosen for each word: the menu's name for it, and the colour that should be saved.
const HIGHLIGHTED = [['yellow', 'Yellow', '#ffff00'], ['green', 'Green', '#00ff00'], ['turquoise', 'Turquoise', '#00ffff'], ['pink', 'Pink', '#ff00ff'], ['grey', 'Grey', '#c0c0c0']];
const LETTERED = [['red', 'Red', '#c00000'], ['orange', 'Orange', '#b45309'], ['leaf', 'Green', '#2e7d32'], ['blue', 'Blue', '#1f4e9e'], ['purple', 'Purple', '#7030a0'], ['slate', 'Grey', '#666666']];

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: shared },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  window.on('dialog', (dialog) => dialog.accept());
  await window.waitForSelector('body[data-state="ready"]');
  await window.evaluate(() => {
    // Colours at rest, not the middle of a fade. The app's own colour rules are an adopted sheet too, so this is added beside them.
    const still = new CSSStyleSheet();
    still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
  });
  return { app, window, errors };
};

const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
const pause = (window, time) => window.evaluate((wait) => new Promise((done) => { setTimeout(done, wait); }), time);
const resize = async (window, size) => {
  await window.setViewportSize(size);
  await window.waitForFunction((wanted) => window.innerWidth === wanted, size.width);
  await frames(window);
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

// Selects some words on the page, as dragging over them would.
async function select(window, text) {
  await window.evaluate((wanted) => {
    const walk = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const at = node.textContent.indexOf(wanted);
      if (at < 0) continue;
      document.querySelector('.ProseMirror').focus();
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    throw new Error(`“${wanted}” isn’t on the page in one piece`);
  }, text);
  // The editor hears of the new selection a moment later.
  await pause(window, 80);
}

// After a colour is applied the editor takes the keyboard back on the next frame, and puts its own selection back with it.
const settled = async (window) => {
  await window.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
  await frames(window);
};

const button = (type) => `.toolbar .colour-tool[data-colour-tool="${type}"]`;
const item = (window, name) => window.locator('.popup-menu [role^="menuitem"]', { has: window.locator('.popup-words', { hasText: new RegExp(`^${name}$`) }) });
async function choose(window, text, type, name) {
  await select(window, text);
  await window.click(button(type));
  await item(window, name).click();
  await window.waitForSelector('.popup-menu', { state: 'detached' });
  // The colour picker is answered afterwards, and settles then.
  if (name !== 'Another colour…') await settled(window);
}

// The colour picker belongs to the system, so the test stands in for it: it sees the app ask for it, and answers.
async function pickOther(window, text, type, colour) {
  await window.evaluate((kind) => {
    window.pickerAsked = 0;
    document.querySelector(`[data-colour-picker="${kind}"]`).addEventListener('click', (event) => {
      window.pickerAsked += 1;
      event.preventDefault();
    }, { once: true });
  }, type);
  await choose(window, text, type, 'Another colour…');
  assert.equal(await window.evaluate(() => window.pickerAsked), 1, 'the system’s colour picker was asked for');
  await window.evaluate(([kind, value]) => {
    const picker = document.querySelector(`[data-colour-picker="${kind}"]`);
    picker.value = value;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  }, [type, colour]);
  await settled(window);
}

// What's on the page now, as [words, highlight, letter colour] for every coloured span.
const onPage = (window) => window.$$eval('.ProseMirror [data-highlight], .ProseMirror [data-color]', (nodes) => nodes.map((node) => [
  node.textContent,
  node.getAttribute('data-highlight') ?? node.closest('[data-highlight]')?.getAttribute('data-highlight') ?? null,
  node.getAttribute('data-color'),
]));
const drawn = (window, words, attribute) => window.evaluate(([wanted, name]) => {
  const node = [...document.querySelectorAll(`.ProseMirror [${name}]`)].find((one) => one.textContent === wanted);
  const style = getComputedStyle(node);
  return { color: style.color, background: style.backgroundColor };
}, [words, attribute]);

const savedChapter = async (window) => {
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });
  return window.evaluate(async () => JSON.parse((await window.storyTracker.loadChapter(document.querySelector('#chapter-list .row').dataset.id)).body));
};
const marksIn = (document) => {
  const found = [];
  const walk = (node) => {
    for (const mark of node.marks ?? []) if (mark.type === 'highlight' || mark.type === 'textColor') found.push([node.text, mark.type, mark.attrs.color]);
    (node.content ?? []).forEach(walk);
  };
  walk(document);
  return found;
};

(async () => {
  // A stand-in for RT Markdown Reader, on the real pipe.
  let links = {};
  const arrived = [];
  fs.mkdirSync(path.join(work, 'reader'));
  const reader = new AppLink({
    folder: shared, dataDir: path.join(work, 'reader'), version: '3.9.0', id: 'rt-markdown-reader', name: 'RT Markdown Reader',
    load: () => ({ ...links }), save: (saved) => { links = saved; }, ask: async () => true, open: async () => {},
  });
  const handle = reader.handle.bind(reader);
  reader.handle = (method, params) => {
    if (method === 'open_document') arrived.push(params);
    return handle(method, params);
  };
  await reader.start();

  let { app, window, errors } = await launch();
  await resize(window, { width: 1200, height: 800 });
  await window.fill('#new-title', 'Colour Book');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await window.click('.ProseMirror');
  for (const [at, line] of WORDS.entries()) {
    if (at) await window.keyboard.press('Enter');
    await window.keyboard.type(line);
  }
  await window.waitForFunction(() => /^28 words in this chapter · 28 words/.test(document.querySelector('.page-footer .word-count').textContent));
  const countsBefore = await window.textContent('.page-footer .word-count');

  // The two buttons are on the formatting bar, named, and say they open a menu.
  assert.deepEqual(await window.$$eval('.toolbar .colour-tool', (nodes) => nodes.map((node) => [node.getAttribute('aria-label'), node.getAttribute('aria-haspopup')])), [['Highlight colour', 'menu'], ['Text colour', 'menu']]);
  await select(window, 'yellow');
  await window.click(button('highlight'));
  assert.deepEqual(await window.$$eval('.popup-menu [role^="menuitem"] .popup-words', (nodes) => nodes.map((node) => node.textContent)), ['Yellow', 'Green', 'Turquoise', 'Pink', 'Grey', 'Another colour…', 'Remove highlight']);
  await window.keyboard.press('Escape');
  await window.waitForSelector('.popup-menu', { state: 'detached' });
  assert.equal(await window.evaluate(() => document.activeElement.dataset.colourTool), 'highlight', 'Escape gives the button the focus back');
  await window.click(button('textColor'));
  assert.deepEqual(await window.$$eval('.popup-menu [role^="menuitem"] .popup-words', (nodes) => nodes.map((node) => node.textContent)), ['Red', 'Orange', 'Green', 'Blue', 'Purple', 'Grey', 'Another colour…', 'Normal text colour']);
  await window.keyboard.press('Escape');

  // By mouse.
  for (const [words, name] of HIGHLIGHTED) await choose(window, words, 'highlight', name);
  for (const [words, name] of LETTERED) await choose(window, words, 'textColor', name);
  await choose(window, 'crimson on gold', 'highlight', 'Yellow');
  await choose(window, 'crimson', 'textColor', 'Red');
  // Any other colour.
  await pickOther(window, 'peach', 'highlight', '#ffd8a8');
  await pickOther(window, 'navy', 'textColor', '#000080');

  const expected = [
    ...HIGHLIGHTED.map(([words, , colour]) => [words, colour, null]),
    ['peach', '#ffd8a8', null],
    ...LETTERED.map(([words, , colour]) => [words, null, colour]),
    ['navy', null, '#000080'],
    ['crimson on gold', '#ffff00', null],
    ['crimson', '#ffff00', '#c00000'],
  ].sort();
  assert.deepEqual((await onPage(window)).sort(), expected);

  // The menu says which colour the words have, and the button shows it.
  await select(window, 'purple');
  await window.click(button('textColor'));
  assert.deepEqual(await window.$$eval('.popup-menu [aria-checked="true"] .popup-words', (nodes) => nodes.map((node) => node.textContent)), ['Purple']);
  await window.keyboard.press('Escape');
  await select(window, 'peach');
  await window.click(button('highlight'));
  assert.deepEqual(await window.$$eval('.popup-menu [aria-checked="true"] .popup-words', (nodes) => nodes.map((node) => node.textContent)), ['Another colour…']);
  await window.keyboard.press('Escape');
  assert.equal(await window.$eval(`${button('highlight')} .colour-bar`, (node) => node.classList.contains('set')), true);

  // By keyboard alone: to the button, into the menu, down one, and Enter. The page has the keyboard back after.
  await pause(window, 700);
  await select(window, 'Plain');
  await window.focus(button('highlight'));
  await window.keyboard.press('Enter');
  await window.waitForSelector('.popup-menu');
  assert.equal(await window.evaluate(() => document.activeElement.textContent.trim()), 'Yellow');
  await window.keyboard.press('ArrowDown');
  await window.keyboard.press('Enter');
  await window.waitForSelector('.ProseMirror [data-highlight="#00ff00"] >> text=Plain');
  await window.waitForFunction(() => document.activeElement.classList.contains('ProseMirror'));

  // Undo and redo, from the bar and the keyboard.
  const plainIs = () => window.evaluate(() => [...document.querySelectorAll('.ProseMirror [data-highlight]')].some((node) => node.textContent === 'Plain'));
  await window.click('.toolbar [aria-label="Undo"]');
  assert.equal(await plainIs(), false);
  assert.deepEqual((await onPage(window)).sort(), expected, 'one Undo takes back one colour and nothing else');
  await window.click('.toolbar [aria-label="Redo"]');
  assert.equal(await plainIs(), true);
  await window.keyboard.press('ControlOrMeta+z');
  assert.equal(await plainIs(), false);
  await window.keyboard.press('ControlOrMeta+Shift+z');
  assert.equal(await plainIs(), true);

  // Coloured words copied and pasted inside the app keep their colour.
  const pinks = () => window.locator('.ProseMirror [data-highlight="#ff00ff"]').count();
  await pause(window, 700);
  await select(window, 'pink');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.copy());
  await pause(window, 200);
  await select(window, 'things');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
  await window.waitForFunction(() => document.querySelectorAll('.ProseMirror [data-highlight="#ff00ff"]').length === 2);
  await window.click('.toolbar [aria-label="Undo"]');
  assert.equal(await pinks(), 1);

  // Where the system uses its own colours, as Windows does in high contrast, a highlight is still marked, in the system's.
  await window.emulateMedia({ forcedColors: 'active' });
  await frames(window);
  const forced = await drawn(window, 'pink', 'data-highlight');
  assert.notEqual(forced.background, rgb(screenColours('light').highlight('#ff00ff')));
  assert.notEqual(forced.background, 'rgba(0, 0, 0, 0)');
  await window.emulateMedia({ forcedColors: 'none' });
  await frames(window);

  // And off again.
  await pause(window, 700);
  await choose(window, 'Plain', 'highlight', 'Remove highlight');
  assert.equal(await plainIs(), false);
  await choose(window, 'words', 'textColor', 'Blue');
  await choose(window, 'words', 'textColor', 'Normal text colour');
  assert.deepEqual((await onPage(window)).sort(), expected);

  // The saved chapter keeps exactly what was chosen, whatever shade the window draws it in.
  const saved = await savedChapter(window);
  assert.deepEqual(marksIn(saved).sort(), [
    ...HIGHLIGHTED.map(([words, , colour]) => [words, 'highlight', colour]),
    ['peach', 'highlight', '#ffd8a8'],
    ...LETTERED.map(([words, , colour]) => [words, 'textColor', colour]),
    ['navy', 'textColor', '#000080'],
    ['crimson', 'highlight', '#ffff00'], ['crimson', 'textColor', '#c00000'], [' on gold', 'highlight', '#ffff00'],
  ].sort());

  // Word counts are as they were, and Find reads straight across a change of colour.
  await pause(window, 600);
  assert.equal(await window.textContent('.page-footer .word-count'), countsBefore);
  await menu(app, 'find');
  await window.waitForSelector('.find-bar:not([hidden])');
  for (const query of ['crimson on gold', 'gold today', 'turquoise pink']) {
    await window.fill('.find-query', query);
    await window.waitForFunction(() => /^1 (of 1|match)/.test(document.querySelector('.find-count').textContent));
  }
  await window.keyboard.press('Escape');
  await window.waitForSelector('.find-bar', { state: 'hidden' });

  // Every theme, in all three Looks, in small windows. The shades are the ones for the theme, and every coloured word can be read.
  const set = async (changes) => {
    await window.evaluate((wanted) => window.storyTracker.saveSettings(wanted), changes);
    await menu(app, 'settings-changed');
    await window.waitForFunction((wanted) => document.documentElement.dataset.theme === wanted.theme && document.documentElement.dataset.surface === wanted.surface, changes);
    await frames(window);
  };
  const combos = Object.entries(THEMES).flatMap(([id, theme]) => (theme.flat ? [[id, 'solid']] : theme.glass ? [[id, 'glass']] : [[id, 'solid'], [id, 'metallic'], [id, 'glass']]));
  assert.deepEqual([...new Set(combos.map(([, look]) => look))].sort(), ['glass', 'metallic', 'solid']);
  const all = await window.evaluate(() => document.querySelectorAll('.ProseMirror [data-highlight], .ProseMirror [data-color]').length);
  const bad = [];
  for (const size of SMALL) {
    await resize(window, size);
    for (const [theme, look] of combos) {
      const where = `${theme} ${look} at ${size.width}x${size.height}`;
      await set({ theme, surface: look });
      const shades = screenColours(theme);
      assert.deepEqual(await drawn(window, 'pink', 'data-highlight'), { color: rgb(shades.highlightInk), background: rgb(shades.highlight('#ff00ff')) }, where);
      assert.equal((await drawn(window, 'red', 'data-color')).color, rgb(shades.text('#c00000')), where);
      assert.equal((await drawn(window, 'crimson', 'data-color')).color, rgb(shades.textOnHighlight('#c00000', '#ffff00')), where);

      // Both buttons are on screen, and nothing is over them.
      for (const type of ['highlight', 'textColor']) {
        const reachable = await window.$eval(button(type), (node) => {
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight && node.contains(hit);
        });
        assert.ok(reachable, `${type} button, ${where}`);
      }

      // A small window shows only some of the page at once, so each coloured word is brought into view and measured there.
      const measured = new Set();
      for (let at = 0; at < all; at += 1) {
        if (measured.has(at)) continue;
        await window.evaluate((index) => document.querySelectorAll('.ProseMirror [data-highlight], .ProseMirror [data-color]')[index].scrollIntoView({ block: 'start' }), at);
        const { failures } = await measure(window, { 'coloured words': '.ProseMirror [data-highlight], .ProseMirror [data-color]' }, { inset: 1 });
        const seen = await window.evaluate(() => {
          const coloured = [...document.querySelectorAll('.ProseMirror [data-highlight], .ProseMirror [data-color]')];
          return window.measured.map((one) => coloured.indexOf(one.node));
        });
        seen.forEach((index) => measured.add(index));
        const bar = await measure(window, { 'formatting bar': '.toolbar .tool' });
        assert.ok(bar.counts['formatting bar'] > 0, where);
        bad.push(...[...failures, ...bar.failures].map((one) => ({ where, ...one })));
        assert.ok(measured.has(at), `coloured word ${at} couldn’t be brought into view, ${where}`);
      }
      assert.equal(measured.size, all, where);

      // The menu fits in the window, and its words and its ticked one can be read.
      await select(window, 'purple');
      // The line under the button shows the colour the page is drawn in, in this theme.
      assert.equal(await window.$eval(`${button('textColor')} .colour-bar`, (node) => getComputedStyle(node).backgroundColor), rgb(shades.text('#7030a0')), where);
      await window.click(button('textColor'));
      const box = await window.$eval('.popup-menu', (node) => node.getBoundingClientRect().toJSON());
      assert.ok(box.left >= 0 && box.top >= 0 && box.right <= size.width && box.bottom <= size.height, `the menu, ${where}: ${JSON.stringify(box)}`);
      const { failures, counts } = await measure(window, { 'colour menu': '.popup-menu [role^="menuitem"] .popup-words' });
      assert.equal(counts['colour menu'], 8, where);
      bad.push(...failures.map((one) => ({ where, ...one })));
      await window.keyboard.press('Escape');
      await window.waitForSelector('.popup-menu', { state: 'detached' });
      // Nothing is left selected: a selection's own colour behind a word isn't what's being measured next.
      await window.evaluate(() => {
        document.activeElement.blur();
        getSelection().removeAllRanges();
      });
    }
  }
  assert.deepEqual(bad, []);
  await set({ theme: 'light', surface: 'solid' });
  await select(window, 'purple');
  await set({ theme: 'dark', surface: 'solid' });
  assert.equal(await window.$eval(`${button('textColor')} .colour-bar`, (node) => getComputedStyle(node).backgroundColor), rgb(screenColours('dark').text('#7030a0')));
  await window.evaluate(() => getSelection().removeAllRanges());

  // Find's marks on coloured words leave them readable, in a light theme and a dark one.
  await resize(window, SMALL[1]);
  for (const theme of ['light', 'dark']) {
    await set({ theme, surface: 'glass' });
    await menu(app, 'find');
    await window.waitForSelector('.find-bar:not([hidden])');
    await window.fill('.find-query', 'e');
    await window.waitForSelector('.ProseMirror .find-match');
    await window.evaluate(() => document.querySelector('.ProseMirror').scrollIntoView({ block: 'start' }));
    // The ring round a match is on its very edge, so this one measures inside it.
    const { failures, counts } = await measure(window, { 'found in colour': '.ProseMirror [data-highlight] .find-match, .ProseMirror [data-color] .find-match' }, { inset: 2 });
    assert.ok(counts['found in colour'] > 0, theme);
    assert.deepEqual(failures, [], theme);
    await window.keyboard.press('Escape');
    await window.waitForSelector('.find-bar', { state: 'hidden' });
  }

  // A comment's tint gives way to its line on coloured words, so it takes nothing from them.
  await resize(window, { width: 1200, height: 800 });
  await set({ theme: 'light', surface: 'solid' });
  await select(window, 'red');
  await window.click('.tool.add-comment');
  await window.fill('.comment-box', 'Is this the right red?');
  await window.click('.comment-save');
  await window.waitForSelector('.ProseMirror .comment-mark [data-color="#c00000"]');
  assert.deepEqual(await window.$eval('.ProseMirror .comment-mark', (node) => [getComputedStyle(node).backgroundColor, getComputedStyle(node).borderBottomWidth]), ['rgba(0, 0, 0, 0)', '2px']);
  await savedChapter(window);

  // Closed and opened again, the colours come back as chosen.
  await set({ theme: 'dark', surface: 'metallic' });
  assert.deepEqual(errors, []);
  await app.close();
  ({ app, window, errors } = await launch());
  await resize(window, { width: 1200, height: 800 });
  await window.waitForSelector('.ProseMirror [data-highlight]');
  assert.deepEqual((await onPage(window)).sort(), expected);
  assert.equal((await drawn(window, 'blue', 'data-color')).color, rgb(screenColours('dark').text('#1f4e9e')));
  assert.deepEqual(marksIn(await savedChapter(window)).length, marksIn(saved).length);

  // The Word and PDF files the app writes, chosen in its own export window, from a dark theme: the files are for paper all the same.
  await app.evaluate(({ dialog }) => {
    global.saveTo = null;
    global.openAt = null;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: global.saveTo });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [global.openAt] });
  });
  const exportAs = async (format) => {
    const file = path.join(work, `book.${format}`);
    await app.evaluate((_electron, value) => { global.saveTo = value; }, file);
    await window.selectOption('#export-format', format);
    await window.click('#export-go');
    await window.waitForSelector('#export-result .export-file', { timeout: 60000 });
    return file;
  };
  await menu(app, 'export-book');
  await window.waitForSelector('#export[open]');

  const word = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(await exportAs('docx'))))['word/document.xml']);
  const runs = [...word.matchAll(/<w:r>(.*?)<\/w:r>/gs)].map((found) => found[1]);
  const inWord = (words) => {
    const run = runs.find((one) => one.includes(`>${words}</w:t>`));
    assert.ok(run, `Word has no run for “${words}”`);
    return [/<w:highlight w:val="([^"]*)"/.exec(run)?.[1] ?? null, /<w:shd [^>]*w:fill="([^"]*)"/.exec(run)?.[1] ?? null, /<w:color w:val="([^"]*)"/.exec(run)?.[1] ?? null];
  };
  assert.deepEqual(['yellow', 'green', 'turquoise', 'pink', 'grey'].map(inWord), [['yellow', null, null], ['green', null, null], ['cyan', null, null], ['magenta', null, null], ['lightGray', null, null]]);
  assert.deepEqual(inWord('peach'), [null, 'ffd8a8', null]);
  assert.deepEqual(['red', 'orange', 'leaf', 'blue', 'purple', 'slate', 'navy'].map((words) => inWord(words)[2]), ['c00000', 'b45309', '2e7d32', '1f4e9e', '7030a0', '666666', '000080']);
  assert.deepEqual(inWord('crimson'), ['yellow', null, 'c00000']);

  const pdf = await exportAs('pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const reading = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), verbosity: 0 });
  const opened = await reading.promise;
  const fills = new Set();
  let printed = '';
  for (let at = 1; at <= opened.numPages; at += 1) {
    const page = await opened.getPage(at);
    printed += (await page.getTextContent()).items.map((one) => one.str).join(' ');
    const list = await page.getOperatorList();
    list.fnArray.forEach((fn, index) => {
      if (fn !== pdfjs.OPS.setFillRGBColor) return;
      const args = list.argsArray[index];
      fills.add(typeof args[0] === 'string' ? args[0].toLowerCase() : `#${Array.from(args).slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`);
    });
  }
  await reading.destroy();
  assert.match(printed, /crimson/);
  // A PDF keeps a colour as three fractions, which can come back one step out.
  const near = (wanted) => [...fills].some((found) => [1, 3, 5].every((from) => Math.abs(parseInt(found.slice(from, from + 2), 16) - parseInt(wanted.slice(from, from + 2), 16)) <= 1));
  for (const colour of ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#c0c0c0', '#ffd8a8', '#c00000', '#b45309', '#2e7d32', '#1f4e9e', '#7030a0', '#666666', '#000080']) {
    assert.ok(near(colour), `the PDF has no ${colour}: ${[...fills].join(' ')}`);
  }

  // Where colour can't go, the app says so: before a Markdown or plain text export, and after exporting everything.
  await window.selectOption('#export-format', 'md');
  await window.waitForFunction(() => document.querySelector('#export-warnings').textContent.includes('Markdown can’t keep colours'));
  assert.match(await window.textContent('#export-warnings'), /the file won’t show them: 7 highlighted passages and 8 coloured passages\. Your project keeps them\./);
  await window.selectOption('#export-format', 'txt');
  await window.waitForFunction(() => document.querySelector('#export-warnings').textContent.includes('Plain text can’t keep colours'));
  await window.selectOption('#export-format', 'docx');
  await window.waitForFunction(() => !document.querySelector('#export-warnings').textContent.includes('colours'));
  const everything = path.join(work, 'everything');
  fs.mkdirSync(everything);
  await app.evaluate((_electron, value) => { global.openAt = value; }, everything);
  await window.click('#export-everything');
  await window.waitForSelector('#export-note', { timeout: 60000 });
  assert.match(await window.textContent('#export-note'), /Chapters are saved as Markdown, which can’t keep colours.*7 highlighted passages and 8 coloured passages/);
  // The note has its own line, inside a small window's export window.
  await resize(window, SMALL[0]);
  const note = await window.$eval('#export-note', (node) => {
    node.scrollIntoView({ block: 'nearest' });
    return { box: node.getBoundingClientRect().toJSON(), inside: node.closest('dialog').getBoundingClientRect().toJSON() };
  });
  assert.ok(note.box.left >= note.inside.left && note.box.right <= note.inside.right, JSON.stringify(note));
  await window.click('#export-close');

  // RT Markdown Reader gets Markdown. The author is told, and so is the Reader.
  await resize(window, { width: 1200, height: 800 });
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  await window.click('#prefs-tab-apps');
  await window.check('#pref-link');
  await window.click('[aria-label="Link RT Markdown Reader"]');
  await window.waitForSelector('[aria-label="Remove the link to RT Markdown Reader"]');
  await window.click('#pref-close');
  await menu(app, 'reader-chapter');
  await window.waitForSelector('.room-message:not([hidden]) >> text=Markdown can’t keep colours');
  assert.match(await window.textContent('.room-message'), /Markdown can’t keep colours, so the copy won’t show them: 7 highlighted passages and 8 coloured passages\. They’re still here\./);
  assert.deepEqual(arrived.at(-1).dropped, [{ what: 'highlight', count: 7 }, { what: 'text-color', count: 8 }]);
  assert.match(arrived.at(-1).text, /crimson on gold/);
  await menu(app, 'reader-publish');
  await window.waitForSelector('.room-message:not([hidden]) >> text=what you publish won’t show them');
  assert.equal(arrived.at(-1).intent, 'publish');

  // Side by side, each page has its own two buttons and colours its own words.
  await window.click('.message-close');
  await window.click('#add-chapter');
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 2' && document.querySelector('.ProseMirror').textContent === '');
  await window.click('.ProseMirror');
  await window.keyboard.type('Second page.');
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  await window.waitForSelector('.ProseMirror [data-highlight]');
  await window.locator('#chapter-list .row', { hasText: 'Chapter 2' }).hover();
  await window.click('[aria-label="Open Chapter 2 beside"]');
  await window.waitForFunction(() => document.querySelectorAll('.ProseMirror').length === 2);
  assert.equal(await window.locator('.toolbar .colour-tool:visible').count(), 4);

  assert.deepEqual(errors, []);
  await app.close();
  await reader.stop();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  console.log('colours e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
