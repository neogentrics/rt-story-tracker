'use strict';
// The parts of an audio file that aren't the sound: an MP3's tags, and the box layout of an audiobook (.m4b, an MP4 file) with its
// chapters. Only bytes in and out, so the tests can read back what's written. The sound is encoded elsewhere: MP3 by LAME, and an
// audiobook's AAC by the system's own encoder.

// The model's licence asks that sound shared with others says clearly that a computer made it, so every file says so itself.
const MACHINE_MADE = 'Read by a computer-generated voice (Supertonic 3 by Supertone), made with RT Story Tracker. If you share it, say clearly that a computer made the voice.';

const join = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const bytes = (...values) => Uint8Array.from(values);
const ascii = (text) => Uint8Array.from(text, (character) => character.charCodeAt(0) & 255);
const utf8 = (text) => new TextEncoder().encode(text);
const u16 = (value) => bytes((value >>> 8) & 255, value & 255);
const u32 = (value) => bytes((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
const u64 = (value) => join([u32(Math.floor(value / 2 ** 32)), u32(value % 2 ** 32)]);
const zeros = (count) => new Uint8Array(count);

// ID3, version 2.3, which every player reads. Text is UTF-16, so any language comes through.
function utf16(text) {
  const out = new Uint8Array(2 + text.length * 2);
  out.set([0xff, 0xfe]);
  for (let at = 0; at < text.length; at += 1) out.set([text.charCodeAt(at) & 255, text.charCodeAt(at) >>> 8], 2 + at * 2);
  return out;
}
const frame = (name, body) => join([ascii(name), u32(body.length), u16(0), body]);
const textFrame = (name, text) => frame(name, join([bytes(1), utf16(text)]));

function id3({ title = '', author = '', comment = MACHINE_MADE } = {}) {
  const frames = join([
    title ? textFrame('TIT2', title) : zeros(0),
    author ? textFrame('TPE1', author) : zeros(0),
    textFrame('TSSE', 'RT Story Tracker'),
    // A comment: the language, a short description left empty, then the words.
    frame('COMM', join([bytes(1), ascii('eng'), utf16(''), bytes(0, 0), utf16(comment)])),
  ]);
  const size = frames.length;
  return join([ascii('ID3'), bytes(3, 0, 0), bytes((size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127), frames]);
}

// MP4 boxes: a length, a four-letter name, then what's inside.
const box = (name, ...inside) => {
  const body = join(inside);
  return join([u32(8 + body.length), ascii(name), body]);
};
// A box that starts with a version and some flags.
const fullBox = (name, version, flags, ...inside) => box(name, join([bytes(version), bytes((flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255)]), ...inside);

const SAMPLES_PER_FRAME = 1024;
const UNITY = join([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

// The start of the file. The sound follows it, and its length is filled in at the end.
function m4bStart() {
  const ftyp = box('ftyp', ascii('M4B '), u32(0), ascii('M4B '), ascii('M4A '), ascii('mp42'), ascii('isom'));
  // A long length (16 bytes of header), so a book of any length fits.
  const mdat = join([u32(1), ascii('mdat'), u64(0)]);
  return { head: join([ftyp, mdat]), sizeAt: ftyp.length + 8, audioAt: ftyp.length + mdat.length };
}

// How the decoder is to be set up, as MPEG-4 describes it.
function esds(config, bitrate) {
  const descriptor = (tag, body) => join([bytes(tag, body.length), body]);
  const decoder = descriptor(4, join([bytes(0x40, 0x15, 0, 0, 0), u32(bitrate), u32(bitrate), descriptor(5, config)]));
  return fullBox('esds', 0, 0, descriptor(3, join([u16(1), bytes(0), decoder, descriptor(6, bytes(2))])));
}

const handler = (type, name) => fullBox('hdlr', 0, 0, u32(0), ascii(type), zeros(12), ascii(name), bytes(0));
const dataHere = () => box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

const trackHeader = ({ id, duration, flags, volume }) => fullBox('tkhd', 0, flags,
  u32(0), u32(0), u32(id), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(volume), u16(0), UNITY, u32(0), u32(0));

const mediaHeader = (timescale, duration) => fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));

// Where each piece is. Everything in a track is one run in the file, so there's one place to give.
function sampleTable({ description, durations, sizes, at }) {
  const times = [];
  for (const duration of durations) {
    const last = times.at(-1);
    if (last && last[1] === duration) last[0] += 1;
    else times.push([1, duration]);
  }
  return box('stbl',
    fullBox('stsd', 0, 0, u32(1), description),
    fullBox('stts', 0, 0, u32(times.length), ...times.flatMap(([count, duration]) => [u32(count), u32(duration)])),
    fullBox('stsc', 0, 0, u32(1), u32(1), u32(sizes.length), u32(1)),
    fullBox('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32)),
    fullBox('co64', 0, 0, u32(1), u64(at)));
}

const tag = (name, type, value) => box(name, box('data', u32(type), u32(0), value));

// The end of the file: the chapter names, then the index of everything.
// `frames` is the length in bytes of each piece of AAC, `config` the encoder's setup, and `chapters` are { title, sample }, in order.
function m4bEnd({ rate, frames, config, bitrate, chapters = [], audioAt, title = '', author = '', comment = MACHINE_MADE }) {
  if (!frames.length || !config) throw new Error('There is no sound to put in the file.');
  const samples = frames.length * SAMPLES_PER_FRAME;
  const audioBytes = frames.reduce((sum, size) => sum + size, 0);
  const milliseconds = Math.round((samples / rate) * 1000);
  const marks = chapters.filter((chapter) => chapter.sample < samples);
  const startOf = (chapter) => Math.round((chapter.sample / rate) * 1000);

  // Apple's players read chapters as a track of text: each name, with its length in front.
  const names = marks.map((chapter) => {
    const words = utf8(chapter.title.slice(0, 200));
    return join([u16(words.length), words, box('encd', u32(0x00000100))]);
  });
  const textBytes = join(names);
  const spans = marks.map((chapter, at) => Math.max(1, (at + 1 < marks.length ? startOf(marks[at + 1]) : milliseconds) - (at === 0 ? 0 : startOf(chapter))));

  const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(1), u16(16), u16(0), u16(0), u32((rate << 16) >>> 0), esds(config, bitrate));
  const sound = box('trak',
    trackHeader({ id: 1, duration: milliseconds, flags: 7, volume: 0x0100 }),
    marks.length ? box('tref', box('chap', u32(2))) : zeros(0),
    box('mdia', mediaHeader(rate, samples), handler('soun', 'Sound'),
      box('minf', fullBox('smhd', 0, 0, u16(0), u16(0)), dataHere(),
        sampleTable({ description: mp4a, durations: frames.map(() => SAMPLES_PER_FRAME), sizes: frames, at: audioAt }))));

  const textEntry = box('text', zeros(6), u16(1), u32(1), u32(0), u32(0), zeros(8), zeros(12), zeros(8), u16(0), u16(0), u16(0), bytes(0));
  const chapterTrack = marks.length
    ? box('trak',
      // Switched off, so it's never shown as words on screen. It's only the list of chapters.
      trackHeader({ id: 2, duration: milliseconds, flags: 0, volume: 0 }),
      box('mdia', mediaHeader(1000, milliseconds), handler('text', 'Chapters'),
        box('minf', fullBox('nmhd', 0, 0), dataHere(),
          sampleTable({ description: textEntry, durations: spans, sizes: names.map((name) => name.length), at: audioAt + audioBytes }))))
    : zeros(0);

  // And the chapter list other players read. It holds up to 255, with names of up to 255 bytes, timed in ten-millionths of a second.
  const listed = marks.slice(0, 255);
  const nero = listed.length
    ? fullBox('chpl', 1, 0, u32(0), bytes(listed.length), ...listed.flatMap((chapter) => {
      const words = utf8(chapter.title).slice(0, 255);
      return [u64(startOf(chapter) * 10000), bytes(words.length), words];
    }))
    : zeros(0);

  const about = box('ilst',
    title ? tag('©nam', 1, utf8(title)) : zeros(0),
    title ? tag('©alb', 1, utf8(title)) : zeros(0),
    author ? tag('©ART', 1, utf8(author)) : zeros(0),
    tag('©cmt', 1, utf8(comment)),
    tag('©too', 1, utf8('RT Story Tracker')),
    // Says it's an audiobook.
    tag('stik', 21, bytes(2)));

  const moov = box('moov',
    fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(milliseconds), u32(0x00010000), u16(0x0100), zeros(10), UNITY, zeros(24), u32(marks.length ? 3 : 2)),
    sound,
    chapterTrack,
    box('udta', nero, fullBox('meta', 0, 0, handler('mdir', ''), about)));

  return { tail: join([textBytes, moov]), mdatSize: u64(16 + audioBytes + textBytes.length) };
}

module.exports = { MACHINE_MADE, SAMPLES_PER_FRAME, id3, m4bEnd, m4bStart };
