'use strict';
// The Help Center and the Keyboard Shortcuts page. Plain words, kept here so the window shows them and the tests check them: every
// shortcut listed must be one the menu really has, and every one the menu has must be listed. Nothing in them is about any one
// author's book.

const HELP_TOPICS = [
  {
    id: 'start',
    title: 'Getting started',
    body: [
      'A project is one place for everything around a book: its chapters, notes, records and pictures. Start one from the Library, or open a project file someone gave you.',
      'Write in the Write view. Chapters live in books, and books can live in a series. Everything saves itself a couple of seconds after you stop typing, so there is no Save button to forget.',
    ],
  },
  {
    id: 'records',
    title: 'Records and the story bible',
    body: [
      'Records hold the things you keep track of: characters, places, objects, or any kind you make up. Each kind has the fields you choose. Open Records from the View menu, or press Ctrl+2.',
      'Type @ in a chapter to link a record by name. Ctrl or Cmd and click on a name looks the record up beside the page, and Ctrl+K looks up any record.',
    ],
  },
  {
    id: 'safe',
    title: 'Keeping your work safe',
    body: [
      'Every chapter keeps earlier versions as you write, and anything you delete waits 30 days in the Trash. A project can have a password, and then it is encrypted on this computer and locks itself when you step away.',
      'Backups of the whole project are kept for you, and Save a Copy of This Project makes one you can put anywhere.',
    ],
  },
  {
    id: 'out',
    title: 'Getting your writing out',
    body: [
      'Export makes Word files, a print-ready PDF, a store-ready EPUB and more, with the layout choices in the window. Import brings in documents from Word, Scrivener, Markdown and other places, and shows what it found before anything is added.',
    ],
  },
  {
    id: 'apps',
    title: 'The other Recon Towers apps',
    body: [
      'The apps icon at the top right shows whether other Recon Towers apps are linked, found or off. The dot is only a summary: the panel it opens says the same in words, and has the button that goes with each app. Finding an app never links it. You link once, and answer in the app being asked.',
    ],
  },
  {
    id: 'help',
    title: 'More help',
    body: [
      'Choose Help, then About, for a link to report a problem or suggest something. Copy Version Details there puts what a bug report needs on the clipboard, and nothing about you or your writing.',
    ],
  },
];

// `keys` is the menu's own accelerator text, so a test can compare the two.
const SHORTCUTS = [
  {
    group: 'Writing',
    items: [
      { keys: 'CmdOrCtrl+N', does: 'New chapter' },
      { keys: 'CmdOrCtrl+Shift+N', does: 'New book' },
      { keys: 'CmdOrCtrl+F', does: 'Find' },
      { keys: 'Ctrl+H', macKeys: 'Cmd+Alt+F', does: 'Replace' },
      { keys: 'F3', does: 'Find the next match' },
      { keys: 'Shift+F3', does: 'Find the previous match' },
      { keys: 'CmdOrCtrl+Shift+F', does: 'Focus mode' },
    ],
  },
  {
    group: 'Views',
    items: [
      { keys: 'CmdOrCtrl+1', does: 'Write' },
      { keys: 'CmdOrCtrl+2', does: 'Records' },
      { keys: 'CmdOrCtrl+K', does: 'Look up a record' },
      { keys: 'CmdOrCtrl+Shift+L', does: 'Library' },
    ],
  },
  {
    group: 'Projects',
    items: [
      { keys: 'CmdOrCtrl+O', does: 'Open a project file' },
      { keys: 'CmdOrCtrl+Shift+S', does: 'Save a copy of this project' },
      { keys: 'CmdOrCtrl+Shift+I', does: 'Import' },
      { keys: 'CmdOrCtrl+E', does: 'Export' },
      { keys: 'CmdOrCtrl+P', does: 'Print' },
      { keys: 'CmdOrCtrl+L', does: 'Lock the project' },
    ],
  },
  {
    group: 'The app',
    items: [
      { keys: 'Ctrl+,', macKeys: 'Cmd+,', does: 'Preferences' },
      { keys: 'F1', does: 'Help Center' },
    ],
  },
];

// How a shortcut reads on this computer. A Mac has no Ctrl, and spells its keys the way a Mac does.
function showKeys(item, platform = process.platform) {
  const mac = platform === 'darwin';
  const keys = mac && item.macKeys ? item.macKeys : item.keys;
  return keys.replace('CmdOrCtrl', mac ? 'Cmd' : 'Ctrl');
}

module.exports = { HELP_TOPICS, SHORTCUTS, showKeys };
