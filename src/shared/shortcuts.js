'use strict';
// Every command in the menus that can have a key of its own, the keys it has to begin with, and the rules for changing them. The menu is
// built from this, the Keyboard Shortcuts page lists it, and a test builds the menu and checks the two agree, so neither can drift.
//
// A key is written the way Electron writes an accelerator: CmdOrCtrl (Ctrl, or Cmd on a Mac), then Alt, then Shift, then the key. Always
// in that order, so two spellings of the same key are the same text and can be compared.
//
// Not here, on purpose: the editing keys (copy, paste, undo, zoom, full screen) and what the writing page itself does with bold and italic.
// Those stay as every other program has them, so no choice made here can break typing.

const GROUPS = [
  {
    group: 'Writing',
    items: [
      { id: 'newChapter', command: 'new-chapter', does: 'New chapter', keys: 'CmdOrCtrl+N' },
      { id: 'newBook', command: 'new-book', does: 'New book', keys: 'CmdOrCtrl+Shift+N' },
      { id: 'find', command: 'find', does: 'Find', keys: 'CmdOrCtrl+F' },
      { id: 'replace', command: 'replace', does: 'Replace', keys: 'CmdOrCtrl+H', macKeys: 'CmdOrCtrl+Alt+F' },
      { id: 'findNext', command: 'find-next', does: 'Find the next match', keys: 'F3' },
      { id: 'findPrevious', command: 'find-previous', does: 'Find the previous match', keys: 'Shift+F3' },
      { id: 'focus', command: 'focus', does: 'Focus mode', keys: 'CmdOrCtrl+Shift+F' },
    ],
  },
  {
    group: 'Views',
    items: [
      { id: 'showWrite', command: 'show-write', does: 'Write', keys: 'CmdOrCtrl+1' },
      { id: 'showRecords', command: 'show-records', does: 'Records', keys: 'CmdOrCtrl+2' },
      { id: 'lookup', command: 'lookup', does: 'Look up a record', keys: 'CmdOrCtrl+K' },
      { id: 'library', command: 'library', does: 'Library', keys: 'CmdOrCtrl+Shift+L' },
      { id: 'trash', command: 'trash', does: 'Trash', keys: '' },
    ],
  },
  {
    group: 'Projects',
    items: [
      { id: 'openFile', command: 'open-file', does: 'Open a project file', keys: 'CmdOrCtrl+O' },
      { id: 'saveCopy', command: 'export', does: 'Save a copy of this project', keys: 'CmdOrCtrl+Shift+S' },
      { id: 'import', command: 'import', does: 'Import', keys: 'CmdOrCtrl+Shift+I' },
      { id: 'exportBook', command: 'export-book', does: 'Export', keys: 'CmdOrCtrl+E' },
      { id: 'print', command: 'print', does: 'Print', keys: 'CmdOrCtrl+P' },
      { id: 'lock', command: 'lock', does: 'Lock the project', keys: 'CmdOrCtrl+L' },
      { id: 'security', command: 'security', does: 'Password and lock', keys: '' },
      { id: 'findFiles', command: 'find-files', does: 'Find my files', keys: '' },
      { id: 'attachments', command: 'attachments', does: 'Attachments', keys: '' },
      { id: 'details', command: 'details', does: 'Book details', keys: '' },
      { id: 'history', command: 'history', does: 'Earlier versions of this chapter', keys: '' },
      { id: 'inbox', command: 'inbox', does: 'Documents sent here', keys: '' },
      { id: 'readerChapter', command: 'reader-chapter', does: 'Open this chapter in RT Markdown Reader', keys: '' },
      { id: 'readerBook', command: 'reader-book', does: 'Open this book in RT Markdown Reader', keys: '' },
      { id: 'readerPublish', command: 'reader-publish', does: 'Publish this chapter with RT Markdown Reader', keys: '' },
    ],
  },
  {
    group: 'The app',
    items: [
      { id: 'preferences', command: 'preferences', does: 'Preferences', keys: 'CmdOrCtrl+,' },
      { id: 'helpCenter', command: 'help-center', does: 'Help Center', keys: 'F1' },
      { id: 'shortcuts', command: 'shortcuts', does: 'Keyboard Shortcuts', keys: '' },
    ],
  },
];

