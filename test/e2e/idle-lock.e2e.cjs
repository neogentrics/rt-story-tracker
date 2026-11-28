'use strict';
// The idle lock with read aloud and audio export, in the real app, on a project with a password set to lock after 15 minutes. The
// window's clock is the test's to move, so minutes pass in a moment. The app's own timer and its own lock are the real ones.
// Reading uses a stand-in for a voice on the computer, and the audio export the engine's test mode, so nothing is downloaded.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-idle-'));
const profile = path.join(work, 'profile');
const PASSWORD = 'nine quiet lanterns';

function standIn() {
  window.heard = 0;
  const voices = [{ name: 'Desk Voice', lang: 'en-GB', localService: true, default: true }];
  window.readAloudStandIn = {
    Utterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    synth: {
      getVoices: () => voices,
      // Says nothing, and finishes only when the test says so.
      speak(utterance) {
        window.heard += 1;
        window.endSaying = () => utterance.onend?.();
      },
      cancel() {},
    },
  };
}

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, RTST_FAKE_VOICES: '1', NMR_LINK_DIR: path.join(work, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  window.on('dialog', (dialog) => dialog.accept());
  await window.waitForSelector('body[data-state="ready"]');

  // The clock goes in before the app's own scripts run, so the timer that watches for an idle app runs by it.
  await window.clock.install();
  await window.addInitScript(standIn);
  await window.reload();
  await window.waitForSelector('body[data-state="ready"]');

  // The system's own windows, standing in.
  await app.evaluate(({ dialog }) => {
    global.saveTo = null;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: global.saveTo });
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  const menu = (command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
  // What the system says when the computer is locked, or going to sleep.
  const computer = (event) => app.evaluate(({ powerMonitor }, name) => { powerMonitor.emit(name); }, event);
  // The window's clock runs on by itself, so the app can look at any moment. To try what happens between two of its looks, the clock is
  // stopped, moved on without a look, and started again afterwards.
  const stopClock = async () => window.clock.pauseAt(await window.evaluate(() => Date.now()) + 1000);
  const slipBy = async (minutes) => window.clock.setSystemTime(await window.evaluate(() => Date.now()) + minutes * 60000);
  // Real time, which the window's clock has no say in: for the app to do what a look at its clock started.
  const breathe = (milliseconds = 700) => new Promise((done) => { setTimeout(done, milliseconds); });
  // Time passes with nobody touching anything. The app looks at its clock when it does.
  const pass = async (minutes) => {
    await window.clock.fastForward(Math.round(minutes * 60000));
    await breathe();
  };
  const isLocked = async () => (await window.locator('input[type="password"]').count()) > 0 && (await window.locator('.ProseMirror').count()) === 0;
  const waitLocked = () => window.waitForFunction(() => !document.querySelector('.ProseMirror') && document.querySelector('input[type="password"]'), null, { polling: 100 });
  const unlock = async () => {
    await window.fill('input[type="password"]', PASSWORD);
    await window.keyboard.press('Enter');
    await window.waitForSelector('.ProseMirror', { timeout: 30000 });
    await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
    await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 1', null, { polling: 100 });
  };
  const startReading = async () => {
    const before = await window.evaluate(() => window.heard);
    await menu('read-aloud');
    await window.waitForFunction((count) => window.heard > count, before, { polling: 100 });
  };
  // The sentence being said ends, and the next begins: reading getting somewhere.
  const oneMoreSentence = async () => {
    const before = await window.evaluate(() => window.heard);
    await window.evaluate(() => window.endSaying());
    await window.waitForFunction((count) => window.heard > count, before, { polling: 100 });
  };
  const status = () => window.textContent('.speak-status');

  // A book with a long first chapter, then a password.
  await window.fill('#new-title', 'Listening');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await window.evaluate(async () => {
    const id = document.querySelector('#chapter-list .row').dataset.id;
    const content = Array.from({ length: 40 }, (_, at) => ({ type: 'paragraph', content: [{ type: 'text', text: `This is sentence number ${at}.` }] }));
    await window.storyTracker.saveChapter({ id, title: 'Chapter 1', body: JSON.stringify({ type: 'doc', content }) });
    await window.storyTracker.saveSettings({ lockAfter: 15, readAloud: { carryOn: false, voice: 'Desk Voice' } });
    await window.storyTracker.makeRecovery();
    await window.storyTracker.setPassword({ password: 'nine quiet lanterns' });
    await window.storyTracker.closeProject();
  });
  await window.reload();
  await window.waitForSelector('body[data-state="ready"]');
  await window.waitForSelector('input[type="password"]');
  await unlock();

  // With nothing going on, it locks after 15 minutes and not before. This is also what shows the test's clock moves the app's.
  await pass(14);
  assert.equal(await isLocked(), false, 'still open at 14 minutes');
  await pass(1.1);
  await waitLocked();
  await unlock();

  // Reading: over half an hour with nobody touching anything, a sentence ending now and then. It stays open.
  await startReading();
  for (let at = 0; at < 8; at += 1) {
    await pass(4.5);
    assert.equal(await isLocked(), false, `locked while reading, ${(at + 1) * 4.5} minutes in`);
    await oneMoreSentence();
  }
  assert.equal(await window.locator('.speak-bar').count(), 1);

  // It reaches the end by itself, so nothing was touched. From then the 15 minutes count again: from the moment it ends, which here
  // is ten minutes after the app last looked.
  await stopClock();
  await slipBy(10);
  // Each sentence's end brings the next at once, so the rest of the chapter goes by in one step.
  await window.evaluate(() => {
    for (let at = 0; at < 100 && document.querySelector('.speak-status').textContent !== 'Finished'; at += 1) window.endSaying();
  });
  assert.equal(await status(), 'Finished');
  await window.clock.resume();
  await pass(14.5);
  assert.equal(await isLocked(), false, 'still open 14 and a half minutes after reading finished');
  await pass(0.75);
  await waitLocked();
  await unlock();

  // Stopped with the button: the same.
  await startReading();
  await pass(10);
  await window.click('.speak-bar [data-read="stop"]');
  await pass(14.5);
  assert.equal(await isLocked(), false);
  await pass(0.75);
  await waitLocked();
  await unlock();

  // Paused reading isn't reading.
  await startReading();
  await window.click('.speak-bar [data-read="play"]');
  assert.match(await status(), /^Paused/);
  await pass(15.1);
  await waitLocked();
  await unlock();

  // A voice that hangs: reading looks as if it's going, and gets nowhere. It stops counting after 15 minutes, and the project locks
  // 15 minutes after that, instead of never.
  await startReading();
  await pass(14);
  assert.equal(await isLocked(), false, 'a long sentence is still reading');
  await pass(14);
  assert.equal(await isLocked(), false, 'no longer counted, and 14 minutes since it last was');
  await pass(1.5);
  await waitLocked();
  await unlock();

  // Lock Project, locking the computer and sleep still lock while it reads.
  for (const lock of [() => menu('lock'), () => computer('lock-screen'), () => computer('suspend')]) {
    await startReading();
    await lock();
    await waitLocked();
    assert.equal(await window.locator('.speak-bar').count(), 0);
    await unlock();
  }

  // Audio export. A long book keeps it going while the clock moves on, a little at a time so the export can get on between looks.
  await window.evaluate(async () => {
    const id = document.querySelector('#chapter-list .row').dataset.id;
    const content = Array.from({ length: 2500 }, (_, at) => ({ type: 'paragraph', content: [{ type: 'text', text: `Sentence ${at} of a long one.` }] }));
    await window.storyTracker.saveChapter({ id, title: 'Chapter 1', body: JSON.stringify({ type: 'doc', content }) });
    await window.storyTracker.saveSettings({ readAloud: { quality: 'faster' } });
  });
  // Locked and opened again, so the page shows the chapter as it's now saved.
  await menu('lock');
  await waitLocked();
  await unlock();
  // The voices, "downloaded" in the engine's test mode.
  await window.evaluate(() => window.storyTracker.voiceInstall());

  const startExport = async (file) => {
    await app.evaluate((_electron, value) => { global.saveTo = value; }, file);
    await menu('export-audio');
    await window.waitForSelector('dialog[open]');
    if ((await window.locator('#audio-export').count()) === 0) {
      await window.fill('dialog[open] input[type="password"]', PASSWORD);
      await window.keyboard.press('Enter');
    }
    await window.waitForSelector('#audio-export[open]');
    assert.match(await window.textContent('#audio-lock-note'), /The idle lock waits while the audio is made/);
    await window.click('#audio-go');
    await window.waitForSelector('.audio-job');
  };
  const progress = () => window.$eval('.audio-job progress', (node) => Number(node.value));
  const long = path.join(work, 'long.mp3');
  await startExport(long);
  let passed = 0;
  // Each look comes after the export has got a step further, as it would with real minutes between them.
  while (passed < 22.5) {
    const before = await window.evaluate(() => document.querySelector('.audio-job-text').textContent);
    await window.waitForFunction((text) => document.querySelector('.audio-job-text')?.textContent !== text, before, { polling: 20, timeout: 20000 });
    await window.clock.fastForward(4.5 * 60000);
    passed += 4.5;
    await breathe(60);
    assert.equal(await isLocked(), false, `locked while exporting, ${passed} minutes in`);
  }
  assert.ok(await progress() < 100, 'the export was still going all that time');
  assert.equal(fs.existsSync(`${long}.part`), true);

  // Sleep still locks, and the unfinished file goes.
  await computer('suspend');
  await waitLocked();
  await breathe();
  assert.deepEqual([fs.existsSync(long), fs.existsSync(`${long}.part`)], [false, false]);
  await unlock();

  // An export that finishes by itself: the time counts again from the moment it ends, which here is ten minutes after the app last
  // looked.
  await window.evaluate(async () => {
    const id = document.querySelector('#chapter-list .row').dataset.id;
    const content = Array.from({ length: 150 }, (_, at) => ({ type: 'paragraph', content: [{ type: 'text', text: `Sentence ${at} of a shorter one.` }] }));
    await window.storyTracker.saveChapter({ id, title: 'Chapter 1', body: JSON.stringify({ type: 'doc', content }) });
  });
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  const short = path.join(work, 'short.mp3');
  await startExport(short);
  await stopClock();
  await slipBy(10);
  assert.equal(await window.locator('.audio-job').count(), 1, 'it was still going when the clock moved');
  await window.waitForSelector('.audio-job', { state: 'detached', timeout: 60000 });
  assert.equal(fs.existsSync(short), true);
  await window.clock.resume();
  await pass(14.5);
  assert.equal(await isLocked(), false, 'still open 14 and a half minutes after the export ended');
  await pass(0.75);
  await waitLocked();

  assert.deepEqual(errors, []);
  await app.close();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  console.log('idle lock e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
