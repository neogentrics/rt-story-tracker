'use strict';
// Web clips from Recon Browser in the real app. A small AppLink in this test plays Recon Browser, so the real pipe, the real
// pairing question and the real rules are used. A clip is offered and never filed by itself, a picture in it is never
// fetched, a locked project holds it in memory, and Recon Browser shows in the Apps panel before it has ever run.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { AppLink } = require('../../src/main/app-link');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-clips-'));
const shared = path.join(work, 'shared');
const profile = path.join(work, 'profile');
const PASSWORD = 'seven silver spoons';
const MARKER = 'ZZ-CLIP-WORDS-9052';
const LOCKED_MARKER = 'ZZ-LOCKED-CLIP-6618';

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: shared, RTST_INSTALLED_LAUNCH: process.execPath },
  });
  const window = await app.firstWindow();
  await window.waitForSelector('body[data-state="ready"]');
  window.on('dialog', (dialog) => dialog.accept());
  return { app, window };
};

const answerYes = (app) => app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);

const clip = (words, base) => `---
title: Medieval Aqueduct Architecture
source_url: https://www.recontowers.com/library/ancient-engineering
source_title: Ancient Civil Infrastructure
source_author: Dr. Elena Vance
source_date: 2026-04-12
accessed: 2026-11-18
category: setting
tags: [research, aqueduct]
---
Aqueducts relied on gravity. ${words}

![A weir](${base}/weir.png)

Source: [Ancient Civil Infrastructure](https://www.recontowers.com/library/ancient-engineering) by Dr. Elena Vance (Accessed: 2026-11-18)
`;

const filesHolding = (folder, text) => fs.readdirSync(folder, { recursive: true }).filter((name) => {
  const full = path.join(folder, String(name));
  try {
    return fs.statSync(full).isFile() && fs.readFileSync(full).includes(text);
  } catch {
    return false;
  }
});

(async () => {
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    response.end('x');
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;

  fs.mkdirSync(path.join(shared, 'installed'), { recursive: true });
  fs.mkdirSync(path.join(work, 'browser'));
  let { app, window } = await launch();
  await window.fill('#new-title', 'Clip Test');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');

  // Recon Browser is in the Apps panel as soon as it's installed, with a button to start it, though it has never run.
  fs.writeFileSync(path.join(shared, 'installed', 'recon-browser.json'), JSON.stringify({ protocol: 1, id: 'recon-browser', name: 'Recon Browser', version: '1.3.0', launch: process.execPath }));
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  await window.click('#prefs-tab-apps');
  await window.waitForSelector('.app-row[data-app="recon-browser"] [aria-label="Open Recon Browser"]');
  assert.equal(await window.locator('.app-row[data-app="recon-browser"] [aria-label^="Link"]').count(), 0, 'finding it never links it');
  await window.check('#pref-link');
  await window.waitForSelector('.app-row[data-app="recon-browser"]');
  await window.click('#pref-close');

  // It starts, links once with a question here, and sends a clip.
  let links = {};
  const browser = new AppLink({
    folder: shared, dataDir: path.join(work, 'browser'), version: '1.3.0', id: 'recon-browser', name: 'Recon Browser',
    load: () => ({ ...links }), save: (saved) => { links = saved; }, ask: async () => true, open: async () => {},
  });
  await browser.start();
  await answerYes(app);
  await browser.pairWith('rt-story-tracker');
  await browser.send('rt-story-tracker', { name: 'Medieval Aqueduct Architecture', text: clip(MARKER, base), kind: 'research' });
  await window.waitForSelector('#inbox[open]');
  assert.match(await window.textContent('#inbox-title'), /Recon Browser sent a web clip, “Medieval Aqueduct Architecture”/);
  assert.match(await window.textContent('#inbox-source'), /From Ancient Civil Infrastructure, by Dr\. Elena Vance, 2026-04-12/);
  assert.equal(await window.locator('#inbox-as').count(), 0, 'a clip is one chapter, so there is nothing to choose');
  assert.equal(await window.locator('#inbox-book option:checked').textContent(), 'A new book called Research');
  assert.ok(!(await window.textContent('#inbox')).includes(MARKER), 'the window never shows the words themselves');
  assert.deepEqual(filesHolding(work, MARKER), [], 'on arrival, no file anywhere holds the clip');

  // Nothing is filed until the author says so, and then it's one chapter in Research with the source at the top.
  await window.click('#inbox-add');
  await window.waitForSelector('#inbox', { state: 'detached' });
  await window.waitForFunction(() => document.querySelector('#book-list').textContent.includes('Research'));
  await window.waitForFunction((marker) => document.querySelector('.ProseMirror')?.textContent.includes(marker), MARKER);
  const text = await window.innerText('.ProseMirror');
  assert.match(text, /^source_url: https:\/\/www\.recontowers\.com\/library\/ancient-engineering/);
  assert.match(text, /tags: research, aqueduct/);
  assert.match(text, /\[Image: A weir \(http:\/\/127\.0\.0\.1:\d+\/weir\.png\)\]/, 'the picture is a reference in words');
  assert.equal(await window.locator('.ProseMirror img').count(), 0);
  await new Promise((resolve) => { setTimeout(resolve, 500); });
  assert.deepEqual(hits, [], 'the picture was never requested');

  // The next clip is offered Research, which is there now, and doesn't make a second one.
  await browser.send('rt-story-tracker', { name: 'Second', text: 'More words.', kind: 'research' });
  await window.waitForSelector('#inbox[open]');
  assert.equal(await window.locator('#inbox-book option:checked').textContent(), 'Research');
  await window.click('#inbox-add');
  await window.waitForSelector('#inbox', { state: 'detached' });
  const titles = await window.locator('#book-list .row').allTextContents();
  assert.equal(titles.filter((title) => /Research/.test(title)).length, 1);

  // A locked project: the clip is never offered behind the lock, and no file holds it until it's added.
  await window.click('.security-button');
  await window.fill('#new-password', PASSWORD);
  await window.fill('#new-password-again', PASSWORD);
  await window.click('#security-next');
  await window.check('#recovery-saved');
  await window.click('#recovery-continue');
  await window.waitForSelector('#security-done');
  await window.click('#security-done');
  await menu(app, 'lock');
  await window.waitForSelector('#lock-screen');
  await browser.send('rt-story-tracker', { name: 'Held', text: `Held while locked. ${LOCKED_MARKER}`, kind: 'research' });
  await new Promise((resolve) => { setTimeout(resolve, 500); });
  assert.equal(await window.locator('#inbox').count(), 0, 'nothing is offered behind the lock');
  assert.deepEqual(filesHolding(work, LOCKED_MARKER), [], 'while locked, no file holds the clip');
  await window.fill('#lock-password', PASSWORD);
  await window.click('#lock-open');
  await window.waitForSelector('#inbox[open]');
  assert.deepEqual(filesHolding(work, LOCKED_MARKER), [], 'unlocked but not added: still only in memory');
  await window.click('#inbox-add');
  await window.waitForSelector('#inbox', { state: 'detached' });
  await window.waitForFunction((marker) => document.querySelector('.ProseMirror')?.textContent.includes(marker), LOCKED_MARKER);
  assert.deepEqual(hits, []);

  await app.close();
  await browser.stop();
  server.close();
  console.log('clips e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
