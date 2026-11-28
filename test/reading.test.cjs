'use strict';
// Read aloud without a screen or a voice: cutting writing into sentences, moving through them, the settings, the pronunciation list
// and where it's kept.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_READ_ALOUD, LONGEST, NATURAL_VOICES, blocksOfDocument, cleanPronunciations, cleanReadAloud, languageOf, openingOf, paragraphFrom,
  sentenceSpans, sentencesOf, startAt,
} = require('../src/shared/reading');
const { applyPronunciation } = require('../src/main/core/read-aloud/voice-text');
const { MAX_SENTENCE } = require('../src/main/read-aloud');
const { Settings } = require('../src/main/settings');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');

const tempDirs = [];
const spaces = [];
test.after(() => {
  spaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-reading-'));
  tempDirs.push(dir);
  return dir;
};

const cut = (text, lang = 'en') => sentenceSpans(text, lang).map(([start, end]) => text.slice(start, end));

test('writing is cut into sentences where a reader would', () => {
  assert.deepEqual(cut('The lamp went out. Nobody spoke! Did you see it?  “I did,” said Ann.'), ['The lamp went out.', 'Nobody spoke!', 'Did you see it?', '“I did,” said Ann.']);
  assert.deepEqual(cut('Dr. Orme met Mrs. Vale at St. Anne’s. J. R. Hale was late.'), ['Dr. Orme met Mrs. Vale at St. Anne’s.', 'J. R. Hale was late.']);
  // A line break ends a line of a poem, even after an initial.
  assert.deepEqual(cut('For J.\nWho waited.\n— the road'), ['For J.', 'Who waited.', '— the road']);
  // What there's nothing to say in is passed over.
  assert.deepEqual(cut('***\n   \nWords.\n…'), ['Words.']);
});

test('a run too long to say at once is cut at a pause, and nothing is lost', () => {
  const long = `${'and on it went, '.repeat(700)}to the end.`;
  const pieces = cut(long);
  assert.ok(pieces.length > 1);
  for (const piece of pieces) assert.ok(piece.length <= LONGEST, String(piece.length));
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
  assert.ok(LONGEST < MAX_SENTENCE, 'the voice service takes anything a cut sentence can be, with a breath and a pronunciation');
});

const body = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The Mill' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'It was ' }, { type: 'text', text: 'late.', marks: [{ type: 'bold' }] }, { type: 'text', text: ' It rained.' }] },
    { type: 'paragraph' },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One thing' }, { type: 'hardBreak' }, { type: 'text', text: 'and another.' }] }] }] },
    { type: 'horizontalRule' },
  ],
};

test('a chapter is read title first, then its paragraphs in order, each sentence with its place', () => {
  const blocks = blocksOfDocument(JSON.stringify(body));
  assert.deepEqual(blocks.map((block) => [block.text, block.heading]), [['The Mill', true], ['It was late. It rained.', false], ['One thing\nand another.', false]]);
  const items = sentencesOf({ title: 'Chapter 1', blocks: blocks.map((block, at) => ({ ...block, from: (at + 1) * 100 })) });
  assert.deepEqual(items.map((item) => item.text), ['Chapter 1', 'The Mill', 'It was late.', 'It rained.', 'One thing', 'and another.']);
  assert.deepEqual(items.map((item) => [item.from, item.to, item.block, item.heading]), [
    [null, null, -1, true], [100, 108, 0, true], [200, 212, 1, false], [213, 223, 1, false], [300, 309, 2, false], [310, 322, 2, false],
  ]);
  assert.deepEqual(sentencesOf({ title: '  ', blocks: [] }), []);
});

test('reading starts at the cursor’s sentence, and moves by sentence and paragraph', () => {
  const items = sentencesOf({
    title: 'T',
    blocks: [{ text: 'A one. A two.', from: 1 }, { text: 'B one. B two. B three.', from: 20 }, { text: 'C one.', from: 60 }],
  });
  const said = (index) => items[index].text;
  assert.equal(startAt(items, 1), 0, 'at the very start, the title comes first');
  assert.equal(said(startAt(items, 9)), 'A two.');
  assert.equal(said(startAt(items, 14)), 'A two.', 'the end of a sentence is still in it');
  assert.equal(said(startAt(items, 17)), 'B one.', 'between paragraphs, the next sentence');
  assert.equal(said(startAt(items, 999)), 'C one.', 'past the end, the last sentence');
  assert.equal(startAt(items, null), 0);
  const at = items.findIndex((item) => item.text === 'B two.');
  assert.equal(said(paragraphFrom(items, at, 1)), 'C one.');
  assert.equal(said(paragraphFrom(items, at, -1)), 'B one.', 'back goes to the paragraph’s own start first');
  assert.equal(said(paragraphFrom(items, at - 1, -1)), 'A one.');
  assert.equal(paragraphFrom(items, 0, -1), 0);
  assert.equal(paragraphFrom(items, items.length - 1, 1), items.length - 1);
});

