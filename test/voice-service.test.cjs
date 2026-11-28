'use strict';
// The app's side of the natural voices: asking before anything is downloaded, what reaches the engine, letting go when a project
// closes or locks, the engine's messages in plain words, and the file an audio export is written into. The engine itself is real; its
// voice process is stood in for, and nothing here ever downloads anything.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ReadAloud, STAND_IN_FILES, TERMS } = require('../src/main/read-aloud');
const { AudioFiles } = require('../src/main/read-aloud/audio-files');
const { downloadProblem, speakingProblem } = require('../src/main/read-aloud/words');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');

const tempDirs = [];
test.after(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-voice-'));
  tempDirs.push(dir);
  return dir;
};

// A stand-in for the voice process. It speaks the same messages as the real one (core/read-aloud/voice-worker.js).
function processes({ hold = false, fail = '' } = {}) {
  const made = [];
  const fork = () => {
    const child = new EventEmitter();
    child.asked = [];
    child.killed = false;
    child.waiting = [];
    child.postMessage = (message) => {
      child.asked.push(message);
      if (message.type === 'init') setImmediate(() => child.emit('message', fail ? { type: 'failed', error: fail } : { type: 'ready' }));
      if (message.type === 'speak') {
        const answer = () => child.emit('message', { type: 'audio', id: message.id, sampleRate: 100, samples: new Float32Array(50).fill(0.2), ms: 3 });
        if (hold) child.waiting.push(answer);
        else setImmediate(answer);
      }
    };
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('exit', 0));
    };
    made.push(child);
    return child;
  };
  return { made, fork };
}

const noDownload = () => {
  throw new Error('a test tried to download something');
};

function service({ open = () => true, ...voice } = {}) {
  const started = processes(voice);
  const readAloud = new ReadAloud({ root: tempDir(), worker: '/the/worker.cjs', fetch: noDownload, fork: started.fork, open, fake: true });
  return { readAloud, made: started.made };
}

const agree = { ask: async () => 0, openLicence: async () => assert.fail('the licence wasn’t asked for') };
const job = { text: 'The lamp went out.', lang: 'en', voice: 'F1' };

test('the terms put the model’s limits to the author, and say who they’re agreeing with', () => {
  assert.deepEqual(TERMS.buttons, ['I Agree, Download', 'Read the Licence', 'Cancel']);
  assert.match(TERMS.detail, /About 400 MB/);
  assert.match(TERMS.detail, /Supertonic 3 by Supertone, under the BigScience Open RAIL-M licence/);
  for (const limit of ['against the law', 'harm or take advantage of children', 'falsehoods', 'defame or harass', 'pretend to be a real person', 'discriminate', 'medical advice', 'court or immigration', 'say clearly that a computer made it']) {
    assert.ok(TERMS.detail.includes(limit), limit);
  }
  assert.match(TERMS.detail, /By downloading them you agree/);
  assert.match(TERMS.detail, /The licence has the exact terms/);
});

test('nothing is downloaded unless the author agrees, and reading the licence isn’t agreeing', async () => {
  const { readAloud } = service();
  const said = [];
  const refused = await readAloud.install({ ask: async () => 2, openLicence: async () => {} });
  assert.deepEqual([refused.installed, refused.declined], [false, true]);
  assert.equal(fs.existsSync(path.join(readAloud.voices.dir, STAND_IN_FILES[0].path)), false);

  const answers = [1, 1, 2];
  const opened = [];
  await readAloud.install({ ask: async () => answers.shift(), openLicence: async (url) => opened.push(url) });
  assert.equal(opened.length, 2);
  assert.match(opened[0], /^https:\/\/huggingface\.co\/supertone-oss-archive\/supertonic-3\/blob\/[0-9a-f]{40}\/LICENSE$/);
  assert.equal(readAloud.status().installed, false);

  const done = await readAloud.install({ ...agree, onProgress: (status) => said.push(status.installed) });
  assert.equal(done.installed, true);
  assert.equal(said.at(-1), true);
  // Asking again when they're here asks nothing.
  await readAloud.install({ ask: async () => assert.fail('asked again'), openLicence: async () => {} });
  assert.equal((await readAloud.remove()).installed, false);
});

test('only a sentence, a voice and a language that exist reach the engine, with every number in range', async () => {
  const { readAloud, made } = service();
  await readAloud.install(agree);
  for (const wrong of [{}, { ...job, text: '   ' }, { ...job, text: 'x'.repeat(5001) }, { ...job, text: 7 }, { ...job, voice: '../../x' }, { ...job, voice: 'F9' }, { ...job, lang: 'tlh' }]) {
    assert.equal((await readAloud.speak(wrong)).code, 'invalid', JSON.stringify(wrong).slice(0, 80));
  }
  assert.equal(made.length, 0, 'no process was started for any of them');
  const result = await readAloud.speak({ ...job, speed: 99, steps: 500, warmth: -4, head: 'x', tail: 9 });
  assert.equal(result.sampleRate, 100);
  const asked = made[0].asked.find((message) => message.type === 'speak');
  assert.deepEqual([asked.speed, asked.steps, asked.warmth, asked.text], [3, 16, 0, 'The lamp went out.']);
  readAloud.hush();
});

test('with no voices downloaded it says so, in the app’s words', async () => {
  const { readAloud, made } = service();
  const result = await readAloud.speak(job);
  assert.equal(result.code, 'not_downloaded');
  assert.match(result.error, /download them in Preferences, under Reading Aloud/i);
  assert.equal(made.length, 0);
});

