// Read aloud: the bar, moving through a chapter a sentence at a time, and playing it. The speech is made by the natural voices (the
// shared engine, in a process of its own, asked through the main process) or by one of the computer's own. The sentences and the
// stepping are in ../shared/reading.js.
import {
  DEFAULT_READ_ALOUD, NATURAL, SPEEDS, languageOf, openingOf, paragraphFrom, sentencesOf, startAt,
} from '../shared/reading.js';
import { applyPronunciation, breathAt, voiceLabel, withBreath } from '../main/core/read-aloud/voice-text.js';
import { QUALITY, QUICK_STEPS, stepGovernor } from '../main/core/read-aloud/voice-tone.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { markReading, readingRange } from './reading-mark.js';

// How many sentences are made ahead while one plays, so there's no wait between them.
const AHEAD = 2;

// The tests stand in for what they can't have: a sound card and the system's voices. Nothing in the app sets this.
const stand = () => window.readAloudStandIn;
const speech = () => stand()?.synth ?? window.speechSynthesis;
// Only voices that are on this computer. Some systems list online ones too, which would send the words away.
export const ownVoices = () => (speech()?.getVoices?.() ?? []).filter((voice) => voice.localService === true);

// A computer's own voice that speaks the language, preferring the system's usual one.
function ownVoiceFor(language) {
  const voices = ownVoices();
  const speaks = voices.filter((voice) => !language || voice.lang?.toLowerCase().startsWith(language));
  return speaks.find((voice) => voice.default) ?? speaks[0] ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
}

// The system lists its voices a moment after it's first asked.
function voicesListed() {
  const synth = speech();
  if (!synth || synth.getVoices().length || !synth.addEventListener) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve();
    };
    const timer = setTimeout(done, 700);
    synth.addEventListener('voiceschanged', done);
  });
}

// The paragraphs and headings of the chapter in the editor, with where each one's words begin.
function blocksOf(doc) {
  const blocks = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach((child) => {
      text += child.isText ? child.text : '\n';
    });
    blocks.push({ text, from: position + 1, heading: node.type.name === 'heading' });
    return false;
  });
  return blocks;
}

// Sound played by the app itself, through the speakers chosen. Gives { ended, stop }.
let sound = null;
function play(samples, rate, output) {
  if (stand()?.play) return stand().play(samples, rate, output);
  sound ??= new AudioContext();
  // The chosen speakers or headphones, or the computer's usual ones if they've gone.
  sound.setSinkId?.(output).catch(() => sound.setSinkId(''));
  if (sound.state === 'suspended') sound.resume();
  const buffer = sound.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0);
  const source = sound.createBufferSource();
  source.buffer = buffer;
  source.connect(sound.destination);
  let done;
  const ended = new Promise((resolve) => {
    done = resolve;
  });
  source.onended = () => done();
  source.start();
  return {
    ended,
    stop: () => {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // It hadn't started.
      }
      done();
    },
  };
}
export { play };

function barButton(name, label, glyph, onclick, extra = '') {
  return el('button', { type: 'button', class: `tb-btn ${extra}`, title: label, 'aria-label': label, dataset: { read: name }, onclick }, glyph);
}

