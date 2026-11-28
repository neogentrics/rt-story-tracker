// Export as audio: a chapter or a book read by the natural voices into an MP3, or into an audiobook with a chapter for each of the
// book's. It carries on while the author works. The sound is made a sentence at a time and written to disk as it comes, and the file
// only gets its name once it's whole (../main/read-aloud/audio-files.js).
import { MACHINE_MADE, id3, m4bEnd, m4bStart } from '../shared/audio-formats.js';
import { stillGoing } from '../shared/idle.js';
import { NATURAL, blocksOfDocument, languageOf, sentencesOf } from '../shared/reading.js';
import { applyPronunciation, breathAt, voiceLabel, withBreath } from '../main/core/read-aloud/voice-text.js';
import { QUALITY } from '../main/core/read-aloud/voice-tone.js';
import { el, fill } from './dom.js';
import { icon } from './icons.js';

const MP3_KBPS = 64;
const AAC_BITRATE = 96000;
const AAC = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, bitrate: AAC_BITRATE };
// Quiet added before a heading, in seconds. Between sentences the voice leaves its own.
const BEFORE_HEADING = 0.9;
const WRITE_AT = 1 << 20;

// Whether this computer can encode an audiobook's sound. Windows and Mac can; Linux has no encoder for it.
export const canMakeAudiobook = async () => {
  try {
    return Boolean((await window.AudioEncoder?.isConfigSupported(AAC))?.supported);
  } catch {
    return false;
  }
};

// The MP3 encoder is LAME, under the GNU LGPL. It's a file of its own, loaded only now, so that it can be replaced.
let lame = null;
function loadLame() {
  lame ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'lame.min.js';
    script.onload = () => resolve(window.lamejs);
    script.onerror = () => {
      lame = null;
      script.remove();
      reject(new Error('The MP3 encoder couldn’t be loaded.'));
    };
    document.head.append(script);
  });
  return lame;
}

// Sound goes to the main process in large pieces, in order.
function diskWriter(api, id) {
  let held = [];
  let size = 0;
  const flush = async () => {
    if (!size) return;
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of held) {
      out.set(part, at);
      at += part.length;
    }
    held = [];
    size = 0;
    await api.audioWrite(id, out);
  };
  return {
    flush,
    async add(bytes) {
      held.push(bytes);
      size += bytes.length;
      if (size >= WRITE_AT) await flush();
    },
  };
}

async function mp3File(disk, about) {
  const { Mp3Encoder } = await loadLame();
  await disk.add(id3(about));
  let encoder = null;
  return {
    async add(samples, rate) {
      encoder ??= new Mp3Encoder(1, rate, MP3_KBPS);
      const pcm = Int16Array.from(samples, (value) => Math.max(-1, Math.min(1, value)) * 32767);
      const encoded = encoder.encodeBuffer(pcm);
      if (encoded.length) await disk.add(new Uint8Array(encoded));
    },
    chapter() {},
    async finish() {
      if (encoder) await disk.add(new Uint8Array(encoder.flush()));
      await disk.flush();
      return {};
    },
    close() {},
  };
}

async function audiobookFile(disk, about) {
  const start = m4bStart();
  await disk.add(start.head);
  const frames = [];
  const chapters = [];
  let config = null;
  let encoder = null;
  let failed = null;
  let rate = 0;
  let position = 0;
  let writing = Promise.resolve();
  const open = (wanted) => {
    rate = wanted;
    encoder = new window.AudioEncoder({
      output(chunk, details) {
        const description = details?.decoderConfig?.description;
        if (description) config = new Uint8Array(ArrayBuffer.isView(description) ? description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength) : description.slice(0));
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        frames.push(bytes.length);
        writing = writing.then(() => disk.add(bytes));
        writing.catch((error) => {
          failed = error;
        });
      },
      error(error) {
        failed = error;
      },
    });
    encoder.configure({ ...AAC, sampleRate: wanted, aac: { format: 'aac' } });
  };
  return {
    async add(samples, wanted) {
      if (failed) throw failed;
      if (!encoder) open(wanted);
      const data = new window.AudioData({
        format: 'f32', sampleRate: wanted, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: Math.round((position / wanted) * 1e6), data: Float32Array.from(samples),
      });
      encoder.encode(data);
      data.close();
      position += samples.length;
      while (encoder.encodeQueueSize > 8 && !failed) await new Promise((done) => { setTimeout(done, 10); });
      await writing;
    },
    chapter(title) {
      chapters.push({ title, sample: position });
    },
    async finish() {
      await encoder.flush();
      await writing;
      if (failed) throw failed;
      await disk.flush();
      const end = m4bEnd({ rate, frames, config, bitrate: AAC_BITRATE, chapters, audioAt: start.audioAt, ...about });
      // An encoder may add a moment of quiet at the start. Chapter times are within a few hundredths of a second.
      return { tail: end.tail, patches: [{ at: start.sizeAt, bytes: end.mdatSize }] };
    },
    close() {
      if (encoder && encoder.state !== 'closed') encoder.close();
    },
  };
}
export class AudioExport {
  // `onUsed` is told when an export ends, which is when the idle lock starts counting again.
  constructor({ api, onMessage, onPreferences, onUsed }) {
    this.onUsed = onUsed;
    this.api = api;
    this.onMessage = onMessage;
    this.onPreferences = onPreferences;
    this.running = null;
    this.job = null;
  }

