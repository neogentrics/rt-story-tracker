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
const { HELP_TOPICS } = require('../src/shared/help-pages');
const { ITEMS, SHORTCUTS, defaultKey, showKeys } = require('../src/shared/shortcuts');

function menuFor({ platform = 'linux', version = '3.10.0', updateReady = null } = {}) {
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
    const template = buildMenu({ send: (command) => sent.push(command), checkForUpdates: () => sent.push('check'), about: () => sent.push('about-box'), version, updateReady });
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

test('the Help menu keeps the standard’s order, says Restart to Update once one is ready, and leaves Tutorial out until it exists', () => {
  const order = ['Help Center', 'Check for Updates…', 'About RT Story Tracker 3.10.0'];
  const labelsNow = labels(menuFor().template.find((menu) => menu.label === 'Help').submenu).filter((label) => order.includes(label));
  assert.deepEqual(labelsNow, order, 'Help Center, then Check for Updates, then About with the version');
  const ready = menuFor({ updateReady: '3.11.0' });
  const help = ready.template.find((menu) => menu.label === 'Help').submenu;
  assert.equal(labels(help).includes('Check for Updates…'), false);
  const restart = help.find((item) => item.label === 'Restart to Update (3.11.0)');
  restart.click();
  assert.deepEqual(ready.sent, ['restart-to-update']);
  assert.equal(labels(menuFor().template.flatMap((menu) => menu.submenu ?? [])).includes('Tutorial'), false, 'no dead Tutorial item');
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

test('File stays short, as the Reader’s does: the project’s own commands are in a This Project submenu', () => {
  const REAL = (items) => items.filter((item) => item.type !== 'separator');
  for (const platform of ['linux', 'darwin']) {
    const { template } = menuFor({ platform });
    for (const menu of template) assert.ok(REAL(menu.submenu).length <= 20, `${menu.label} has ${REAL(menu.submenu).length} items`);
    const file = REAL(template.find((menu) => menu.label === 'File').submenu);
    assert.ok(file.length <= 14, `File has ${file.length} items`);
  }
  const file = menuFor().template.find((menu) => menu.label === 'File').submenu;
  const project = file.find((item) => item.label === 'This Project').submenu;
  assert.deepEqual(REAL(project).map((item) => item.label), [
    'Import…', 'Find My Files…', 'Check Folder for Changes…', 'Files…', 'Book Details…', 'Earlier Versions of This Chapter…', 'Trash',
    'Documents Sent Here…', 'Open Chapter in RT Markdown Reader', 'Open Book in RT Markdown Reader', 'Publish Chapter with RT Markdown Reader…',
    'Password and Lock…', 'Lock Project',
  ]);
  const top = labels(file);
  for (const moved of ['Import…', 'Find My Files…', 'Check Folder for Changes…', 'Files…', 'Book Details…', 'Documents Sent Here…', 'Earlier Versions of This Chapter…', 'Trash', 'Password and Lock…', 'Lock Project']) {
    assert.equal(top.includes(moved), false, `${moved} is in This Project, not File`);
  }
  assert.deepEqual(top.filter((label) => label !== '-'), ['New Chapter', 'New Book', 'Open…', 'Save a Copy…', 'This Project', 'Export…', 'Print…', 'Library', 'Exit'], 'Export and Print are at the top level, as in the Reader');
  // They still work, with the keys they had.
  const again = menuFor();
  const topAgain = again.template.find((menu) => menu.label === 'File').submenu;
  const keyed = [...topAgain, ...topAgain.find((item) => item.label === 'This Project').submenu];
  assert.deepEqual(['Import…', 'Export…', 'Print…'].map((name) => keyed.find((item) => item.label === name).accelerator), ['CmdOrCtrl+Shift+I', 'CmdOrCtrl+E', 'CmdOrCtrl+P']);
  keyed.find((item) => item.label === 'Import…').click();
  keyed.find((item) => item.label === 'Print…').click();
  assert.deepEqual(again.sent, ['import', 'print']);
});

test('the words are the Reader’s where it has them: Open…, Exit, Check for Updates… and Restart to update', () => {
  const file = menuFor().template.find((menu) => menu.label === 'File').submenu;
  assert.equal(labels(file).includes('Open…'), true);
  assert.equal(labels(file).includes('Open Project File…'), false);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  for (const words of ['You’re up to date', 'is ready to install', 'Couldn’t check for updates', "title: 'Check for Updates'"]) assert.ok(main.includes(words), words);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  for (const words of ['is ready to install.', 'Restart to update', 'is available.', 'Download']) assert.ok(app.includes(words), words);
  assert.equal(/is out\./.test(app), false);
});

test('Preferences ends the Edit menu, as in the Reader, and on a Mac it’s in the app menu; View keeps zoom in a submenu', () => {
  const { template } = menuFor();
  const menu = (name, from = template) => from.find((one) => one.label === name).submenu;
  assert.deepEqual(labels(menu('Edit')).slice(-2), ['-', 'Preferences…']);
  assert.equal(labels(menu('File')).includes('Preferences…'), false);
  const mac = menuFor({ platform: 'darwin' }).template;
  assert.equal(labels(menu('Edit', mac)).includes('Preferences…'), false);
  assert.equal(labels(menu('RT Story Tracker', mac)).includes('Preferences…'), true);
  assert.deepEqual(menu('View').find((item) => item.label === 'Zoom').submenu.map((item) => item.role), ['zoomIn', 'zoomOut', 'resetZoom']);
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

test('every shortcut the Shortcuts page lists is one the menu has, with its key and its command, and the other way round', () => {
  for (const platform of ['linux', 'darwin']) {
    const { template, sent } = menuFor({ platform });
    const found = [];
    const walk = (items) => {
      for (const item of items) {
        if (item.submenu) walk(item.submenu);
        // A choice among several, such as the Look, is a setting rather than a command, and has no shortcut.
        else if (item.click && !item.role && item.type !== 'radio') found.push(item);
      }
    };
    walk(template.flatMap((menu) => menu.submenu));
    for (const item of ITEMS) {
      const hit = found.filter((entry) => {
        // Not every item sends something, such as the looks, so what the one before sent mustn't count.
        sent.length = 0;
        entry.click();
        return sent.at(-1) === item.command;
      });
      assert.equal(hit.length, 1, `${item.does} (${item.command}) is one menu item on ${platform}`);
      assert.equal(hit[0].accelerator, defaultKey(item, platform) || undefined, `${item.does} has its key on ${platform}`);
    }
    const commands = new Set(ITEMS.map((item) => item.command));
    for (const entry of found) {
      sent.length = 0;
      entry.click();
      const command = sent[0];
      if (command === 'check' || command === 'about-box' || command === 'restart-to-update') continue;
      assert.ok(commands.has(command), `${entry.label} (${command}) is on the Shortcuts page`);
    }
    // An accelerator the menu has but the page doesn't list would be a key the author can't see or change.
    const lastKeys = found.map((entry) => entry.accelerator).filter(Boolean);
    const listed = ITEMS.map((item) => defaultKey(item, platform)).filter(Boolean);
    assert.deepEqual([...lastKeys].sort(), [...listed].sort(), `${platform}: the keys in the menu are the keys on the page`);
  }
});

test('shortcuts read the way this computer says them, and the pages have words in them', () => {
  assert.equal(showKeys('CmdOrCtrl+E', 'win32'), 'Ctrl+E');
  assert.equal(showKeys('CmdOrCtrl+E', 'darwin'), 'Cmd+E');
  const replace = ITEMS.find((item) => item.does === 'Replace');
  assert.deepEqual([showKeys(defaultKey(replace, 'linux'), 'linux'), showKeys(defaultKey(replace, 'darwin'), 'darwin')], ['Ctrl+H', 'Cmd+Option+F']);
  assert.ok(HELP_TOPICS.length >= 5);
  for (const topic of HELP_TOPICS) assert.ok(topic.title && topic.body.length && topic.body.every((text) => text.length > 40), topic.id);
  assert.equal(new Set(HELP_TOPICS.map((topic) => topic.id)).size, HELP_TOPICS.length);
});

test('the Help Center doesn’t name a key, because a key can be changed', () => {
  assert.equal(/\b(Ctrl|Cmd)\+\w/.test(JSON.stringify(HELP_TOPICS)), false);
});

test('nothing in the help words names anyone’s book, or reads like it was written for one author', () => {
  const all = JSON.stringify([HELP_TOPICS, SHORTCUTS, ABOUT, BLURB]);
  assert.equal(/\b(Recon Towers universe|dossier|canon|Marit|Vance)\b/i.test(all), false);
});
