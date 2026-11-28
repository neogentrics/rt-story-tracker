'use strict';
// Read aloud, the parts that are only words and numbers: cutting writing into sentences, moving through them, the settings kept on
// this computer and the pronunciation list. No screen and no files, so the tests can hold it to account. The speech itself is the
// shared engine (../main/core/read-aloud).

const { toDocument } = require('./text');
const { BLENDS, SINGLE_VOICES, guessLang, modelLang } = require('../main/core/read-aloud/voice-text');
const { cleanReading, DEFAULT_READING } = require('../main/core/read-aloud/voice-tone');

// A natural voice is saved as this and its id; one of the computer's own as its name; and no choice yet as nothing.
const NATURAL = 'natural:';
const NATURAL_VOICES = [...SINGLE_VOICES, ...Object.keys(BLENDS)];
const SPEEDS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
// A sentence longer than this is read in pieces. The voice service takes no more.
const LONGEST = 4000;

const DEFAULT_READ_ALOUD = { voice: '', speed: 1, ...DEFAULT_READING, carryOn: true, output: '' };

// What's saved is only ever one of the choices offered, so a damaged settings file can't stop reading.
function cleanReadAloud(input) {
  const source = input && typeof input === 'object' ? input : {};
  const voice = typeof source.voice === 'string' ? source.voice.slice(0, 200) : '';
  return {
    voice: voice.startsWith(NATURAL) && !NATURAL_VOICES.includes(voice.slice(NATURAL.length)) ? '' : voice,
    speed: SPEEDS.includes(Number(source.speed)) ? Number(source.speed) : DEFAULT_READ_ALOUD.speed,
    ...cleanReading(source),
    carryOn: source.carryOn !== false,
    output: typeof source.output === 'string' ? source.output.slice(0, 500) : '',
  };
}

const MAX_WORDS = 2000;

// The pronunciation list: a word as it's written, and how to say it. Whole rows only, and each word once.
function cleanPronunciations(list) {
  const rows = new Map();
  for (const row of Array.isArray(list) ? list : []) {
    const word = typeof row?.word === 'string' ? row.word.trim().slice(0, 100) : '';
    const say = typeof row?.say === 'string' ? row.say.trim().slice(0, 200) : '';
    if (word && say) rows.set(word.toLowerCase(), { word, say });
  }
  return [...rows.values()].slice(0, MAX_WORDS);
}

// The language the natural voices would use: the book's own if it says one, or else a guess from its words. Null when the natural
// voices don't speak it, and then only the computer's own can. A book with too few words to guess from is taken to be English.
function languageOf(set, text) {
  if (String(set ?? '').trim()) return modelLang(set);
  return modelLang(guessLang(text) ?? 'en');
}