export class ReadAloud {
  // `room` is asked for the page being read, the book a chapter is in and the chapter after it. `onMessage(text, action)` says things.
  constructor({ api, room, onMessage, onPreferences }) {
    this.api = api;
    this.room = room;
    this.onMessage = onMessage;
    this.onPreferences = onPreferences;
    this.page = null;
    this.bar = null;
    this.playing = false;
    // Goes up whenever what was being waited for no longer matters.
    this.generation = 0;
    this.made = new Map();
    this.governor = stepGovernor();
    this.player = null;
    // Escape stops reading, from the bar or the page. It's heard before the editor, which would take it for its own, but not while a
    // window, a menu or the list after @ is open, which Escape closes.
    this.keys = (event) => {
      if (event.key !== 'Escape' || !this.bar) return;
      if (document.querySelector('dialog[open], .popup-menu, .mention-pop')) return;
      if (!this.bar.contains(event.target) && !this.page.host.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      this.stop();
    };
    document.addEventListener('keydown', this.keys, true);
  }

  get reading() {
    return Boolean(this.page);
  }

  // The button and the shortcut: start, or else pause and carry on.
  async toggle() {
    if (this.starting || this.moving) return;
    if (!this.reading) await this.start();
    else if (this.playing) this.pause();
    else this.resume();
  }

  async start() {
    const page = this.room.activePage();
    if (!page?.editor) {
      this.onMessage('Open a chapter to have it read.');
      return;
    }
    this.starting = true;
    try {
      await this.prepare();
      const cursor = page.editor.state.selection.from;
      this.page = page;
      if (!(await this.take(page))) return;
      if (!this.items.length) {
        this.page = null;
        this.onMessage('There’s nothing in this chapter to read yet.');
        return;
      }
      if (!this.chooseVoice()) {
        this.page = null;
        this.onMessage('There’s no voice to read with yet. You can download the natural voices, or add one in your computer’s speech settings.', {
          label: 'Reading Aloud settings',
          run: () => this.onPreferences(),
        });
        return;
      }
      this.showBar();
      this.setPlaying(true);
      this.speak(startAt(this.items, cursor));
    } finally {
      this.starting = false;
    }
  }

  // What reading needs to know that doesn't change with the chapter. Asked again each time reading starts.
  async prepare() {
    const [settings, natural, list] = await Promise.all([this.api.settings(), this.api.voiceStatus(), this.api.pronunciations(), voicesListed()]);
    this.settings = { ...DEFAULT_READ_ALOUD, ...settings.readAloud };
    this.natural = natural;
    this.pronunciations = list;
    this.made.clear();
    this.governor.reset();
  }

  // Reads the page's chapter into sentences, and watches it for edits. False if reading was stopped, or the page moved on, meanwhile.
  async take(page) {
    this.release();
    const { editor, chapterId } = page;
    const book = this.room.bookOf(chapterId);
    const language = book ? (await this.api.getDetails(book)).details.language : '';
    if (this.page !== page || page.editor !== editor) {
      if (this.page === page) this.stop();
      return false;
    }
    this.editor = editor;
    this.chapterId = chapterId;
    this.bookLanguage = language;
    this.collect();
    this.language = languageOf(this.bookLanguage, this.items.slice(0, 80).map((item) => item.text).join(' '));
    this.edited = () => this.follow();
    this.editor.on('update', this.edited);
    return true;
  }

  release() {
    if (this.edited) this.editor?.off('update', this.edited);
    this.edited = null;
    this.unmark();
  }

  collect() {
    this.items = sentencesOf({ title: this.page.titleInput.value, blocks: blocksOf(this.editor.state.doc), lang: this.bookLanguage || undefined });
  }

  // The chapter was edited while it was being read: cut it into sentences again, and stay where we were.
  follow() {
    const at = readingRange(this.editor);
    const current = this.items[this.index];
    this.collect();
    if (!this.items.length) {
      this.stop();
      return;
    }
    if (current?.from !== null && at) this.index = startAt(this.items, at.from);
    this.index = Math.min(this.index, this.items.length - 1);
    this.showStatus();
  }

  // The voice to use: the one chosen, if it can be used here, and otherwise the best there is.
  chooseVoice() {
    const chosen = this.settings.voice;
    const naturalCan = this.natural.installed && this.language;
    const own = ownVoices();
    if (chosen.startsWith(NATURAL) && naturalCan) this.voice = chosen;
    else if (chosen && !chosen.startsWith(NATURAL) && own.some((voice) => voice.name === chosen)) this.voice = chosen;
    else if (naturalCan && !chosen) this.voice = `${NATURAL}F1`;
    else this.voice = '';
    if (chosen.startsWith(NATURAL) && this.natural.installed && !this.language && own.length) {
      this.onMessage('The natural voices don’t speak this book’s language, so your computer’s voice is reading it.');
    }
    return this.usesNatural() || own.length > 0;
  }

  usesNatural() {
    return this.voice.startsWith(NATURAL);
  }

  showBar() {
    this.removeBar();
    const speed = el('select', { class: 'speak-speed', 'aria-label': 'Speed', onchange: () => this.change({ speed: Number(speed.value) }) },
      SPEEDS.map((value) => el('option', { value: String(value) }, `${value}×`)));
    speed.value = String(this.settings.speed);
    const voice = el('select', { class: 'speak-voice', 'aria-label': 'Voice', onchange: () => this.chooseOther(voice.value) },
      this.natural.installed && this.language
        ? el('optgroup', { label: 'Natural voices' }, this.natural.voices.map((id) => el('option', { value: NATURAL + id }, voiceLabel(id))))
        : null,
      el('optgroup', { label: 'This computer’s voices' }, el('option', { value: '' }, 'Usual voice'), ownVoices().map((one) => el('option', { value: one.name }, one.name))));
    voice.value = this.voice;
    this.playButton = barButton('play', 'Pause', icon('pause'), () => this.toggle(), 'speak-play');
    this.status = el('span', { class: 'speak-status', role: 'status' });
    this.bar = el('div', { class: 'speak-bar', role: 'toolbar', 'aria-label': 'Read aloud' },
      barButton('back-paragraph', 'Back a paragraph', '«', () => this.jump(paragraphFrom(this.items, this.index, -1))),
      barButton('back', 'Back a sentence', '‹', () => this.jump(this.index - 1)),
      this.playButton,
      barButton('on', 'On a sentence', '›', () => this.jump(this.index + 1)),
      barButton('on-paragraph', 'On a paragraph', '»', () => this.jump(paragraphFrom(this.items, this.index, 1))),
      this.status,
      speed,
      voice,
      barButton('stop', 'Stop reading', icon('close'), () => this.stop()),
    );
    this.page.footer.before(this.bar);
  }

  removeBar() {
    this.bar?.remove();
    this.bar = null;
  }

  async change(changes) {
    this.settings = { ...this.settings, ...changes };
    this.api.saveSettings({ readAloud: changes }).catch((error) => this.onMessage(error.message));
    this.quiet();
    if (this.playing) this.speak(this.index);
  }

  chooseOther(voice) {
    this.voice = voice;
    this.change({ voice });
  }

  setPlaying(on) {
    this.playing = on;
    const label = on ? 'Pause' : 'Read';
    this.playButton?.replaceChildren(icon(on ? 'pause' : 'play'));
    this.playButton?.setAttribute('aria-label', label);
    this.playButton?.setAttribute('title', label);
  }

  showStatus(words) {
    if (this.status) this.status.textContent = words ?? `Sentence ${this.index + 1} of ${this.items.length}`;
  }

  // Marks the sentence being read, and brings it into sight.
  mark(item) {
    this.page.titleInput.classList.toggle('reading-sentence', item.from === null);
    markReading(this.editor, item.from === null ? null : { from: item.from, to: item.to });
    const scroller = this.page.scroller;
    const room = scroller.getBoundingClientRect();
    let top;
    let bottom;
    if (item.from === null) ({ top, bottom } = this.page.titleInput.getBoundingClientRect());
    else {
      top = this.editor.view.coordsAtPos(item.from).top;
      bottom = this.editor.view.coordsAtPos(item.to).bottom;
    }
    if (top < room.top + 8 || bottom > room.bottom - 8) scroller.scrollTop += top - room.top - room.height * 0.25;
  }

  unmark() {
    this.page?.titleInput.classList.remove('reading-sentence');
    if (this.editor) markReading(this.editor, null);
  }

  // Stops the sound, and drops what was being made.
  quiet() {
    this.generation += 1;
    this.player?.stop();
    this.player = null;
    speech()?.cancel();
    this.made.clear();
    this.api.voiceCancel().catch(() => {});
  }

  jump(to) {
    if (!this.reading || this.moving || to < 0 || to >= this.items.length) return;
    this.quiet();
    if (this.playing) this.speak(to);
    else {
      this.index = to;
      this.mark(this.items[to]);
      this.showStatus();
    }
  }

  pause() {
    if (this.moving) {
      this.stop();
      return;
    }
    this.setPlaying(false);
    this.quiet();
    this.showStatus(`Paused at sentence ${this.index + 1} of ${this.items.length}`);
  }

  resume() {
    this.setPlaying(true);
    this.speak(this.index);
  }

  speak(index) {
    // The chapter on this page was changed for another, by the author or by something that reloaded it.
    if (this.page.editor !== this.editor) {
      this.stop();
      return;
    }
    this.generation += 1;
    this.player?.stop();
    this.player = null;
    speech()?.cancel();
    if (index >= this.items.length) {
      this.finishChapter();
      return;
    }
    this.index = Math.max(0, index);
    this.mark(this.items[this.index]);
    this.showStatus();
    if (this.usesNatural()) this.speakNatural(this.generation);
    else this.speakOwn(this.generation);
  }

  // What's said for a sentence: its words, as the pronunciation list says them, with a breath or a sigh if Breathing is on.
  spoken(index, fresh = false) {
    return withBreath(applyPronunciation(this.items[index].text, this.pronunciations), breathAt(this.settings.breathing, this.items, index, fresh));
  }

  ask(text, steps, extra = {}) {
    return this.api.voiceSpeak({
      text, lang: this.language, voice: this.voice.slice(NATURAL.length), speed: this.settings.pace * this.settings.speed, steps, warmth: this.settings.warmth, ...extra,
    });
  }

  // A sentence's sound, asked for once. It's remembered by its words, so editing one sentence doesn't make the others again.
  make(index, steps = this.governor.cap(QUALITY[this.settings.quality])) {
    if (index >= this.items.length) return null;
    const text = this.spoken(index);
    if (!this.made.has(text)) this.made.set(text, { steps, sound: this.ask(text, steps) });
    return this.made.get(text);
  }

  async speakNatural(mine) {
    const text = this.spoken(this.index, true);
    let wanted = this.made.get(text) ?? this.made.get(this.spoken(this.index));
    let rest = null;
    if (!wanted) {
      // Nothing's ready, so someone is waiting: a quick setting, and the opening of a long sentence first.
      const steps = Math.min(this.governor.cap(QUALITY[this.settings.quality]), QUICK_STEPS);
      const parts = openingOf(text);
      wanted = { steps, sound: this.ask(parts ? parts[0] : text, steps, parts ? { tail: 0.15 } : {}) };
      if (parts) rest = this.ask(parts[1], steps, { head: 0.05 });
    }
    const made = await wanted.sound;
    if (mine !== this.generation || !this.playing) return;
    if (made.error) {
      this.voiceFailed(made, mine);
      return;
    }
    this.dropped = 0;
    this.governor.note(made.ms, made.samples.length / made.sampleRate, wanted.steps);
    for (let ahead = 1; ahead <= AHEAD; ahead += 1) this.make(this.index + ahead);
    if (!(await this.playOne(made, mine))) return;
    if (rest) {
      const second = await rest;
      if (mine !== this.generation || !this.playing) return;
      if (!second.error && !(await this.playOne(second, mine))) return;
    }
    // Only what's still to come is kept.
    this.made.delete(text);
    this.made.delete(this.spoken(this.index));
    this.speak(this.index + 1);
  }

  // Plays one piece of sound. False if reading moved on while it played.
  async playOne(made, mine) {
    this.player = play(made.samples, made.sampleRate, this.settings.output);
    const player = this.player;
    await player.ended;
    return mine === this.generation && this.playing && this.player === player;
  }

  voiceFailed(made, mine) {
    // Dropped, because something else asked the voice to start over. Ask again, a few times.
    if (made.code === 'cancelled') {
      this.dropped = (this.dropped ?? 0) + 1;
      if (this.dropped > 20) {
        this.dropped = 0;
        this.pause();
        return;
      }
      this.made.clear();
      setTimeout(() => {
        if (mine === this.generation && this.playing) this.speak(this.index);
      }, 150);
      return;
    }
    if (ownVoices().length) {
      this.onMessage(`${made.error} Your computer’s voice is reading on.`);
      this.voice = '';
      this.bar.querySelector('.speak-voice').value = '';
      this.speak(this.index);
      return;
    }
    this.onMessage(made.error);
    this.pause();
  }

  speakOwn(mine) {
    const synth = speech();
    const chosen = ownVoices().find((voice) => voice.name === this.voice) ?? ownVoiceFor(this.language);
    if (!synth || !chosen) {
      this.onMessage('Your computer has no voice of its own to read with.');
      this.pause();
      return;
    }
    const Utterance = stand()?.Utterance ?? window.SpeechSynthesisUtterance;
    const utterance = new Utterance(applyPronunciation(this.items[this.index].text, this.pronunciations));
    // Always named, so the system can't fall back to a voice that works over the internet.
    utterance.voice = chosen;
    utterance.lang = chosen.lang;
    utterance.rate = this.settings.speed;
    utterance.onend = () => {
      if (mine === this.generation && this.playing) this.speak(this.index + 1);
    };
    utterance.onerror = (event) => {
      if (mine !== this.generation || event.error === 'interrupted' || event.error === 'canceled') return;
      this.onMessage('Your computer’s voice stopped.');
      this.pause();
    };
    synth.speak(utterance);
  }

  async finishChapter() {
    const mine = this.generation;
    const next = this.settings.carryOn ? this.room.chapterAfter(this.chapterId) : null;
    if (next) {
      this.unmark();
      this.release();
      this.moving = true;
      try {
        await this.room.openToRead(this.page, next);
        if (mine !== this.generation || !this.reading) return;
        if (!(await this.take(this.page)) || mine !== this.generation) return;
        this.moving = false;
        this.speak(0);
        return;
      } catch (error) {
        this.onMessage(error.message);
      } finally {
        this.moving = false;
      }
    }
    this.setPlaying(false);
    this.unmark();
    this.index = 0;
    this.showStatus('Finished');
  }

  // Called when a page shows another chapter, or is closed.
  pageChanged(page) {
    if (page === this.page && !this.moving && this.editor && page.editor !== this.editor) this.stop();
  }

  stop() {
    if (!this.reading && !this.bar) return;
    this.moving = false;
    this.quiet();
    this.setPlaying(false);
    this.release();
    this.removeBar();
    this.page = null;
    this.editor = null;
  }

  destroy() {
    this.stop();
    document.removeEventListener('keydown', this.keys, true);
  }
}
