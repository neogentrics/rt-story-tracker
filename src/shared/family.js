'use strict';
// The words and places that make this app look like the other Recon Towers apps: the Help menu, the About window and where its
// links go. Kept in one small file with no dependencies, so another app can copy it and say the same things. The structure is the
// one RT Markdown Reader uses (its Help menu and its About window), and docs/design/the-suite.md says what's the same and what isn't.

const APP_NAME = 'RT Story Tracker';
const BLURB = 'A place to write a book and keep everything around it: chapters, the story bible, records and the things that connect them.';
const COMPANY = 'Recon Towers';
const WEBSITE = 'https://recontowers.com/projects/storytracker/';
const REPO = 'https://github.com/neogentrics/rt-story-tracker';

// Where each About link goes. `notes` is this release on GitHub, so it needs the version.
const LINKS = {
  website: () => WEBSITE,
  notes: (version) => `${REPO}/releases/tag/v${version}`,
  issue: () => `${REPO}/issues/new`,
  source: () => REPO,
  license: () => `${REPO}/blob/master/LICENSE`,
  notices: () => `${REPO}/blob/master/THIRD_PARTY_NOTICES.md`,
};

// What each About line says. These are the Reader's words, so the two windows read the same.
const ABOUT = {
  title: `About ${APP_NAME}`,
  rows: [
    { id: 'website', label: 'Website', note: `${APP_NAME} on ${COMPANY}` },
    { id: 'notes', label: 'What’s new in this version', note: 'Release notes on GitHub' },
    { id: 'issue', label: 'Report a problem or suggest a feature', note: 'GitHub issues' },
    { id: 'source', label: 'Source code', note: 'github.com/neogentrics/rt-story-tracker' },
  ],
  license: 'License',
  notices: 'Open-source notices',
  copy: 'Copy Version Details',
  copied: 'Version details copied — paste them into a bug report',
  done: 'Done',
};

// The Help menu, in the order the Reader has it. Tutorial and Find a Command are the Reader's and aren't here yet.
const HELP_MENU = {
  center: { label: 'Help Center', accelerator: 'F1' },
  shortcuts: { label: 'Keyboard Shortcuts' },
  update: { label: 'Check for Updates…' },
  restart: (version) => `Restart to Update (${version})`,
  about: (version) => `About ${APP_NAME} ${version}`,
};

const versionLine = (info) => `${APP_NAME} ${info.version}${info.portable ? ' (portable)' : ''}`;
const engineLine = (info) => `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`;

// What Copy Version Details puts on the clipboard, for a bug report. Nothing about the person or the project is in it.
const detailsText = (info) => [versionLine(info), engineLine(info), info.os].join('\n');
const copyright = (year) => `© ${year} ${COMPANY}. All rights reserved.`;
const versionWords = (info) => (info.portable ? `Version ${info.version} (portable)` : `Version ${info.version}`);

module.exports = { ABOUT, APP_NAME, BLURB, COMPANY, HELP_MENU, LINKS, REPO, WEBSITE, copyright, detailsText, engineLine, versionLine, versionWords };
