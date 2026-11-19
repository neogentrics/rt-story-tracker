'use strict';
const { Menu } = require('electron');
const { HELP_MENU } = require('../shared/family');

// There's no Reload here on purpose: it would throw away whatever hasn't saved yet.
// The Help menu is RT Markdown Reader's: Help Center, Keyboard Shortcuts, Check for Updates and About with the version in its label.
// Its Tutorial and Find a Command aren't here yet.
function buildMenu({ send, checkForUpdates, about, version }) {
  const isMac = process.platform === 'darwin';
  const aboutLabel = HELP_MENU.about(version);
  const help = [
    { label: HELP_MENU.center.label, accelerator: HELP_MENU.center.accelerator, click: () => send('help-center') },
    { label: HELP_MENU.shortcuts.label, click: () => send('shortcuts') },
    { type: 'separator' },
    { label: HELP_MENU.update.label, click: checkForUpdates },
    ...(isMac ? [] : [{ type: 'separator' }, { label: aboutLabel, click: about }]),
  ];
  return Menu.buildFromTemplate([
    ...(isMac
      ? [{
          label: 'RT Story Tracker',
          submenu: [
            { label: aboutLabel, click: about },
            { type: 'separator' },
            { label: 'Preferences…', accelerator: 'Cmd+,', click: () => send('preferences') },
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
        { label: 'New Chapter', accelerator: 'CmdOrCtrl+N', click: () => send('new-chapter') },
        { label: 'New Book', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('new-book') },
        { type: 'separator' },
        { label: 'Open Project File…', accelerator: 'CmdOrCtrl+O', click: () => send('open-file') },
        { label: 'Save a Copy of This Project…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('export') },
        { type: 'separator' },
        { label: 'Import…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('import') },
        { label: 'Find My Files…', click: () => send('find-files') },
        { label: 'Attachments…', click: () => send('attachments') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => send('export-book') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { label: 'Book Details…', click: () => send('details') },
        { type: 'separator' },
        { label: 'Open Chapter in RT Markdown Reader', click: () => send('reader-chapter') },
        { label: 'Open Book in RT Markdown Reader', click: () => send('reader-book') },
        { label: 'Publish Chapter with RT Markdown Reader…', click: () => send('reader-publish') },
        { label: 'Documents Sent Here…', click: () => send('inbox') },
        { type: 'separator' },
        { label: 'Earlier Versions of This Chapter…', click: () => send('history') },
        { label: 'Trash', click: () => send('trash') },
        { type: 'separator' },
        { label: 'Password and Lock…', click: () => send('security') },
        { label: 'Lock Project', accelerator: 'CmdOrCtrl+L', click: () => send('lock') },
        { type: 'separator' },
        { label: 'Library', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('library') },
        ...(isMac
          ? []
          : [
              { label: 'Preferences…', accelerator: 'Ctrl+,', click: () => send('preferences') },
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
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: 'Replace…', accelerator: isMac ? 'Cmd+Alt+F' : 'Ctrl+H', click: () => send('replace') },
        { label: 'Find Next', accelerator: 'F3', click: () => send('find-next') },
        { label: 'Find Previous', accelerator: 'Shift+F3', click: () => send('find-previous') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Write', accelerator: 'CmdOrCtrl+1', click: () => send('show-write') },
        { label: 'Records', accelerator: 'CmdOrCtrl+2', click: () => send('show-records') },
        { label: 'Look Up a Record', accelerator: 'CmdOrCtrl+K', click: () => send('lookup') },
        { type: 'separator' },
        { label: 'Focus Mode', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('focus') },
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
