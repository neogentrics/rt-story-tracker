'use strict';
// Read aloud (issue 41) in the real app. The voice process is the real one in the engine's test mode, which plays a tone, and nothing is
// ever downloaded. The test stands in for the two things a test computer hasn't got: a sound card, and voices of its own, one of them
// an online voice that must never be offered. How the real voices sound can't be tested here.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { THEMES } = require('../../src/shared/themes');
const { MACHINE_MADE } = require('../../src/shared/audio-formats');
const { frames, measure } = require('./measure.cjs');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-reading-'));
const profile = path.join(work, 'profile');
const PASSWORD = 'nine quiet lanterns';
const SMALL = [{ width: 640, height: 480 }, { width: 800, height: 600 }];

// What stands in for the sound card and the computer's voices. `window.heard` is what each was given.
function standIn() {
  window.heard = { sounds: [], said: [] };
  const voices = [
    { name: 'Desk Voice', lang: 'en-GB', localService: true, default: true },
    { name: 'Cloud Voice', lang: 'en-US', localService: false, default: false },
  ];
  window.readAloudStandIn = {
    Utterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    synth: {
      getVoices: () => (window.noOwnVoices ? [] : voices),
      speak(utterance) {
        window.heard.said.push({ text: utterance.text, voice: utterance.voice?.name, local: utterance.voice?.localService, rate: utterance.rate });
        window.endSaying = () => utterance.onend?.();
      },
      cancel() {},
    },
    play(samples, rate, output) {
      let done;
      const ended = new Promise((resolve) => {
        done = resolve;
      });
      const sound = { length: samples.length, rate, output, stopped: false };
      window.heard.sounds.push(sound);
      window.endSound = () => done();
      return { ended, stop: () => { sound.stopped = true; done(); } };
    },
  };
}

const launch = async () => {
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
  await window.evaluate(standIn);
  await window.evaluate(() => {
    const still = new CSSStyleSheet();
    still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
  });
  // The system's own windows, standing in: what was asked is kept, and `answers` are the buttons chosen.
  await app.evaluate(({ dialog, shell }) => {
    global.boxes = [];
    global.answers = [];
    global.saveTo = null;
    global.opened = [];
    dialog.showMessageBox = async (...args) => {
      const box = args.at(-1);
      global.boxes.push(box);
      return { response: global.answers.length ? global.answers.shift() : box.cancelId };
    };
    dialog.showSaveDialog = async (_window, options) => {
      global.saveOptions = options;
      return { canceled: !global.saveTo, filePath: global.saveTo };
    };
    shell.openExternal = async (url) => global.opened.push(url);
  });
  return { app, window, errors };
};

const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
const set = (app, name, value) => app.evaluate((_electron, [key, wanted]) => { global[key] = wanted; }, [name, value]);
const get = (app, name) => app.evaluate((_electron, key) => global[key], name);
const voiceProcesses = (app) => app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().filter((item) => item.name === 'RT Story Tracker voices' || item.serviceName === 'RT Story Tracker voices').length);

const marked = (window) => window.evaluate(() => {
  const title = document.querySelector('.chapter-title.reading-sentence');
  if (title) return title.value;
  return [...document.querySelectorAll('.page-text .reading-sentence')].map((node) => node.textContent).join('') || null;
});
const waitMarked = (window, text) => window.waitForFunction((wanted) => {
  const title = document.querySelector('.chapter-title.reading-sentence');
  const now = title ? title.value : [...document.querySelectorAll('.page-text .reading-sentence')].map((node) => node.textContent).join('');
  return now === wanted;
}, text);
const status = (window) => window.textContent('.speak-status');
const said = (window) => window.evaluate(() => window.heard.said.map((one) => one.text));
const waitSaid = (window, count) => window.waitForFunction((wanted) => window.heard.said.length >= wanted, count);
const waitSounds = (window, count) => window.waitForFunction((wanted) => window.heard.sounds.length >= wanted, count, { timeout: 30000 });
const bar = (name) => `.speak-bar [data-read="${name}"]`;