// Sentences. The system's rules for where one ends don't know "Dr." or an initial, so those are joined back on.
const SHORTENED = /(?:^|[\s(“"'‘])(?:Mr|Mrs|Ms|Mx|Dr|Prof|Rev|Fr|Sr|Jr|St|Mt|Capt|Lt|Col|Gen|Sgt|vs|e\.g|i\.e|[\p{Lu}])\.\s*$/u;
const SPOKEN = /[\p{L}\p{N}]/u;
let segmenters = new Map();

function segmenterFor(lang) {
  const key = lang || 'und';
  if (!segmenters.has(key)) {
    let made;
    try {
      made = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
    } catch {
      made = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    }
    segmenters.set(key, made);
  }
  return segmenters.get(key);
}

// Where to cut a run too long to be said in one go: after the last mark of a pause, or else at the last space.
function cutAt(text) {
  const head = text.slice(0, LONGEST);
  const pause = Math.max(...[',', ';', ':', '—'].map((mark) => head.lastIndexOf(mark)));
  if (pause > LONGEST / 2) return pause + 1;
  const space = head.lastIndexOf(' ');
  return space > 0 ? space + 1 : LONGEST;
}

// [start, end] of each sentence in a piece of text, without the spaces around it.
function sentenceSpans(text, lang) {
  const spans = [];
  for (const { index, segment } of segmenterFor(lang).segment(text)) {
    const previous = spans.at(-1);
    // A line break always ends a sentence: it's a line of a poem, or of an address.
    if (previous && !previous.closed && SHORTENED.test(text.slice(previous.start, previous.end))) previous.end = index + segment.length;
    else spans.push({ start: index, end: index + segment.length });
    spans.at(-1).closed = /\n\s*$/.test(segment);
  }
  const out = [];
  for (const span of spans) {
    let { start, end } = span;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    while (end - start > LONGEST) {
      const cut = start + cutAt(text.slice(start, end));
      out.push([start, cut]);
      start = cut;
    }
    if (end > start && SPOKEN.test(text.slice(start, end))) out.push([start, end]);
  }
  return out;
}

// The sentences of a chapter, in reading order. `blocks` are its paragraphs and headings: { text, from, heading }, where `from` is
// where the paragraph's words begin in the editor, and each character after is one place on. A line break counts as a character.
// The chapter's title is read first, and has no place on the page.
function sentencesOf({ title = '', blocks = [], lang }) {
  const items = [];
  const add = (text, from, to, block, heading) => items.push({ text: text.replace(/\s+/g, ' ').trim(), from, to, block, heading });
  if (SPOKEN.test(title)) add(title, null, null, -1, true);
  blocks.forEach((block, at) => {
    for (const [start, end] of sentenceSpans(block.text, lang)) {
      add(block.text.slice(start, end), block.from + start, block.from + end, at, Boolean(block.heading));
    }
  });
  return items;
}

// The paragraphs and headings of a saved chapter, for reading it without opening it.
function blocksOfDocument(body) {
  const blocks = [];
  const walk = (node) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = (node.content ?? []).map((child) => (child.type === 'text' ? child.text ?? '' : '\n')).join('');
      if (text) blocks.push({ text, from: 0, heading: node.type === 'heading' });
    } else (node.content ?? []).forEach(walk);
  };
  walk(typeof body === 'string' ? toDocument(body) : body);
  return blocks;
}

// The sentence the cursor is in, its very end included, or the next one after it. With the cursor at the start of the chapter, the
// title comes first, and past the last sentence it's the last one.
function startAt(items, position) {
  const first = items.findIndex((item) => item.from !== null);
  if (first < 0 || position === null || position <= items[first].from) return 0;
  const found = items.findIndex((item) => item.to !== null && item.to >= position);
  return found < 0 ? items.length - 1 : found;
}

// Where "on a paragraph" or "back a paragraph" goes from sentence `at`. Back from inside a paragraph goes to its start first.
function paragraphFrom(items, at, direction) {
  const startOf = (index) => {
    let first = index;
    while (first > 0 && items[first - 1].block === items[index].block) first -= 1;
    return first;
  };
  if (direction < 0) {
    const own = startOf(at);
    if (own < at) return own;
    return at > 0 ? startOf(at - 1) : 0;
  }
  let next = at + 1;
  while (next < items.length && items[next].block === items[at].block) next += 1;
  return next < items.length ? next : at;
}

// The first sentence of a reading is waited for. If it's long, its opening is made by itself, to be heard sooner, and the rest is
// made while that plays. The cut is at a pause in the sentence where there is one. Null for a sentence short enough already.
const OPENING = 90;
function openingOf(text) {
  if (text.length <= OPENING * 1.5) return null;
  const head = text.slice(0, OPENING);
  const pauses = [...head.matchAll(/[,;:—]\s/g)].map((found) => found.index + 1).filter((end) => end >= 20);
  if (pauses.length) {
    const end = pauses.at(-1);
    return [text.slice(0, end).trim(), text.slice(end).trim()];
  }
  const space = head.lastIndexOf(' ');
  // Ending on a comma keeps the voice up, where the full stop it would otherwise be given would bring it down.
  return space >= 20 ? [`${text.slice(0, space)},`, text.slice(space + 1)] : null;
}

module.exports = {
  DEFAULT_READ_ALOUD, LONGEST, NATURAL, NATURAL_VOICES, SPEEDS,
  blocksOfDocument, cleanPronunciations, cleanReadAloud, languageOf, openingOf, paragraphFrom, sentenceSpans, sentencesOf, startAt,
};
