'use strict';
const { Menu } = require('electron');
const { HELP_MENU } = require('../shared/family');
const { resolveKeys } = require('../shared/shortcuts');

// There's no Reload here on purpose: it would throw away whatever hasn't saved yet.
// The Help menu is RT Markdown Reader's: Help Center, Keyboard Shortcuts, Check for Updates and About with the version in its label.
// Its Tutorial and Find a Command aren't here yet.
// `keys` is the key each command has now, by its name in ../shared/shortcuts.js: the author's own where they've changed one. A command
// with no key has none shown and none taken.
function buildMenu({ send, checkForUpdates, about, version, updateReady = null, keys = resolveKeys({}, process.platform) }) {
  const isMac = process.platform === 'darwin';
  const key = (id) => keys[id] || undefined;
  const aboutLabel = HELP_MENU.about(version);
  const help = [
    { label: HELP_MENU.center.label, accelerator: key('helpCenter'), click: () => send('help-center') },
    { label: HELP_MENU.shortcuts.label, accelerator: key('shortcuts'), click: () => send('shortcuts') },
    { type: 'separator' },
    updateReady
      ? { label: HELP_MENU.restart(updateReady), click: () => send('restart-to-update') }
      : { label: HELP_MENU.update.label, click: checkForUpdates },
    ...(isMac ? [] : [{ type: 'separator' }, { label: aboutLabel, click: about }]),
  ];
  return Menu.buildFromTemplate([
    ...(isMac
      ? [{
          label: 'RT Story Tracker',
          submenu: [
            { label: aboutLabel, click: about },
            { type: 'separator' },
            { label: 'Preferences…', accelerator: key('preferences'), click: () => send('preferences') },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Chapter', accelerator: key('newChapter'), click: () => send('new-chapter') },
        { label: 'New Book', accelerator: key('newBook'), click: () => send('new-book') },
        { type: 'separator' },
        { label: 'Open…', accelerator: key('openFile'), click: () => send('open-file') },
        { label: 'Save a Copy…', accelerator: key('saveCopy'), click: () => send('export') },
        { type: 'separator' },
        // The commands for the project that's open go in one submenu, so File stays short, as it does in RT Markdown Reader.
        {
          label: 'This Project',
          submenu: [
            { label: 'Import…', accelerator: key('import'), click: () => send('import') },
            { label: 'Export…', accelerator: key('exportBook'), click: () => send('export-book') },
            { label: 'Print…', accelerator: key('print'), click: () => send('print') },
            { type: 'separator' },
            { label: 'Find My Files…', accelerator: key('findFiles'), click: () => send('find-files') },
            { label: 'Attachments…', accelerator: key('attachments'), click: () => send('attachments') },
            { label: 'Book Details…', accelerator: key('details'), click: () => send('details') },
            { label: 'Earlier Versions of This Chapter…', accelerator: key('history'), click: () => send('history') },
            { type: 'separator' },
            { label: 'Documents Sent Here…', accelerator: key('inbox'), click: () => send('inbox') },
            { label: 'Open Chapter in RT Markdown Reader', accelerator: key('readerChapter'), click: () => send('reader-chapter') },
            { label: 'Open Book in RT Markdown Reader', accelerator: key('readerBook'), click: () => send('reader-book') },
            { label: 'Publish Chapter with RT Markdown Reader…', accelerator: key('readerPublish'), click: () => send('reader-publish') },
          ],
        },
        { label: 'Trash', accelerator: key('trash'), click: () => send('trash') },
        { type: 'separator' },
        { label: 'Password and Lock…', accelerator: key('security'), click: () => send('security') },
        { label: 'Lock Project', accelerator: key('lock'), click: () => send('lock') },
        { type: 'separator' },
        { label: 'Library', accelerator: key('library'), click: () => send('library') },
        ...(isMac
          ? []
          : [
              { label: 'Preferences…', accelerator: key('preferences'), click: () => send('preferences') },
              { type: 'separator' },
              { role: 'quit', label: 'Exit' },
            ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: key('find'), click: () => send('find') },
        { label: 'Replace…', accelerator: key('replace'), click: () => send('replace') },
        { label: 'Find Next', accelerator: key('findNext'), click: () => send('find-next') },
        { label: 'Find Previous', accelerator: key('findPrevious'), click: () => send('find-previous') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Write', accelerator: key('showWrite'), click: () => send('show-write') },
        { label: 'Records', accelerator: key('showRecords'), click: () => send('show-records') },
        { label: 'Look Up a Record', accelerator: key('lookup'), click: () => send('lookup') },
        { type: 'separator' },
        { label: 'Focus Mode', accelerator: key('focus'), click: () => send('focus') },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Help', submenu: help },
  ]);
}

module.exports = { buildMenu };
