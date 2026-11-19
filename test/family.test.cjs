'use strict';
// Looking like the rest of the family: the Help menu, the About window's words and links, and the Help Center and Shortcuts pages.
// The menu is built with a stand-in for Electron's Menu, so what's in it can be read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { ABOUT, APP_NAME, BLURB, HELP_MENU, LINKS, REPO, WEBSITE, copyright, detailsText, versionWords } = require('../src/shared/family');
const { HELP_TOPICS, SHORTCUTS, showKeys } = require('../src/shared/help-pages');

function menuFor({ platform = 'linux', version = '3.10.0' } = {}) {
  const sent = [];
  const real = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'electron' ? { Menu: { buildFromTemplate: (template) => template } } : real.call(this, request, ...rest);
  };
  const was = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    delete require.cache[require.resolve('../src/main/menu')];
    const { buildMenu } = require('../src/main/menu');
    const template = buildMenu({ send: (command) => sent.push(command), checkForUpdates: () => sent.push('check'), about: () => sent.push('about-box'), version });
    return { template, sent };
  } finally {
    Object.defineProperty(process, 'platform', was);
    Module._load = real;
    delete require.cache[require.resolve('../src/main/menu')];
  }
}

const labels = (items) => items.map((item) => (item.type === 'separator' ? '-' : item.label ?? item.role));

test('the Help menu has the Reader’s items in its order, with the version in About, and not the ones that aren’t here yet', () => {
  const { template } = menuFor();
  const help = template.find((menu) => menu.label === 'Help').submenu;
  assert.deepEqual(labels(help), ['Help Center', 'Keyboard Shortcuts', '-', 'Check for Updates…', '-', 'About RT Story Tracker 3.10.0']);
  assert.equal(help[0].accelerator, 'F1');
  assert.equal(labels(help).some((label) => /tutorial|find a command/i.test(label)), false);
  assert.equal(HELP_MENU.about('3.7.1'), 'About RT Story Tracker 3.7.1');
});

test('each Help item asks the window for its page, and About is in the window, not a native box', () => {
  const { template, sent } = menuFor();
  const help = template.find((menu) => menu.label === 'Help').submenu.filter((item) => item.click);
  for (const item of help) item.click();
  assert.deepEqual(sent, ['help-center', 'shortcuts', 'check', 'about-box'], 'About’s click is the app’s, which sends the window its command');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /webContents\.send\('menu:command', 'about'\)/, 'About is shown by the page');
  assert.equal(/title: 'About RT Story Tracker'[\s\S]{0,80}Built by/.test(main), false, 'the old native box with its own text is gone');
});

test('on a Mac, About is in the app menu with the version, and the Help menu doesn’t repeat it', () => {
  const { template } = menuFor({ platform: 'darwin' });
  assert.equal(template[0].label, 'RT Story Tracker');
  assert.equal(template[0].submenu[0].label, 'About RT Story Tracker 3.10.0');
  assert.deepEqual(labels(template.find((menu) => menu.label === 'Help').submenu), ['Help Center', 'Keyboard Shortcuts', '-', 'Check for Updates…']);
});

test('File ends with Exit where there is no app menu, Edit has Find Next and Previous, and the others keep their items', () => {
  const { template } = menuFor();
  const file = template.find((menu) => menu.label === 'File').submenu;
  assert.equal(file.at(-1).label, 'Exit');
  assert.equal(file.at(-1).role, 'quit');
  const edit = template.find((menu) => menu.label === 'Edit').submenu;
  const next = edit.find((item) => item.label === 'Find Next');
  const previous = edit.find((item) => item.label === 'Find Previous');
  assert.deepEqual([next.accelerator, previous.accelerator], ['F3', 'Shift+F3']);
  const { sent } = menuFor();
  assert.deepEqual(sent, []);
  const again = menuFor();
  again.template.find((menu) => menu.label === 'Edit').submenu.find((item) => item.label === 'Find Next').click();
  again.template.find((menu) => menu.label === 'Edit').submenu.find((item) => item.label === 'Find Previous').click();
  assert.deepEqual(again.sent, ['find-next', 'find-previous']);
  assert.equal(labels(menuFor({ platform: 'darwin' }).template.find((menu) => menu.label === 'File').submenu).includes('Exit'), false, 'a Mac quits from its own menu');
});

