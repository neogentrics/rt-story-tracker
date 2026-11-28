'use strict';
// This app's side of the natural voices. The speaking itself is the shared engine (../core/read-aloud, never edited here). This adds
// what's this app's own:
// - Words only reach the voice while a project is open, and when it closes or locks, whatever was being made is dropped and the voice
//   process, which holds the words in memory, is ended.
// - Everything the window sends is checked before the engine sees it.
// - Nothing is downloaded unless the author has just agreed, here, to the voice model's terms.
// - The engine's messages come back in this app's own words (./words.js).
const path = require('node:path');
const { FILES, LICENSE_URL, VOICES, VoiceStore, totalSize } = require('../core/read-aloud/voices');
const { LANGS } = require('../core/read-aloud/voice-text');
const { CANCELLED, downloadProblem, speakingProblem } = require('./words');

// The most one sentence can be. The window cuts text into sentences, and a longer run than this is cut again there.
const MAX_SENTENCE = 5000;
const DOWNLOAD_BYTES = totalSize(FILES);

// What the author agrees to before anything is downloaded. The model's licence asks that whoever uses it follows these, so they're
// put to the author in plain words, and the licence itself, which is what counts, is a click away.
const TERMS = {
  title: 'Natural voices',
  message: 'Download the natural voices?',
  detail: [
    `About ${Math.round(DOWNLOAD_BYTES / 1e7) * 10} MB, downloaded once from Supertone’s published files. After that they work offline, and nothing that’s read is ever sent anywhere.`,
    '',
    'The voices are Supertonic 3 by Supertone, under the BigScience Open RAIL-M licence. By downloading them you agree not to use them:',
    '• against the law, or to harm or take advantage of children or anyone else',
    '• to spread falsehoods or personal details that could hurt someone, or to defame or harass',
    '• to pretend to be a real person without their consent, or to discriminate',
    '• to give medical advice, or in decisions about people’s rights, or in police, court or immigration work',
    '• in sound you share, unless you say clearly that a computer made it',
    '',
    'This is a short version. The licence has the exact terms, and they’re what you agree to.',
  ].join('\n'),
  buttons: ['I Agree, Download', 'Read the Licence', 'Cancel'],
};

const within = (value, low, high, fallback) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

// For tests: tiny stand-ins, which the engine's own test mode "downloads" by writing, and a voice that plays a tone.
const STAND_IN_FILES = [{ path: 'LICENSE', size: 64, sha256: '' }, { path: 'onnx/tts.json', size: 32, sha256: '' }];

class ReadAloud {
  // `open` says whether a project is open to be read: a locked one never is, because locking closes it.
  constructor({ root, worker, fetch, fork, open, fake = false }) {
    this.voices = new VoiceStore({ root, worker, fetch, fork, fake, ...(fake ? { files: STAND_IN_FILES } : {}) });
    this.open = open;
    this.fake = fake;
    // Goes up whenever what's being spoken has to be forgotten. An answer from before is dropped.
    this.generation = 0;
  }

  status() {
    const { installed, downloading, done, total, error } = this.voices.status();
    return { installed, downloading, done, total: this.fake ? DOWNLOAD_BYTES : total, error: downloadProblem(error), voices: [...VOICES], licenseUrl: LICENSE_URL };
  }

  // `ask` shows the terms and gives the number of the button chosen; `openLicence` shows the licence.
  async install({ ask, openLicence, onProgress = () => {} }) {
    const now = this.status();
    if (now.installed || now.downloading) return now;
    for (;;) {
      const chosen = await ask(TERMS);
      if (chosen === 1) {
        await openLicence(LICENSE_URL);
        continue;
      }
      if (chosen !== 0) return { ...this.status(), declined: true };
      break;
    }
    await this.voices.install(() => onProgress(this.status()));
    const after = this.status();
    onProgress(after);
    return after;
  }

  cancelDownload() {
    this.voices.cancel();
    return this.status();
  }

  async remove() {
    this.hush();
    await this.voices.remove();
    return this.status();
  }

  // One sentence. Gives { sampleRate, samples, ms }, or { code, error }.
  async speak(job = {}) {
    const text = typeof job.text === 'string' ? job.text : '';
    if (!text.trim() || text.length > MAX_SENTENCE || !VOICES.includes(job.voice) || !LANGS.includes(job.lang)) {
      return { code: 'invalid', error: 'That couldn’t be read aloud.' };
    }
    const forgotten = () => ({ code: CANCELLED, error: CANCELLED });
    if (!this.open()) return forgotten();
    const generation = this.generation;
    try {
      const made = await this.voices.speak({
        text,
        lang: job.lang,
        voice: job.voice,
        speed: within(job.speed, 0.5, 3, 1.05),
        steps: Math.round(within(job.steps, 2, 16, 8)),
        warmth: within(job.warmth, 0, 1.5, 0),
        head: within(job.head, 0, 1, 0.1),
        tail: within(job.tail, 0, 1, 0.3),
      });
      return generation === this.generation && this.open() ? made : forgotten();
    } catch (error) {
      return generation === this.generation ? speakingProblem(error.message) : forgotten();
    }
  }

  // Drops what's waiting to be made, and the sentence being made.
  cancel() {
    this.voices.cancelSpeech();
  }

  // The project is closing or locking. The voice process is ended, and its memory with it.
  hush() {
    this.generation += 1;
    this.voices.cancelSpeech();
    this.voices.stop();
  }
}

const workerIn = (appPath) => path.join(appPath, 'dist', 'voice-worker.cjs');

module.exports = { MAX_SENTENCE, ReadAloud, STAND_IN_FILES, TERMS, workerIn };