const SHORTCUTS = GROUPS;
const ITEMS = GROUPS.flatMap((group) => group.items);
const IDS = new Set(ITEMS.map((item) => item.id));
const MODIFIERS = ['CmdOrCtrl', 'Alt', 'Shift'];

// What the keys the program itself uses do. They aren't offered, so a change here can't take one from the editing menu or the page.
const RESERVED = {
  'CmdOrCtrl+Z': 'undoing',
  'CmdOrCtrl+Shift+Z': 'redoing',
  'CmdOrCtrl+Y': 'redoing',
  'CmdOrCtrl+X': 'cutting',
  'CmdOrCtrl+C': 'copying',
  'CmdOrCtrl+V': 'pasting',
  'CmdOrCtrl+A': 'selecting everything',
  'CmdOrCtrl+B': 'bold',
  'CmdOrCtrl+I': 'italic',
  'CmdOrCtrl+U': 'underline',
  // The rest of what the writing page does from the keyboard (its editor's own keys).
  'CmdOrCtrl+Shift+S': 'striking through',
  'CmdOrCtrl+Shift+B': 'quoting',
  'CmdOrCtrl+Shift+7': 'numbered lists',
  'CmdOrCtrl+Shift+8': 'bulleted lists',
  'CmdOrCtrl+Shift+L': 'aligning left',
  'CmdOrCtrl+Shift+E': 'centring',
  'CmdOrCtrl+Shift+R': 'aligning right',
  'CmdOrCtrl+Shift+J': 'justifying',
  'CmdOrCtrl+Alt+0': 'plain text',
  'CmdOrCtrl+Alt+1': 'headings',
  'CmdOrCtrl+Alt+2': 'headings',
  'CmdOrCtrl+Alt+3': 'headings',
  'CmdOrCtrl+Return': 'a new line',
  'CmdOrCtrl+Backspace': 'deleting backwards',
  'CmdOrCtrl+Delete': 'deleting forwards',
  'CmdOrCtrl+Plus': 'zooming in',
  'CmdOrCtrl+Shift+Plus': 'zooming in',
  'CmdOrCtrl+-': 'zooming out',
  'CmdOrCtrl+0': 'the zoom reset',
  'CmdOrCtrl+Q': 'quitting',
  F11: 'full screen',
};

// The keys, by their physical place (so a different keyboard layout reads the same), in Electron's words for them.
const NAMED = {
  Space: 'Space', Tab: 'Tab', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: 'Plus', Backquote: '`',
};
const KEY_NAMES = new Set([...Object.values(NAMED), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''), ...Array.from({ length: 24 }, (_, at) => `F${at + 1}`)]);
const isFunctionKey = (key) => /^F([1-9]|1\d|2[0-4])$/.test(key);

const isMac = (platform) => platform === 'darwin';

// One command's key before the person changes anything.
function defaultKey(item, platform = 'linux') {
  return isMac(platform) && item.macKeys ? item.macKeys : item.keys;
}

// A key written well enough to use: known modifiers in order, then one known key. Says nothing about whether it's wise.
function wellFormed(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40) return false;
  const parts = text.split('+');
  const key = parts.pop();
  if (!KEY_NAMES.has(key)) return false;
  const order = parts.map((part) => MODIFIERS.indexOf(part));
  return order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]));
}

// Is it a key that could be used: Ctrl (or Cmd) with something, or a function key. A plain letter would take over typing.
function usable(text) {
  if (!wellFormed(text)) return false;
  const parts = text.split('+');
  return isFunctionKey(parts.at(-1)) || parts.includes('CmdOrCtrl');
}

// How a key reads on this computer. A Mac has no Ctrl, and says Option for Alt.
function showKeys(accelerator, platform = process.platform) {
  const mac = isMac(platform);
  return String(accelerator).replace('CmdOrCtrl', mac ? 'Cmd' : 'Ctrl').replace('Alt', mac ? 'Option' : 'Alt');
}