test('the About words and links are the Reader’s, pointed at this app', () => {
  assert.deepEqual(ABOUT.rows.map((row) => [row.id, row.label]), [
    ['website', 'Website'],
    ['notes', 'What’s new in this version'],
    ['issue', 'Report a problem or suggest a feature'],
    ['source', 'Source code'],
  ]);
  assert.deepEqual([ABOUT.license, ABOUT.notices, ABOUT.copy, ABOUT.done], ['License', 'Open-source notices', 'Copy Version Details', 'Done']);
  assert.equal(ABOUT.rows[0].note, 'RT Story Tracker on Recon Towers');
  assert.equal(ABOUT.rows[3].note, 'github.com/neogentrics/rt-story-tracker');
  assert.equal(LINKS.website(), 'https://recontowers.com/projects/storytracker/');
  assert.equal(LINKS.notes('3.10.0'), 'https://github.com/neogentrics/rt-story-tracker/releases/tag/v3.10.0');
  assert.equal(LINKS.issue(), 'https://github.com/neogentrics/rt-story-tracker/issues/new');
  assert.equal(LINKS.source(), 'https://github.com/neogentrics/rt-story-tracker');
  assert.equal(LINKS.license(), `${REPO}/blob/master/LICENSE`);
  assert.equal(LINKS.notices(), `${REPO}/blob/master/THIRD_PARTY_NOTICES.md`);
  for (const make of Object.values(LINKS)) assert.match(make('1.2.3'), /^https:\/\/(recontowers\.com|github\.com\/neogentrics)\//);
  assert.equal(WEBSITE, LINKS.website());
  assert.match(BLURB, /write a book/);
  assert.equal(copyright(2026), '© 2026 Recon Towers. All rights reserved.');
  assert.equal(versionWords({ version: '3.10.0' }), 'Version 3.10.0');
  assert.equal(versionWords({ version: '3.10.0', portable: true }), 'Version 3.10.0 (portable)');
  assert.equal(APP_NAME, 'RT Story Tracker');
});

test('the files the About links point at are really in the repo', () => {
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
});

test('Copy Version Details is the version, the engine and the system, and nothing about the person', () => {
  const text = detailsText({ version: '3.10.0', portable: false, electron: '40.1.0', chrome: '140.0.1', node: '26.0.0', os: 'Linux 6.8.0 (x64)' });
  assert.equal(text, 'RT Story Tracker 3.10.0\nElectron 40.1.0 · Chromium 140.0.1 · Node 26.0.0\nLinux 6.8.0 (x64)');
  for (const private_ of [os.hostname(), os.userInfo().username, os.homedir()]) assert.equal(text.includes(private_), false);
  assert.match(detailsText({ version: '3.10.0', portable: true, electron: '1', chrome: '1', node: '1', os: 'x' }), /^RT Story Tracker 3\.10\.0 \(portable\)/);
});

test('the window can only ask for a link by its name, and the addresses never come from the window', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /Object\.hasOwn\(LINKS, id\)/);
  assert.match(main, /shell\.openExternal\(LINKS\[id\]\(app\.getVersion\(\)\)\)/);
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'about-dialog.js'), 'utf8');
  assert.equal(/https?:\/\//.test(renderer), false, 'the dialog holds no address of its own');
});

test('every shortcut the Shortcuts page lists is one the menu has, and every one the menu has is listed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'menu.js'), 'utf8');
  const inMenu = new Set();
  for (const [, text] of source.matchAll(/accelerator: (.*?), click/g)) for (const [, key] of text.matchAll(/'([^']+)'/g)) inMenu.add(key);
  inMenu.add(HELP_MENU.center.accelerator);
  const listed = new Set(SHORTCUTS.flatMap((group) => group.items.flatMap((item) => [item.keys, item.macKeys].filter(Boolean))));
  assert.deepEqual([...inMenu].filter((key) => !listed.has(key)), [], 'a menu shortcut missing from the page');
  assert.deepEqual([...listed].filter((key) => !inMenu.has(key)), [], 'a shortcut on the page that the menu doesn’t have');
});

test('shortcuts read the way this computer says them, and the pages have words in them', () => {
  const save = SHORTCUTS.flatMap((group) => group.items).find((item) => item.does === 'Export');
  assert.equal(showKeys(save, 'win32'), 'Ctrl+E');
  assert.equal(showKeys(save, 'darwin'), 'Cmd+E');
  const replace = SHORTCUTS.flatMap((group) => group.items).find((item) => item.does === 'Replace');
  assert.deepEqual([showKeys(replace, 'linux'), showKeys(replace, 'darwin')], ['Ctrl+H', 'Cmd+Alt+F']);
  assert.ok(HELP_TOPICS.length >= 5);
  for (const topic of HELP_TOPICS) assert.ok(topic.title && topic.body.length && topic.body.every((text) => text.length > 40), topic.id);
  assert.equal(new Set(HELP_TOPICS.map((topic) => topic.id)).size, HELP_TOPICS.length);
});

test('nothing in the help words names anyone’s book, or reads like it was written for one author', () => {
  const all = JSON.stringify([HELP_TOPICS, SHORTCUTS, ABOUT, BLURB]);
  assert.equal(/\b(Recon Towers universe|dossier|canon|Marit|Vance)\b/i.test(all), false);
});
