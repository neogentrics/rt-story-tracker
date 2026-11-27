'use strict';
// Starts the real app and checks it the way a person would. On Linux CI this runs under xvfb-run.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-e2e-'));

const launch = () =>
  electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile },
  });

(async () => {
  let app = await launch();
  let window = await app.firstWindow();
  await window.waitForSelector('body[data-state="ready"]');
  assert.equal(await window.title(), 'RT Story Tracker');
  assert.ok(await window.isVisible('#start-project'), 'the first run offers a project');
  assert.ok(await window.isVisible('#try-sample'), 'the first run offers a sample');
  assert.equal(await window.evaluate(() => typeof window.require), 'undefined', 'no Node in the window');
  assert.equal(await window.evaluate(() => typeof window.process), 'undefined', 'no Node in the window');
  await app.close();

  const { Library } = require('../../src/main/storage/library');
  new Library(path.join(profile, 'library')).createProject('From the test');

  app = await launch();
  window = await app.firstWindow();
  await window.waitForSelector('.project-row');
  assert.match(await window.textContent('.project-row'), /From the test/);

  // Themes and fonts are in Preferences, and the library screen has a button for it.
  await window.click('#library-prefs');
  await window.waitForSelector('#preferences[open]');
  const box = await window.locator('#preferences').boundingBox();
  assert.ok(box.width >= 600, `Preferences is wide enough to read, not ${box.width}px`);
  await window.click('#prefs-tab-appearance');
  assert.ok(await window.isVisible('#pref-theme'), 'the theme choice is there');
  assert.equal(await window.getByRole('button', { name: 'Preferences', exact: true }).count(), 1, 'one Preferences button on the library screen');
  await app.close();

  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  console.log('e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
