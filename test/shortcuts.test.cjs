'use strict';
// Changing a keyboard shortcut: which keys may be used, who has which, what's kept in the settings, and that the menu takes the new key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { ITEMS, RESERVED, checkKey, cleanShortcuts, defaultKey, keyFromPress, resolveKeys, showKeys, usable, wellFormed, withKey } = require('../src/shared/shortcuts');
const { DEFAULT_SETTINGS, cleanSettings } = require('../src/shared/themes');
const { Settings } = require('../src/main/settings');

const press = (code, mods = {}, key = 'x') => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('every command has its own id and what it does, and no two start with the same key', () => {
  assert.equal(new Set(ITEMS.map((item) => item.id)).size, ITEMS.length);
  assert.equal(new Set(ITEMS.map((item) => item.command)).size, ITEMS.length);
  assert.equal(new Set(ITEMS.map((item) => item.does)).size, ITEMS.length);
  for (const platform of ['linux', 'win32', 'darwin']) {
    const keys = ITEMS.map((item) => defaultKey(item, platform)).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, platform);
    for (const key of keys) {
      assert.ok(wellFormed(key) && usable(key), `${key} is a key the rules would allow`);
    }
  }
});

test('only two starting keys are also the writing page’s, and their own commands can always go back to them', () => {
  const shared = ITEMS.filter((item) => Object.hasOwn(RESERVED, defaultKey(item, 'linux')));
  assert.deepEqual(shared.map((item) => item.id), ['library', 'saveCopy']);
  for (const item of shared) {
    assert.deepEqual(checkKey(item.keys, item.id, { [item.id]: 'F6' }, 'linux'), { ok: true });
    assert.equal(checkKey(item.keys, 'trash', { [item.id]: 'F6' }, 'linux').ok, false, 'no other command can take it');
  }
});

test('every key the writing page’s editor binds is kept for it', () => {
  // The editor's own keys, for the parts of it this app turns on (see src/renderer/page.js). Code and code blocks are off.
  for (const key of ['B', 'I', 'U', 'Z', 'Y', 'A', 'Shift+Z', 'Shift+S', 'Shift+B', 'Shift+7', 'Shift+8', 'Shift+L', 'Shift+E', 'Shift+R', 'Shift+J', 'Alt+0', 'Alt+1', 'Alt+2', 'Alt+3', 'Return', 'Backspace', 'Delete']) {
    assert.ok(Object.hasOwn(RESERVED, `CmdOrCtrl+${key}`), key);
  }
});

test('with nothing changed, each command has the key it started with', () => {
  const keys = resolveKeys({}, 'linux');
  assert.deepEqual([keys.exportBook, keys.replace, keys.helpCenter, keys.trash], ['CmdOrCtrl+E', 'CmdOrCtrl+H', 'F1', '']);
  assert.equal(resolveKeys(undefined, 'darwin').replace, 'CmdOrCtrl+Alt+F');
});

test('a press becomes a key, written the same way whatever order it was pressed in', () => {
  assert.deepEqual(keyFromPress(press('KeyJ', { ctrlKey: true, shiftKey: true, altKey: true }), 'linux'), { accelerator: 'CmdOrCtrl+Alt+Shift+J' });
  assert.deepEqual(keyFromPress(press('KeyJ', { metaKey: true }), 'darwin'), { accelerator: 'CmdOrCtrl+J' });
  assert.deepEqual(keyFromPress(press('Digit7', { ctrlKey: true, shiftKey: true }, '&'), 'win32'), { accelerator: 'CmdOrCtrl+Shift+7' }, 'the key’s place, not the symbol Shift makes');
  assert.deepEqual(keyFromPress(press('F6', {}, 'F6'), 'win32'), { accelerator: 'F6' });
  assert.deepEqual(keyFromPress(press('Comma', { ctrlKey: true }, ','), 'linux'), { accelerator: 'CmdOrCtrl+,' });
  assert.deepEqual(keyFromPress(press('Equal', { ctrlKey: true }, '='), 'linux'), { accelerator: 'CmdOrCtrl+Plus' });
  for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']) assert.deepEqual(keyFromPress(press('ControlLeft', {}, key), 'linux'), { waiting: true }, key);
  assert.ok(keyFromPress(press('KeyJ', { metaKey: true }), 'win32').problem, 'the Windows key is the system’s');
  assert.ok(keyFromPress(press('KeyJ', { ctrlKey: true }), 'darwin').problem, 'a Mac uses Cmd');
  assert.ok(keyFromPress(press('MediaPlayPause', {}, 'MediaPlayPause'), 'linux').problem);
});