test('with no project open, nothing is spoken', async () => {
  let open = false;
  const { readAloud, made } = service({ open: () => open });
  await readAloud.install(agree);
  assert.equal((await readAloud.speak(job)).code, 'cancelled');
  assert.equal(made.length, 0);
  open = true;
  assert.ok((await readAloud.speak(job)).samples);
  readAloud.hush();
});

test('closing or locking a project drops what was being made and ends the voice process', async () => {
  const space = new Workspace(new Library(path.join(tempDir(), 'library')));
  space.createProject('Listening');
  const { readAloud, made } = service({ hold: true, open: () => Boolean(space.project) });
  await readAloud.install(agree);
  space.whenClosed(() => readAloud.hush());
  const waiting = readAloud.speak(job);
  while (!made[0]?.waiting.length) await new Promise((done) => { setImmediate(done); });
  space.closeProject();
  assert.deepEqual(await waiting, { code: 'cancelled', error: 'cancelled' });
  assert.equal(made[0].killed, true);
  assert.ok(made[0].asked.some((message) => message.type === 'cancel'));
});

test('sound that arrives after the project closed is thrown away', async () => {
  let open = true;
  const { readAloud, made } = service({ hold: true, open: () => open });
  await readAloud.install(agree);
  const waiting = readAloud.speak(job);
  while (!made[0]?.waiting.length) await new Promise((done) => { setImmediate(done); });
  open = false;
  made[0].waiting[0]();
  assert.equal((await waiting).code, 'cancelled');
  readAloud.hush();
});

test('a second thing that listens for closing doesn’t take the first one’s place', () => {
  const space = new Workspace(new Library(path.join(tempDir(), 'library')));
  space.createProject('Both');
  const heard = [];
  space.whenClosed(() => heard.push('voice'));
  space.onClose = () => heard.push('folder check');
  space.closeProject();
  assert.deepEqual(heard.sort(), ['folder check', 'voice']);
});

test('the engine’s messages come back in this app’s own words, never as they were', () => {
  const engine = ['The natural voices aren’t downloaded', 'The voice couldn’t start', 'The voice stopped unexpectedly', 'Unknown voice F9',
    'These voices don’t fit together', 'no available backend found. ERR: [wasm] Error [ERR_MODULE_NOT_FOUND]: Cannot find module \'/tmp/x\'',
    'std::bad_alloc', 'invalid input \'text_ids\' at /home/someone/model.onnx'];
  for (const message of engine) {
    const { error, code } = speakingProblem(message);
    assert.ok(error && code && error !== message, message);
    assert.doesNotMatch(error, /onnx|wasm|ERR_|\/|bad_alloc|text_ids/, message);
  }
  assert.deepEqual(speakingProblem('cancelled'), { code: 'cancelled', error: 'cancelled' });
  assert.equal(downloadProblem(''), '');
  for (const [message, words] of [
    ['The natural voices couldn’t be downloaded: onnx/vocoder.onnx didn’t match its published checksum', /thrown away/],
    ['The natural voices couldn’t be downloaded: onnx/tts.json: the server answered 503', /Try again later/],
    ['The natural voices couldn’t be downloaded: ENOSPC: no space left on device, write', /400 MB/],
    ['The natural voices couldn’t be downloaded: net::ERR_INTERNET_DISCONNECTED', /internet connection.*kept/s],
  ]) {
    assert.match(downloadProblem(message), words);
    assert.doesNotMatch(downloadProblem(message), /onnx|ENOSPC|ERR_|503/);
  }
});

test('an audio file takes its name only when it’s whole', () => {
  const dir = tempDir();
  const file = path.join(dir, 'book.mp3');
  const audio = new AudioFiles();
  const id = audio.begin(file);
  audio.write(id, Buffer.from('head----'));
  audio.write(id, Buffer.from('sound'));
  assert.deepEqual(fs.readdirSync(dir), ['book.mp3.part']);
  assert.throws(() => audio.finish(id, { patches: [{ at: 11, bytes: Buffer.from('xxx') }] }), /isn’t audio/);
  audio.finish(id, { tail: Buffer.from('.'), patches: [{ at: 4, bytes: Buffer.from('LEN!') }] });
  assert.deepEqual(fs.readdirSync(dir), ['book.mp3']);
  assert.equal(fs.readFileSync(file, 'utf8'), 'headLEN!sound.');
  assert.throws(() => audio.write(id, Buffer.from('more')), /stopped, so no file was made/);
  assert.throws(() => audio.write(audio.begin(path.join(dir, 'x.mp3')), 'not bytes'), /isn’t audio/);
});

test('an export that’s stopped, or whose project closes, leaves nothing behind', () => {
  const dir = tempDir();
  const space = new Workspace(new Library(path.join(tempDir(), 'library')));
  space.createProject('Exporting');
  const audio = new AudioFiles();
  space.whenClosed(() => audio.abandonAll());
  const kept = path.join(dir, 'already-there.mp3');
  fs.writeFileSync(kept, 'the one from last week');
  const one = audio.begin(kept);
  const two = audio.begin(path.join(dir, 'two.m4b'));
  audio.write(one, Buffer.from('half'));
  audio.abandon(one);
  space.closeProject();
  assert.deepEqual(fs.readdirSync(dir), ['already-there.mp3']);
  assert.equal(fs.readFileSync(kept, 'utf8'), 'the one from last week', 'a file that was there is left as it was');
  assert.throws(() => audio.write(two, Buffer.from('late')), /stopped, so no file was made/);
});
