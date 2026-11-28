'use strict';
// The audio files read back by a program that isn't this app: ffprobe and ffmpeg. Where they aren't installed these are skipped, and
// the end-to-end test still decodes an MP3 in the app itself.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MACHINE_MADE, id3, m4bEnd, m4bStart } = require('../src/shared/audio-formats');

const have = ['ffmpeg', 'ffprobe'].every((tool) => spawnSync(tool, ['-version']).status === 0);
const skip = !have && 'ffmpeg isn’t installed';
const tempDirs = [];
test.after(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-audio-'));
  tempDirs.push(dir);
  return dir;
};
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', '-show_format', '-show_streams', '-show_chapters', file], { encoding: 'utf8' }));
// Decodes the whole file, and gives what the decoder complained of.
const complaints = (file) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim();

test('every audio file says a computer made its voice', () => {
  assert.match(MACHINE_MADE, /computer-generated voice \(Supertonic 3 by Supertone\)/);
  assert.match(MACHINE_MADE, /say clearly that a computer made the voice/);
});

test('an MP3’s tags carry the title, the author and the note, in any language', { skip }, () => {
  const file = path.join(tempDir(), 'tagged.mp3');
  const sound = path.join(tempDir(), 'tone.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', '-write_id3v2', '0', '-write_xing', '0', sound]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(id3({ title: 'Żółw — 第一章', author: 'Marit Vale' })), fs.readFileSync(sound)]));
  const { format } = probe(file);
  assert.equal(format.tags.title, 'Żółw — 第一章');
  assert.equal(format.tags.artist, 'Marit Vale');
  assert.ok(Object.values(format.tags).includes(MACHINE_MADE), JSON.stringify(format.tags));
  assert.ok(Math.abs(Number(format.duration) - 2) < 0.2);
  assert.equal(complaints(file), '');
});

// Real AAC, in the shape the system's encoder gives it: raw frames, and the decoder's setup by itself.
function aacFrames(seconds, rate = 44100) {
  const file = path.join(tempDir(), 'tone.aac');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${seconds}:sample_rate=${rate}`, '-ac', '1', '-c:a', 'aac', '-b:a', '96k', '-f', 'adts', file]);
  const data = fs.readFileSync(file);
  const frames = [];
  let config = null;
  for (let at = 0; at + 7 <= data.length;) {
    const length = ((data[at + 3] & 3) << 11) | (data[at + 4] << 3) | (data[at + 5] >> 5);
    const header = data[at + 1] & 1 ? 7 : 9;
    const type = (data[at + 2] >> 6) + 1;
    const index = (data[at + 2] >> 2) & 15;
    const channels = ((data[at + 2] & 1) << 2) | (data[at + 3] >> 6);
    config ??= Uint8Array.from([(type << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3)]);
    frames.push(data.subarray(at + header, at + length));
    at += length;
  }
  return { frames, config, rate };
}

function audiobook(chapters, seconds = 6) {
  const { frames, config, rate } = aacFrames(seconds);
  const start = m4bStart();
  const end = m4bEnd({ rate, frames: frames.map((frame) => frame.length), config, bitrate: 96000, audioAt: start.audioAt, chapters, title: 'The Salt Road — Żółw', author: 'Marit Vale' });
  const whole = Buffer.concat([Buffer.from(start.head), ...frames, Buffer.from(end.tail)]);
  Buffer.from(end.mdatSize).copy(whole, start.sizeAt);
  const file = path.join(tempDir(), 'book.m4b');
  fs.writeFileSync(file, whole);
  return file;
}

test('an audiobook plays, with its chapters where they were marked', { skip }, () => {
  const file = audiobook([{ title: 'The Ledger', sample: 0 }, { title: 'The Mule — Żółw', sample: 2 * 44100 }, { title: 'Last', sample: Math.round(4.5 * 44100) }]);
  const { format, streams, chapters } = probe(file);
  assert.equal(complaints(file), '');
  const sound = streams.find((stream) => stream.codec_type === 'audio');
  assert.deepEqual([sound.codec_name, sound.sample_rate, sound.channels], ['aac', '44100', 1]);
  assert.ok(Math.abs(Number(format.duration) - 6) < 0.2, format.duration);
  assert.deepEqual(chapters.map((chapter) => chapter.tags.title), ['The Ledger', 'The Mule — Żółw', 'Last']);
  chapters.forEach((chapter, at) => assert.ok(Math.abs(Number(chapter.start_time) - [0, 2, 4.5][at]) < 0.05, `${at}: ${chapter.start_time}`));
  assert.equal(format.tags.title, 'The Salt Road — Żółw');
  assert.equal(format.tags.artist, 'Marit Vale');
  assert.equal(format.tags.comment, MACHINE_MADE);
});

test('an audiobook with one chapter, or none, is still a good file', { skip }, () => {
  for (const chapters of [[], [{ title: 'Only', sample: 0 }]]) {
    const file = audiobook(chapters, 2);
    assert.equal(complaints(file), '');
    assert.equal(probe(file).chapters.length, chapters.length);
  }
});

test('an audiobook with no sound isn’t made', () => {
  assert.throws(() => m4bEnd({ rate: 44100, frames: [], config: null, bitrate: 96000, audioAt: 48 }), /no sound/);
});