test('a long first sentence is opened at a pause, so it’s heard sooner', () => {
  assert.equal(openingOf('A short one, quickly said.'), null);
  const long = 'He counted the stairs as he climbed them, forty on the way up and forty-one on the way down, and for a long while he could not decide which to trust.';
  const [first, rest] = openingOf(long);
  assert.ok(first.length >= 20 && first.length <= 90 && /[,;:—]$/.test(first), first);
  assert.equal(`${first} ${rest}`, long);
  const unbroken = 'word '.repeat(50).trim();
  const [start] = openingOf(unbroken);
  assert.ok(start.endsWith(','), 'with no pause, the opening ends on a comma so the voice stays up');
});

test('the settings kept on this computer are only ever choices that exist', () => {
  assert.deepEqual(cleanReadAloud(undefined), DEFAULT_READ_ALOUD);
  assert.equal(DEFAULT_READ_ALOUD.carryOn, true, 'carrying on into the next chapter starts on');
  const damaged = cleanReadAloud({ voice: 'natural:Z9', speed: 40, pace: 'fast', quality: 'huge', warmth: -3, breathing: 7, carryOn: 'no', output: 5 });
  assert.deepEqual(damaged, DEFAULT_READ_ALOUD);
  const kept = cleanReadAloud({ voice: 'natural:B2', speed: 1.5, pace: 1.25, quality: 'best', warmth: 0, breathing: 'reading', carryOn: false, output: 'headphones-1' });
  assert.deepEqual(kept, { voice: 'natural:B2', speed: 1.5, pace: 1.25, quality: 'best', warmth: 0, breathing: 'reading', carryOn: false, output: 'headphones-1' });
  assert.equal(cleanReadAloud({ voice: 'Microsoft Hazel' }).voice, 'Microsoft Hazel', 'one of the computer’s own voices, by name');
  assert.equal(NATURAL_VOICES.length, 19);
});

test('changing one reading setting leaves the rest', () => {
  const settings = new Settings(tempDir());
  settings.save({ readAloud: { speed: 1.5 } });
  settings.save({ readAloud: { voice: 'natural:M2' } });
  settings.save({ theme: 'dark' });
  assert.deepEqual([settings.values.readAloud.speed, settings.values.readAloud.voice], [1.5, 'natural:M2']);
});

test('the language comes from the book, or else from its words', () => {
  assert.equal(languageOf('es-MX', 'the and of to is in that it'), 'es');
  assert.equal(languageOf('tlh', 'anything'), null, 'a language the natural voices don’t speak');
  assert.equal(languageOf('', 'el gato de la casa que es de los niños y en la calle por las tardes con una'), 'es');
  assert.equal(languageOf('', 'Too few words.'), 'en');
});

test('the pronunciation list keeps whole rows, each word once, and changes only what’s said', () => {
  const list = cleanPronunciations([{ word: ' Siobhan ', say: 'shiv-awn' }, { word: 'siobhan', say: 'shi-VAWN' }, { word: 'Orme', say: '' }, { word: '', say: 'x' }, null, 7]);
  assert.deepEqual(list, [{ word: 'siobhan', say: 'shi-VAWN' }]);
  assert.equal(applyPronunciation('Siobhan met Siobhanna.', list), 'shi-VAWN met Siobhanna.');
});

test('the list is kept inside the project, encrypted, with no step that would stop 3.11 opening it', () => {
  const root = tempDir();
  const space = new Workspace(new Library(path.join(root, 'library')));
  spaces.push(space);
  const { id } = space.createProject('Names');
  const step = space.project.db.pragma('user_version', { simple: true });
  const tables = () => space.project.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.deepEqual(space.project.pronunciations(), []);
  assert.ok(!tables().includes('read_aloud'), 'a project that never has a list is left as it was');
  const secret = 'Quillivantharn';
  assert.deepEqual(space.project.savePronunciations([{ word: secret, say: 'KWIL-ee-van-tharn' }, { word: 'x', say: '' }]), [{ word: secret, say: 'KWIL-ee-van-tharn' }]);
  assert.equal(space.project.db.pragma('user_version', { simple: true }), step);
  assert.ok(space.project.check());
  space.closeProject();
  const every = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? every(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  for (const file of every(root)) assert.ok(!fs.readFileSync(file).includes(secret), `${path.basename(file)} holds a name in the clear`);
  space.openProject(id);
  assert.equal(space.project.pronunciations()[0].word, secret);
  // A damaged entry reads as no list, and can be saved over.
  space.project.db.prepare("UPDATE read_aloud SET value = 'not json'").run();
  assert.deepEqual(space.project.pronunciations(), []);
  const packed = path.join(tempDir(), 'names.rtstory');
  space.project.savePronunciations([{ word: secret, say: 'again' }]);
  space.library.packProject(id, packed);
  const elsewhere = new Library(path.join(tempDir(), 'elsewhere'));
  elsewhere.importProject(packed);
  const arrived = elsewhere.openProject(id);
  assert.deepEqual(arrived.pronunciations(), [{ word: secret, say: 'again' }], 'it travels with the project file');
  arrived.close();
});