test('a key that would get in the way of typing, or that the program needs, is refused in plain words', () => {
  for (const key of ['J', 'Shift+J', 'Alt+J', 'Space', 'Return', 'Shift+Tab']) {
    const verdict = checkKey(key, 'exportBook', {}, 'linux');
    assert.equal(verdict.ok, false, key);
    assert.match(verdict.reason, /get in the way of typing/);
  }
  assert.match(checkKey('CmdOrCtrl+C', 'exportBook', {}, 'linux').reason, /^Ctrl\+C is for copying and can’t be changed\.$/);
  for (const key of Object.keys(RESERVED)) assert.equal(checkKey(key, 'exportBook', {}, 'linux').ok, false, key);
  assert.deepEqual(checkKey('F6', 'exportBook', {}, 'linux'), { ok: true });
  assert.deepEqual(checkKey('CmdOrCtrl+J', 'exportBook', {}, 'linux'), { ok: true });
});

test('one key is never two commands: the one that has it is named, and the key it left is free', () => {
  assert.match(checkKey('CmdOrCtrl+P', 'exportBook', {}, 'linux').reason, /Ctrl\+P is already Print\. Choose another key, or change that one first\./);
  assert.deepEqual(checkKey('CmdOrCtrl+E', 'exportBook', {}, 'linux'), { ok: true }, 'its own key is fine');
  const moved = withKey({}, 'print', 'CmdOrCtrl+J', 'linux');
  assert.deepEqual(checkKey('CmdOrCtrl+P', 'exportBook', moved, 'linux'), { ok: true });
  assert.match(checkKey('CmdOrCtrl+J', 'exportBook', moved, 'linux').reason, /already Print/);
});

test('only the changes are kept, and putting a key back forgets the change', () => {
  const changed = withKey({}, 'exportBook', 'CmdOrCtrl+J', 'linux');
  assert.deepEqual(changed, { exportBook: 'CmdOrCtrl+J' });
  assert.deepEqual(withKey(changed, 'exportBook', 'CmdOrCtrl+E', 'linux'), {});
  assert.deepEqual(withKey({}, 'replace', 'CmdOrCtrl+Alt+F', 'darwin'), {}, 'the starting key is the one for this computer');
  assert.deepEqual(withKey({}, 'exportBook', '', 'linux'), { exportBook: '' }, 'no key at all is a choice too');
});

test('a spoiled or hand-edited settings file can’t give a bad key, and can’t give one key to two commands', () => {
  const spoiled = { exportBook: 'J', print: 'CmdOrCtrl+C', find: 'Shift+CmdOrCtrl+J', lookup: 5, nothing: 'CmdOrCtrl+J', constructor: 'CmdOrCtrl+J', library: 'CmdOrCtrl+Nope', import: 'CmdOrCtrl+J' };
  assert.deepEqual(cleanShortcuts(spoiled), { import: 'CmdOrCtrl+J' });
  for (const value of [null, undefined, 'text', 7]) assert.deepEqual(cleanShortcuts(value), {});
  const twice = resolveKeys({ import: 'CmdOrCtrl+J', exportBook: 'CmdOrCtrl+J' }, 'linux');
  assert.equal(Object.values(twice).filter((key) => key === 'CmdOrCtrl+J').length, 1);
  const shadow = resolveKeys({ lookup: 'CmdOrCtrl+P' }, 'linux');
  assert.deepEqual([shadow.lookup, shadow.print], ['CmdOrCtrl+P', ''], 'the author’s choice wins over another command’s starting key');
  for (const keys of [twice, shadow]) {
    const used = Object.values(keys).filter(Boolean);
    assert.equal(new Set(used).size, used.length);
  }
});