  // Audio being made counts as using the app, so the idle lock waits for it.
  get inUse() {
    return Boolean(this.running) && stillGoing(this.running.steppedAt);
  }

  // `scopes` are { scope, id, label, chapters: [ids], title, bookId }: this chapter, and this book.
  async open(scopes) {
    if (this.running) {
      this.onMessage('Audio is already being made.');
      return;
    }
    if (!scopes.length) {
      this.onMessage('Choose a chapter or a book first.');
      return;
    }
    const [status, settings, audiobook] = await Promise.all([this.api.voiceStatus(), this.api.settings(), canMakeAudiobook()]);
    document.getElementById('audio-export')?.remove();
    const what = el('select', { id: 'audio-what' }, scopes.map((scope, at) => el('option', { value: String(at) }, scope.label)));
    const format = el('select', { id: 'audio-format' },
      el('option', { value: 'mp3' }, 'MP3, one file'),
      el('option', { value: 'm4b', disabled: !audiobook }, 'Audiobook (.m4b), with chapters'));
    const chosen = settings.readAloud.voice.startsWith(NATURAL) ? settings.readAloud.voice.slice(NATURAL.length) : 'F1';
    const voice = el('select', { id: 'audio-voice' }, status.voices.map((id) => el('option', { value: id }, voiceLabel(id))));
    voice.value = chosen;
    const field = (label, control) => el('label', { class: 'field' }, el('span', {}, label), control);
    const dialog = el('dialog', { id: 'audio-export', class: 'dialog', 'aria-label': 'Export as audio' },
      el('h2', {}, 'Export as audio'),
      status.installed ? [
        field('What', what),
        field('As', format),
        audiobook ? null : el('p', { id: 'audio-no-m4b', class: 'quiet-note' }, 'This computer can’t make audiobook files, so it’s MP3 here.'),
        field('Voice', voice),
        el('p', { class: 'quiet-note' }, 'It uses your reading speed, pace and pronunciation list. On some computers, making the sound takes longer than playing it, so a book can take hours. You can keep writing meanwhile.'),
        el('p', { id: 'audio-lock-note', class: 'quiet-note' }, 'Audio files aren’t encrypted. The idle lock waits while the audio is made. If you lock the project, or this computer locks or sleeps, the export stops.'),
        el('p', { id: 'audio-label-note', class: 'room-message info' }, 'If you share this audio, say clearly that a computer made the voice. The voices’ licence requires it, and the file says so in its details.'),
      ] : el('p', { id: 'audio-need-voices' }, 'Audio is made with the natural voices, which aren’t on this computer yet.'),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', id: 'audio-close', onclick: () => dialog.close() }, 'Cancel'),
        status.installed
          ? el('button', {
            type: 'button',
            id: 'audio-go',
            class: 'primary',
            onclick: () => {
              const scope = scopes[Number(what.value)];
              const wanted = { format: format.value, voice: voice.value };
              dialog.close();
              this.make(scope, wanted).catch((error) => this.onMessage(error.message));
            },
          }, icon('export'), 'Export')
          : el('button', {
            type: 'button',
            id: 'audio-get-voices',
            class: 'primary',
            onclick: () => {
              dialog.close();
              this.onPreferences();
            },
          }, 'Reading Aloud settings')));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  showJob(state) {
    const words = el('span', { class: 'audio-job-text', role: 'status' }, 'Making audio… 0%');
    const progress = el('progress', { max: '100', value: '0', 'aria-label': 'Audio export' });
    this.job = el('div', { class: 'audio-job' }, words, progress,
      el('button', { type: 'button', class: 'tb-btn', id: 'audio-stop', onclick: () => { state.cancelled = true; this.api.voiceCancel().catch(() => {}); } }, 'Stop'));
    document.body.append(this.job);
    return (share, text) => {
      progress.value = String(share);
      words.textContent = text ?? `Making audio… ${share}%`;
    };
  }

