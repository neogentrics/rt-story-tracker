'use strict';
// The Recon Towers apps and the words used about them, kept in one small file so every app can copy it as it is. It has no
// dependencies and no behaviour that belongs to this app. The rules are in docs/design/the-suite.md here, and in
// docs/app-suite.md in the rt-markdown-reader repo ("Apps status in every app").
//
// A new app is one more line in SUITE_APPS. Wording stays the same in every app: don't invent your own labels.

const STORE = 'https://recontowers.com/projects/';

// id, name, one short line, and the page that "Get it" opens. Only the pages that are known are exact: the others open the
// store's list of projects until each app has a page of its own, and each one is changed here when it has.
const SUITE_APPS = [
  { id: 'rt-markdown-reader', name: 'RT Markdown Reader', about: 'Read, edit, listen to and publish documents', page: STORE },
  { id: 'rt-story-tracker', name: 'RT Story Tracker', about: 'Write the book, and keep the story bible', page: `${STORE}storytracker/` },
  { id: 'rt-author-desk', name: 'RT Author Desk', about: 'Catalog, accounts, launches and royalties', page: STORE },
  { id: 'rt-press', name: 'RT Press', about: 'Designed print interiors and cover wraps', page: STORE },
  { id: 'rt-audio-studio', name: 'RT Audio Studio', about: 'Audiobooks and podcasts', page: STORE },
  { id: 'recon-browser', name: 'Recon Browser', about: 'A browser for research, which sends clips to your story', page: STORE },
];

const SUITE_IDS = SUITE_APPS.map((app) => app.id);
const appById = (id) => SUITE_APPS.find((app) => app.id === id) ?? null;

// Where an app is, as the person sees it. An app that's linked is Linked, whether or not it's open right now. Otherwise one that
// is open is Found, one that's only installed is Installed, and one that's neither is Not installed.
const STATES = {
  linked: { words: 'Linked', button: 'Open' },
  found: { words: 'Found, not linked', button: 'Link' },
  installed: { words: 'Installed, not running', button: 'Open' },
  missing: { words: 'Not installed', button: 'Get it' },
};

function stateOf({ linked = false, running = false, installed = false }) {
  if (linked) return 'linked';
  if (running) return 'found';
  if (installed) return 'installed';
  return 'missing';
}

// The dot on the toolbar. It only summarises: the words are what a person who can't tell the colours apart reads.
const DOTS = {
  off: 'App Link is off',
  green: 'An app is linked',
  amber: 'Apps found, none linked',
  grey: 'No other app found',
};

// `apps` are the rows the panel shows. Something counts as found if it's installed or running.
function dotOf({ on, apps = [] }) {
  if (!on) return 'off';
  if (apps.some((app) => app.linked)) return 'green';
  if (apps.some((app) => app.installed || app.running)) return 'amber';
  return 'grey';
}

const TITLE = 'Recon Towers apps';
const dotWords = (dot) => `${TITLE}: ${DOTS[dot]}`;

module.exports = { DOTS, STATES, STORE, SUITE_APPS, SUITE_IDS, TITLE, appById, dotOf, dotWords, stateOf };
