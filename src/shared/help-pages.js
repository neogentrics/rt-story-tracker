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
      'Records hold the things you keep track of: characters, places, objects, or any kind you make up. Each kind has the fields you choose. Open Records from the View menu.',
      'Type @ in a chapter to link a record by name. Ctrl or Cmd and click on a name looks the record up beside the page, and Look Up a Record in the View menu finds any record.',
    ],
  },
  {
    id: 'reading',
    title: 'Hearing it read',
    body: [
      'Read Aloud, on the formatting bar and in the View menu, reads from the sentence the cursor is in and draws a line under each sentence as it goes. The bar has pause, back and on by a sentence or a paragraph, the speed and the voice. Escape stops it. At the end of a chapter it carries on into the next, unless you switch that off.',
      'It can read with your computer’s own voices, or with natural voices that you download once, if you ask for them, under Preferences, Reading Aloud. Both work offline, and nothing that’s read is sent anywhere. There you can also teach it how a name sounds, with a pronunciation list kept inside each project.',
      'Export as Audio, under File then This Project, makes an MP3 of a chapter or a book, and on Windows and Mac an audiobook with chapters. It uses the natural voices and can take a long while. If you share the audio, say clearly that a computer made the voice: the voices’ licence requires it.',
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
      'Keyboard Shortcuts, also in the Help menu, lists every key. Choose Change beside any command and press the keys you would rather use. Reset puts it back.',
    ],
  },
];

const { SHORTCUTS, showKeys } = require('./shortcuts');

module.exports = { HELP_TOPICS, SHORTCUTS, showKeys };