  // One sentence's sound. Reading aloud can make the voice start over, which drops what was waiting, so it's asked for again.
  async soundOf(request, state) {
    for (let tries = 0; !state.cancelled; tries += 1) {
      const made = await this.api.voiceSpeak(request);
      if (!made.error) return made;
      if (made.code !== 'cancelled' || tries > 200) throw new Error(made.code === 'cancelled' ? 'The voice stopped, so no file was made.' : made.error);
      await new Promise((done) => { setTimeout(done, 100); });
    }
    return null;
  }

  async make(scope, { format, voice }) {
    const [{ readAloud: reading }, pronunciations, details] = await Promise.all([this.api.settings(), this.api.pronunciations(), this.api.getDetails(scope.bookId)]);
    // The chapters as they're saved now.
    const chapters = [];
    for (const id of scope.chapters) {
      const chapter = await this.api.loadChapter(id);
      chapters.push({ title: chapter.title, blocks: blocksOfDocument(chapter.body) });
    }
    const language = languageOf(details.details.language, chapters.flatMap((chapter) => chapter.blocks.map((block) => block.text)).join(' ').slice(0, 20000));
    if (!language) throw new Error('The natural voices don’t speak this book’s language, so it can’t be made into audio.');
    const lines = chapters.flatMap((chapter) => {
      const items = sentencesOf({ title: chapter.title, blocks: chapter.blocks, lang: details.details.language || undefined });
      return items.map((item, at) => ({
        starts: at === 0 ? chapter.title : null,
        heading: item.heading,
        text: withBreath(applyPronunciation(item.text, pronunciations), breathAt(reading.breathing, items, at, at === 0)),
      }));
    });
    if (!lines.length) throw new Error('There’s nothing to read there yet.');
    const id = await this.api.audioBegin({ format, name: scope.title });
    if (!id) return;

    const state = { cancelled: false, steppedAt: Date.now() };
    this.running = state;
    const show = this.showJob(state);
    let file = null;
    try {
      const disk = diskWriter(this.api, id);
      const about = { title: scope.title, author: details.details.author ?? '', comment: MACHINE_MADE };
      file = await (format === 'm4b' ? audiobookFile(disk, about) : mp3File(disk, about));
      const total = lines.reduce((sum, line) => sum + line.text.length, 0);
      let done = 0;
      let rate = 0;
      for (const line of lines) {
        const made = await this.soundOf({
          text: line.text, lang: language, voice, speed: reading.pace * reading.speed, steps: QUALITY[reading.quality], warmth: reading.warmth,
        }, state);
        if (!made || state.cancelled) break;
        if (line.heading && rate) await file.add(new Float32Array(Math.round(BEFORE_HEADING * rate)), rate);
        rate = made.sampleRate;
        if (line.starts !== null) file.chapter(line.starts);
        await file.add(made.samples, rate);
        state.steppedAt = Date.now();
        done += line.text.length;
        show(Math.floor((100 * done) / total));
      }
      if (state.cancelled) {
        await this.api.audioCancel(id);
        this.onMessage('The audio export was stopped, so no file was made.');
      } else {
        const saved = await this.api.audioFinish(id, await file.finish());
        this.onMessage(`Saved the audio to ${saved}. If you share it, say clearly that a computer made the voice.`, { label: 'Show in folder', run: () => this.api.revealFile(saved) });
      }
    } catch (error) {
      await this.api.audioCancel(id).catch(() => {});
      if (!state.cancelled) throw error;
    } finally {
      file?.close();
      this.job?.remove();
      this.job = null;
      this.running = null;
      this.onUsed?.();
    }
  }

  // The project is closing or locking.
  destroy() {
    if (this.running) this.running.cancelled = true;
    this.job?.remove();
    this.job = null;
    document.getElementById('audio-export')?.remove();
  }
}