test('the shortcuts are kept with this computer’s settings, and are there next time', (t) => {
  assert.deepEqual(DEFAULT_SETTINGS.shortcuts, {});
  assert.deepEqual(cleanSettings({ shortcuts: { exportBook: 'CmdOrCtrl+J', print: 'x' } }).shortcuts, { exportBook: 'CmdOrCtrl+J' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-keys-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  new Settings(root).save({ shortcuts: { exportBook: 'CmdOrCtrl+J' } });
  const again = new Settings(root);
  assert.deepEqual(again.values.shortcuts, { exportBook: 'CmdOrCtrl+J' });
  again.save({ theme: 'plum' });
  assert.deepEqual(again.values.shortcuts, { exportBook: 'CmdOrCtrl+J' }, 'changing something else leaves them');
  again.save({ shortcuts: {} });
  assert.deepEqual(new Settings(root).values.shortcuts, {}, 'Reset all is remembered');
});

test('the menu is built with the author’s keys, and a command with no key takes none', () => {
  const real = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'electron' ? { Menu: { buildFromTemplate: (template) => template } } : real.call(this, request, ...rest);
  };
  let template;
  try {
    delete require.cache[require.resolve('../src/main/menu')];
    const { buildMenu } = require('../src/main/menu');
    const keys = resolveKeys({ exportBook: 'CmdOrCtrl+J', print: '', trash: 'F6' }, process.platform);
    template = buildMenu({ send: () => {}, checkForUpdates: () => {}, about: () => {}, version: '1.0.0', keys });
  } finally {
    Module._load = real;
    delete require.cache[require.resolve('../src/main/menu')];
  }
  const all = [];
  const walk = (items) => items.forEach((item) => (item.submenu ? walk(item.submenu) : all.push(item)));
  walk(template);
  const key = (label) => all.find((item) => item.label === label).accelerator;
  assert.deepEqual([key('Export…'), key('Print…'), key('Trash'), key('Find…')], ['CmdOrCtrl+J', undefined, 'F6', 'CmdOrCtrl+F']);
});

test('View, Look has the three looks, ticks the one that’s drawn, and only offers what the theme can be', () => {
  const real = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'electron' ? { Menu: { buildFromTemplate: (template) => template } } : real.call(this, request, ...rest);
  };
  const chosen = [];
  try {
    delete require.cache[require.resolve('../src/main/menu')];
    const { buildMenu } = require('../src/main/menu');
    const looks = (settings) => buildMenu({ send: () => {}, checkForUpdates: () => {}, about: () => {}, version: '1.0.0', settings, setLook: (id) => chosen.push(id) })
      .find((menu) => menu.label === 'View').submenu.find((item) => item.label === 'Look').submenu;
    const state = (settings) => looks(settings).map((item) => `${item.label}:${item.checked ? 'ticked' : '-'}:${item.enabled ? 'on' : 'off'}`);
    assert.deepEqual(state({ theme: 'sepia', surface: 'metallic' }), ['Solid:-:on', 'Metallic:ticked:on', 'Glass:-:on']);
    assert.deepEqual(state({ theme: 'system', surface: 'glass' }), ['Solid:-:on', 'Metallic:-:on', 'Glass:ticked:on']);
    assert.deepEqual(state({ theme: 'aero', surface: 'metallic' }), ['Solid:-:off', 'Metallic:-:off', 'Glass:ticked:on']);
    assert.deepEqual(state({ theme: 'contrast', surface: 'glass' }), ['Solid:ticked:on', 'Metallic:-:off', 'Glass:-:off']);
    assert.deepEqual(state(undefined), ['Solid:ticked:on', 'Metallic:-:on', 'Glass:-:on'], 'before the settings have been read');
    assert.deepEqual(looks({}).map((item) => item.type), ['radio', 'radio', 'radio']);
    looks({}).forEach((item) => item.click());
    assert.deepEqual(chosen, ['solid', 'metallic', 'glass']);
  } finally {
    Module._load = real;
    delete require.cache[require.resolve('../src/main/menu')];
  }
});

test('keys read the way this computer says them', () => {
  assert.deepEqual([showKeys('CmdOrCtrl+Alt+J', 'win32'), showKeys('CmdOrCtrl+Alt+J', 'darwin')], ['Ctrl+Alt+J', 'Cmd+Option+J']);
});
