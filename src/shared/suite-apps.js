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

// Updates and compatibility. Whether two apps link is decided by their App Link version and the kinds of document each accepts, and
// never by the app's own version number, so an ordinary release can't break a link. Only an incompatible protocol, or a security
// fix that raised the minimum, blocks one. A newer version is only a nudge, and never stops a link that would otherwise work.
// The wording is the same in every app.
const UPDATE = {
  available: 'Update available',
  needs: 'Needs an update to link',
  unreachable: 'Couldn’t check for updates',
  open: 'Open to update',
  download: 'Download',
};

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const validVersion = (text) => typeof text === 'string' && VERSION.test(text);

// Is `latest` newer than `have`? Anything that isn't a plain version number is never "newer", so a odd string can't raise a nudge.
function isNewer(latest, have) {
  if (!validVersion(latest) || !validVersion(have)) return false;
  const [a, b] = [latest, have].map((text) => VERSION.exec(text).slice(1).map(Number));
  for (let at = 0; at < 3; at += 1) if (a[at] !== b[at]) return a[at] > b[at];
  return false;
}

// "you have 3.7.1, the latest is 3.9.0"
const updateLine = ({ have, latest }) => `you have ${have}, the latest is ${latest}`;

// Which button goes with an update: an app that updates itself (the Windows installer and the Linux AppImage) is opened, and the rest
// are downloaded. Another app's launch path is how this is told from here.
function updateButton({ platform, launch = '', running = false }) {
  const selfUpdates = platform === 'win32' || (platform === 'linux' && /\.AppImage$/i.test(launch));
  if (!selfUpdates) return 'download';
  return running ? '' : 'open';
}

// Can these two apps link? Each side is { protocol, minProtocol, accepts }, as `hello` and the installed file say them. It's the
// older app that needs the update: `who` is 'them' when the other app is too old for this one, and 'us' when this one is too old for
// it. Kinds of document only matter when both sides list some and have none in common.
function linkability({ mine, theirs }) {
  const minimum = (side) => (Number.isInteger(side.minProtocol) && side.minProtocol >= 1 ? side.minProtocol : 1);
  if (!Number.isInteger(theirs.protocol) || theirs.protocol < minimum(mine)) return { ok: false, who: 'them' };
  if (mine.protocol < minimum(theirs)) return { ok: false, who: 'us' };
  const [ours, theirKinds] = [mine.accepts, theirs.accepts].map((list) => (Array.isArray(list) ? list : []));
  if (ours.length && theirKinds.length && !ours.some((kind) => theirKinds.includes(kind))) return { ok: false, who: 'them' };
  return { ok: true };
}

module.exports = { DOTS, STATES, STORE, SUITE_APPS, SUITE_IDS, TITLE, UPDATE, appById, dotOf, dotWords, isNewer, linkability, stateOf, updateButton, updateLine, validVersion };