// Only what's well made, known and not reserved, so a spoiled or hand-edited settings file can't do harm. '' means "no key".
function cleanShortcuts(input) {
  const clean = {};
  if (!input || typeof input !== 'object') return clean;
  for (const [id, value] of Object.entries(input)) {
    if (!IDS.has(id)) continue;
    if (value === '' || (usable(value) && !Object.hasOwn(RESERVED, value))) clean[id] = value;
  }
  return clean;
}

// The key each command has now: the person's, or the one it began with. If a file somehow gives one key to two commands, the first keeps
// it and the other has none, so nothing is ever one key for two things.
function resolveKeys(overrides, platform = process.platform) {
  const mine = cleanShortcuts(overrides);
  const taken = new Set();
  const keys = {};
  for (const item of ITEMS) {
    if (!Object.hasOwn(mine, item.id)) continue;
    if (mine[item.id] === '' || !taken.has(mine[item.id])) {
      keys[item.id] = mine[item.id];
      if (mine[item.id]) taken.add(mine[item.id]);
    }
  }
  for (const item of ITEMS) {
    if (Object.hasOwn(keys, item.id)) continue;
    const key = defaultKey(item, platform);
    keys[item.id] = key && !taken.has(key) ? key : '';
    if (keys[item.id]) taken.add(key);
  }
  return keys;
}

// The key a press makes, or why it can't be one. A modifier on its own is still "waiting for the rest".
function keyFromPress(press, platform = process.platform) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(press.key)) return { waiting: true };
  const name = /^Key([A-Z])$/.exec(press.code ?? '')?.[1] ?? /^Digit(\d)$/.exec(press.code ?? '')?.[1] ?? (/^F\d{1,2}$/.test(press.code ?? '') ? press.code : null) ?? NAMED[press.code];
  if (!name || !KEY_NAMES.has(name)) return { problem: 'That key can’t be used. Try a letter, a number or a function key.' };
  const mac = isMac(platform);
  if (mac && press.ctrlKey) return { problem: 'Use Cmd, not Control, with the key.' };
  if (!mac && press.metaKey) return { problem: 'The Windows or Super key can’t be used. Use Ctrl.' };
  const parts = [];
  if (mac ? press.metaKey : press.ctrlKey) parts.push('CmdOrCtrl');
  if (press.altKey) parts.push('Alt');
  if (press.shiftKey) parts.push('Shift');
  return { accelerator: [...parts, name].join('+') };
}

// May `id` have this key? { ok: true }, or { ok: false, reason } in plain words. `overrides` is what's set now.
function checkKey(accelerator, id, overrides, platform = process.platform) {
  if (!usable(accelerator)) return { ok: false, reason: `${showKeys(accelerator, platform)} on its own would get in the way of typing. Use ${showKeys('CmdOrCtrl', platform)} with the key, or a function key.` };
  // A command may always have the key it started with, even where the writing page uses that key too.
  const own = ITEMS.find((item) => item.id === id);
  if (Object.hasOwn(RESERVED, accelerator) && accelerator !== defaultKey(own, platform)) return { ok: false, reason: `${showKeys(accelerator, platform)} is for ${RESERVED[accelerator]} and can’t be changed.` };
  const keys = resolveKeys(overrides, platform);
  const holder = ITEMS.find((item) => item.id !== id && keys[item.id] === accelerator);
  if (holder) return { ok: false, reason: `${showKeys(accelerator, platform)} is already ${holder.does}. Choose another key, or change that one first.` };
  return { ok: true };
}

// The settings to save once `id` has `accelerator`. Anything that matches the starting key is just forgotten, so "Reset" and "set it back" agree.
function withKey(overrides, id, accelerator, platform = process.platform) {
  const next = cleanShortcuts(overrides);
  const item = ITEMS.find((one) => one.id === id);
  if (accelerator === defaultKey(item, platform)) delete next[id];
  else next[id] = accelerator;
  return next;
}

module.exports = { GROUPS, IDS, ITEMS, KEY_NAMES, RESERVED, SHORTCUTS, checkKey, cleanShortcuts, defaultKey, isFunctionKey, keyFromPress, resolveKeys, showKeys, usable, wellFormed, withKey };