// Puts the cursor at the very start or end of the chapter, and waits for the editor to hear of it, which is a moment after the key.
async function cursorTo(window, end) {
  await window.click('.ProseMirror');
  await window.keyboard.press(end === 'start' ? 'ControlOrMeta+Home' : 'ControlOrMeta+End');
  await window.waitForFunction((wanted) => {
    const selection = getSelection();
    const editor = document.querySelector('.ProseMirror');
    if (!editor.contains(selection.anchorNode)) return false;
    const range = document.createRange();
    range.selectNodeContents(editor);
    if (wanted === 'start') range.setEnd(selection.anchorNode, selection.anchorOffset);
    else range.setStart(selection.anchorNode, selection.anchorOffset);
    return range.toString() === '';
  }, end);
  await window.waitForTimeout(120);
}

async function typeChapter(window, lines) {
  await window.click('.ProseMirror');
  for (const [at, line] of lines.entries()) {
    if (at) await window.keyboard.press('Enter');
    await window.keyboard.type(line);
  }
}

(async () => {
  let { app, window, errors } = await launch();
  await window.setViewportSize({ width: 1200, height: 800 });
  await window.fill('#new-title', 'The Salt Road');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await typeChapter(window, ['Maren lit the lamp. It went out.', 'Nobody spoke. The ferry left.']);
  await window.click('#add-chapter');
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 2' && !document.querySelector('.ProseMirror').textContent);
  await typeChapter(window, ['The second chapter.']);
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 1');
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });
  const savedBefore = await window.evaluate(async () => (await window.storyTracker.loadChapter(document.querySelector('#chapter-list .row').dataset.id)).body);

  // With no voices at all, the app says so and offers the settings. No bar appears.
  await window.evaluate(() => { window.noOwnVoices = true; });
  await window.click('.read-aloud-button');
  await window.waitForSelector('.room-message:not([hidden]) >> text=There’s no voice to read with yet');
  assert.equal(await window.locator('.speak-bar').count(), 0);
  await window.click('.message-close');
  await window.evaluate(() => { window.noOwnVoices = false; });

  // The computer's own voice. From the start of the chapter, the title is read first.
  await cursorTo(window, 'start');
  await window.click('.read-aloud-button');
  await window.waitForSelector('.speak-bar');
  await waitSaid(window, 1);
  assert.equal(await marked(window), 'Chapter 1');
  assert.equal(await status(window), 'Sentence 1 of 5');
  assert.deepEqual(await window.$$eval('.speak-voice option', (options) => options.map((option) => option.textContent)), ['Usual voice', 'Desk Voice'], 'only voices on this computer are offered');
  assert.deepEqual(await window.$$eval('.speak-bar button, .speak-bar select', (nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
    ['Back a paragraph', 'Back a sentence', 'Pause', 'On a sentence', 'On a paragraph', 'Speed', 'Voice', 'Stop reading']);
  assert.ok(await window.$$eval('.speak-bar button', (buttons) => buttons.every((button) => button.classList.contains('tb-btn'))));
  assert.equal(await window.locator('.speak-bar .speak-play').count(), 1);

  // A sentence ends and the next begins, marked as it's read.
  await window.evaluate(() => window.endSaying());
  await waitMarked(window, 'Maren lit the lamp.');
  await window.evaluate(() => window.endSaying());
  await waitMarked(window, 'It went out.');
  // By sentence and by paragraph.
  await window.click(bar('on-paragraph'));
  await waitMarked(window, 'Nobody spoke.');
  await window.click(bar('on'));
  await waitMarked(window, 'The ferry left.');
  await window.click(bar('back'));
  await waitMarked(window, 'Nobody spoke.');
  await window.click(bar('back-paragraph'));
  await waitMarked(window, 'Maren lit the lamp.');
  // Pause, and moving while paused makes no sound.
  await window.click(bar('play'));
  assert.equal(await status(window), 'Paused at sentence 2 of 5');
  const count = (await said(window)).length;
  await window.click(bar('on'));
  await waitMarked(window, 'It went out.');
  assert.equal((await said(window)).length, count);
  await window.click(bar('play'));
  await waitSaid(window, count + 1);
  // The speed goes to the voice, which is always named, and is one of this computer's.
  await window.selectOption('.speak-speed', '1.5');
  await waitSaid(window, count + 2);
  const last = await window.evaluate(() => window.heard.said.at(-1));
  assert.deepEqual([last.rate, last.voice, last.local], [1.5, 'Desk Voice', true]);
  assert.ok(await window.evaluate(() => window.heard.said.every((one) => one.local === true && one.voice === 'Desk Voice')));

  // Editing while it reads: the mark stays with its sentence, and the new words are counted in.
  await window.click('.ProseMirror p');
  await window.keyboard.press('Home');
  await window.keyboard.type('First. ');
  await window.waitForFunction(() => document.querySelector('.speak-status').textContent === 'Sentence 4 of 6');
  assert.equal(await marked(window), 'It went out.');
  await window.keyboard.press('ControlOrMeta+z');
  await window.waitForFunction(() => document.querySelector('.speak-status').textContent === 'Sentence 3 of 5');

  // Escape stops. The mark goes, and the chapter is as it was saved: reading changes nothing in it.
  await window.keyboard.press('Escape');
  await window.waitForSelector('.speak-bar', { state: 'detached' });
  assert.equal(await marked(window), null);
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });
  assert.equal(await window.evaluate(async () => (await window.storyTracker.loadChapter(document.querySelector('#chapter-list .row').dataset.id)).body), savedBefore);

  // The pronunciation list, from Preferences, kept in the project.
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  await window.click('#prefs-tab-reading');
  await window.click('#pref-pronunciation');
  await window.fill('#pronunciation .say-word', 'Maren');
  await window.fill('#pronunciation .say-as', 'MAR-en');
  const before = (await said(window)).length;
  await window.click('#pronunciation .say-listen');
  await waitSaid(window, before + 1);
  assert.equal((await said(window)).at(-1), 'MAR-en');
  await window.click('#say-save');
  await window.waitForSelector('#pronunciation', { state: 'detached' });

  // Downloading the natural voices asks first. Cancel is what Enter and Escape choose, and chooses nothing.
  assert.match(await window.textContent('#pref-natural'), /About 401 MB, downloaded once, only if you ask/);
  await window.click('#pref-voice-get');
  await window.waitForFunction(() => document.querySelector('#pref-voice-get'));
  let boxes = await get(app, 'boxes');
  assert.deepEqual([boxes.at(-1).buttons, boxes.at(-1).defaultId, boxes.at(-1).cancelId], [['I Agree, Download', 'Read the Licence', 'Cancel'], 2, 2]);
  assert.match(boxes.at(-1).detail, /say clearly that a computer made it/);
  assert.equal(fs.existsSync(path.join(profile, 'voices', 'supertonic-3', 'installed.json')), false);
  await set(app, 'answers', [1, 0]);
  await window.click('#pref-voice-get');
  await window.waitForSelector('#pref-voice-remove');
  assert.match((await get(app, 'opened'))[0], /supertonic-3\/blob\/.+\/LICENSE$/);
  assert.equal(await window.locator('#pref-voice optgroup[label="Natural voices"] option').count(), 19);
  assert.deepEqual(await window.$$eval('#pref-voice optgroup[label="This computer’s voices"] option', (options) => options.map((option) => option.textContent)), ['Desk Voice']);
  assert.equal(await window.isChecked('#pref-carry-on'), true, 'carrying on starts on');
  await window.selectOption('#pref-voice', 'natural:M1');
  await window.selectOption('#pref-quality', 'best');
  await window.click('#pref-close');

  // A natural voice now, made by the voice process, one sentence at a time with the next ones made ahead.
  await cursorTo(window, 'start');
  await menu(app, 'read-aloud');
  await waitSounds(window, 1);
  assert.equal(await window.inputValue('.speak-voice'), 'natural:M1');
  assert.equal(await marked(window), 'Chapter 1');
  assert.ok(await voiceProcesses(app) >= 1, 'the voice has a process of its own');
  assert.ok((await window.evaluate(() => window.heard.sounds[0].length)) > 1000);
  await window.evaluate(() => window.endSound());
  await waitMarked(window, 'Maren lit the lamp.');
  await waitSounds(window, 2);
  // A pause drops the sound.
  await menu(app, 'read-aloud');
  await window.waitForFunction(() => /^Paused/.test(document.querySelector('.speak-status').textContent));
  assert.equal(await window.evaluate(() => window.heard.sounds.at(-1).stopped), true);
  await menu(app, 'read-aloud');
  await waitSounds(window, 3);

  // To the end of the chapter, and on into the next, title first. The cursor and the keyboard aren't moved.
  await window.click(bar('on-paragraph'));
  await window.click(bar('on'));
  await waitMarked(window, 'The ferry left.');
  let sounds = await window.evaluate(() => window.heard.sounds.length);
  await waitSounds(window, sounds + 1).catch(() => {});
  await window.waitForTimeout(300);
  await window.evaluate(() => window.endSound());
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 2', null, { timeout: 15000 });
  await waitMarked(window, 'Chapter 2');
  assert.equal(await status(window), 'Sentence 1 of 2');
  await window.waitForTimeout(500);
  await window.evaluate(() => window.endSound());
  await waitMarked(window, 'The second chapter.');
  // The book ends there.
  await window.waitForTimeout(500);
  await window.evaluate(() => window.endSound());
  await window.waitForFunction(() => document.querySelector('.speak-status').textContent === 'Finished');
  await window.click(bar('stop'));

  // With carrying on switched off, it stops at the chapter's end.
  await window.evaluate(() => window.storyTracker.saveSettings({ readAloud: { carryOn: false, voice: '' } }));
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 1');
  await window.evaluate(() => window.storyTracker.saveSettings({ readAloud: { voice: 'Desk Voice' } }));
  await cursorTo(window, 'end');
  await window.click('.read-aloud-button');
  await waitMarked(window, 'The ferry left.');
  await window.evaluate(() => window.endSaying());
  await window.waitForFunction(() => document.querySelector('.speak-status').textContent === 'Finished');
  assert.equal(await window.inputValue('#chapter-title'), 'Chapter 1');
  // The project's pronunciation was used for the name.
  await window.click(bar('back-paragraph'));
  await window.click(bar('play'));
  await cursorTo(window, 'start');
  await window.click(bar('stop'));
  await window.click('.read-aloud-button');
  await window.waitForSelector('.speak-bar');
  await window.waitForTimeout(200);
  await window.evaluate(() => window.endSaying());
  await waitMarked(window, 'Maren lit the lamp.');
  assert.equal((await said(window)).at(-1), 'MAR-en lit the lamp.');

  // Opening another chapter stops the reading of this one.
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 2' }).click();
  await window.waitForSelector('.speak-bar', { state: 'detached' });

  // Side by side, each page's button reads that page.
  await window.locator('#chapter-list .row', { hasText: 'Chapter 1' }).hover();
  await window.click('[aria-label="Open Chapter 1 beside"]');
  await window.waitForFunction(() => document.querySelectorAll('.ProseMirror').length === 2);
  await window.locator('.read-aloud-button').nth(1).click();
  await window.waitForSelector('.pane:nth-of-type(2) .speak-bar');
  assert.equal(await window.locator('.speak-bar').count(), 1);
  await window.locator('.read-aloud-button').nth(0).click();
  await window.waitForSelector('.pane:nth-of-type(1) .speak-bar');
  assert.equal(await window.locator('.speak-bar').count(), 1);
  await window.click(bar('stop'));
  await window.click('.close-pane');
  await window.waitForFunction(() => document.querySelectorAll('.ProseMirror').length === 1);

  // Small windows, every theme in all three Looks: the whole bar is on screen, and its words can be read.
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 1');
  await window.click('.read-aloud-button');
  await window.waitForSelector('.speak-bar');
  await window.click(bar('on'));
  const look = async (changes) => {
    await window.evaluate((wanted) => window.storyTracker.saveSettings(wanted), changes);
    await menu(app, 'settings-changed');
    await window.waitForFunction((wanted) => document.documentElement.dataset.theme === wanted.theme && document.documentElement.dataset.surface === wanted.surface, changes);
    await frames(window);
  };
  const combos = Object.entries(THEMES).flatMap(([id, theme]) => (theme.flat ? [[id, 'solid']] : theme.glass ? [[id, 'glass']] : [[id, 'solid'], [id, 'metallic'], [id, 'glass']]));
  const bad = [];
  for (const size of SMALL) {
    await window.setViewportSize(size);
    await window.waitForFunction((wanted) => window.innerWidth === wanted, size.width);
    for (const [theme, surface] of combos) {
      const where = `${theme} ${surface} at ${size.width}x${size.height}`;
      await look({ theme, surface });
      const hidden = await window.$$eval('.speak-bar button, .speak-bar select, .speak-status', (nodes) => nodes.filter((node) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !(box.left >= -0.5 && box.right <= window.innerWidth + 0.5 && box.top >= -0.5 && box.bottom <= window.innerHeight + 0.5 && node.contains(hit));
      }).map((node) => node.getAttribute('aria-label') ?? node.className));
      assert.deepEqual(hidden, [], where);
      // The page still has room to be read above the bar.
      assert.ok(await window.$eval('.page-scroll', (node) => node.getBoundingClientRect().height) >= 120, where);
      const { failures, counts } = await measure(window, { 'bar buttons': '.speak-bar .tb-btn', 'bar status': '.speak-status', 'bar lists': '.speak-bar select' });
      assert.deepEqual([counts['bar buttons'], counts['bar status'], counts['bar lists']], [6, 1, 2], where);
      bad.push(...failures.map((one) => ({ where, ...one })));
      // The mark is a line, not a colour behind the words, and it stands out from the page by at least 3 to 1.
      const mark = await window.$eval('.page-text .reading-sentence', (node) => {
        const style = getComputedStyle(node);
        return { line: style.textDecorationLine, thick: style.textDecorationThickness, color: style.textDecorationColor, behind: style.backgroundColor, sheet: getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim() };
      });
      assert.deepEqual([mark.line, mark.thick, mark.behind], ['underline', '3px', 'rgba(0, 0, 0, 0)'], where);
      const channels = (value) => (value.startsWith('#') ? [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) : value.match(/[\d.]+/g).slice(0, 3).map(Number));
      const light = (value) => channels(value).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, at) => sum + v * [0.2126, 0.7152, 0.0722][at], 0);
      const [high, low] = [light(mark.color), light(mark.sheet)].sort((a, b) => b - a);
      assert.ok((high + 0.05) / (low + 0.05) >= 3, `${where}: the mark ${mark.color} on ${mark.sheet}`);
    }
  }
  assert.deepEqual(bad, []);
  await window.setViewportSize({ width: 1200, height: 800 });
  await look({ theme: 'light', surface: 'solid' });
  await window.click(bar('stop'));

  // Export as audio: an MP3 of the book, which the app's own decoder can play, with the note that a computer made it.
  await window.evaluate(() => window.storyTracker.saveSettings({ readAloud: { voice: 'natural:F1', quality: 'faster' } }));
  const decoded = (file) => window.evaluate(async (data) => {
    const context = new OfflineAudioContext(1, 1, 44100);
    const sound = await context.decodeAudioData(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer);
    return sound.duration;
  }, fs.readFileSync(file).toString('base64'));
  await menu(app, 'export-audio');
  await window.waitForSelector('#audio-export[open]');
  assert.match(await window.textContent('#audio-label-note'), /say clearly that a computer made the voice/);
  const audiobooks = !(await window.$eval('#audio-format option[value="m4b"]', (option) => option.disabled));
  assert.equal(audiobooks, process.platform !== 'linux', 'Windows and Mac can make an audiobook, and Linux can’t');
  assert.equal(await window.locator('#audio-no-m4b').count(), audiobooks ? 0 : 1);
  await window.selectOption('#audio-what', { label: 'This book: The Salt Road' });
  const mp3 = path.join(work, 'book.mp3');
  await set(app, 'saveTo', mp3);
  await window.click('#audio-go');
  await window.waitForSelector('.room-message:not([hidden]) >> text=Saved the audio', { timeout: 60000 });
  assert.equal((await get(app, 'saveOptions')).defaultPath, 'The Salt Road.mp3');
  assert.equal(fs.existsSync(`${mp3}.part`), false);
  const bytes = fs.readFileSync(mp3);
  assert.equal(bytes.subarray(0, 3).toString(), 'ID3');
  assert.ok(bytes.includes(Buffer.from(MACHINE_MADE, 'utf16le')), 'the file says a computer made its voice');
  assert.ok(await decoded(mp3) > 2);
  assert.equal(await window.locator('.audio-job').count(), 0);
  if (audiobooks) {
    const m4b = path.join(work, 'book.m4b');
    await set(app, 'saveTo', m4b);
    await menu(app, 'export-audio');
    await window.waitForSelector('#audio-export[open]');
    await window.selectOption('#audio-what', { label: 'This book: The Salt Road' });
    await window.selectOption('#audio-format', 'm4b');
    await window.click('#audio-go');
    await window.waitForSelector('.room-message:not([hidden]) >> text=book.m4b', { timeout: 60000 });
    assert.equal(fs.readFileSync(m4b).subarray(4, 12).toString(), 'ftypM4B ');
    assert.ok(await decoded(m4b) > 2);
  }

  // Stopped part way, an export leaves nothing. A long chapter keeps it busy long enough to stop it.
  await window.evaluate(async () => {
    const id = document.querySelector('#chapter-list .row').dataset.id;
    const content = Array.from({ length: 400 }, (_, at) => ({ type: 'paragraph', content: [{ type: 'text', text: `Sentence number ${at} goes on a little way before it ends.` }] }));
    await window.storyTracker.saveChapter({ id, title: 'Chapter 1', body: JSON.stringify({ type: 'doc', content }) });
  });
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 2' }).click();
  await window.waitForFunction(() => document.querySelector('#chapter-title').value === 'Chapter 2');
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  await window.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('Sentence number 399'));
  const stopped = path.join(work, 'stopped.mp3');
  await set(app, 'saveTo', stopped);
  await menu(app, 'export-audio');
  await window.waitForSelector('#audio-export[open]');
  await window.click('#audio-go');
  await window.waitForSelector('.audio-job');
  await window.click('#audio-stop');
  await window.waitForSelector('.room-message:not([hidden]) >> text=stopped, so no file was made', { timeout: 30000 });
  assert.deepEqual([fs.existsSync(stopped), fs.existsSync(`${stopped}.part`)], [false, false]);

  // A password, and then reading and an export are both going when the project locks. Both stop, the voice process ends, and nothing
  // of the unfinished file is left. Starting an export of a locked-away project asks for the password first, as other exports do.
  const recovery = await window.evaluate(async (password) => {
    const key = await window.storyTracker.makeRecovery();
    await window.storyTracker.setPassword({ password });
    return Boolean(key);
  }, PASSWORD);
  assert.equal(recovery, true);
  await window.evaluate(() => window.storyTracker.closeProject());
  await app.close();
  assert.deepEqual(errors, []);

  ({ app, window, errors } = await launch());
  await window.setViewportSize({ width: 1200, height: 800 });
  await window.fill('input[type="password"]', PASSWORD);
  await window.keyboard.press('Enter');
  await window.waitForSelector('.ProseMirror', { timeout: 30000 });
  await window.locator('#chapter-list .row-main', { hasText: 'Chapter 1' }).click();
  await window.click('.read-aloud-button');
  await waitSounds(window, 1);
  const locked = path.join(work, 'locked.mp3');
  await set(app, 'saveTo', locked);
  await menu(app, 'export-audio');
  await window.waitForSelector('dialog[open]');
  if (await window.locator('#audio-export').count() === 0) {
    // The password check that every export of a protected project goes through.
    await window.fill('dialog[open] input[type="password"]', PASSWORD);
    await window.keyboard.press('Enter');
  }
  await window.waitForSelector('#audio-export[open]');
  await window.click('#audio-go');
  await window.waitForSelector('.audio-job');
  assert.equal(fs.existsSync(`${locked}.part`), true);
  assert.ok(await voiceProcesses(app) >= 1);
  await menu(app, 'lock');
  await window.waitForSelector('input[type="password"]');
  await window.waitForTimeout(1500);
  assert.deepEqual([fs.existsSync(locked), fs.existsSync(`${locked}.part`)], [false, false], 'nothing unencrypted is left');
  assert.equal(await window.locator('.speak-bar, .audio-job').count(), 0);
  assert.equal(await voiceProcesses(app), 0, 'the process that held the words has gone');
  const after = await window.evaluate(() => window.storyTracker.voiceSpeak({ text: 'Anything.', lang: 'en', voice: 'F1' }));
  assert.equal(after.code, 'cancelled');
  assert.equal(await window.evaluate(() => window.storyTracker.pronunciations().then(() => 'read', () => 'refused')), 'refused');

  assert.deepEqual(errors, []);
  await app.close();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  console.log('read aloud e2e passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
