'use strict';
// Highlighting and letter colours in exports: every format that has colour carries them, and the two that don't say so. The PDF is
// made by the app's own window, so it's checked in test/e2e/colours.e2e.cjs.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { strFromU8, unzipSync } = require('fflate');
const { checkExport, exportEverything, exportFile } = require('../src/main/export');
const { readSource } = require('../src/main/import');
const { fingerprint } = require('../src/main/folder/fingerprint');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { findInDocument } = require('../src/shared/find');
const { countWords, plainText } = require('../src/shared/text');

const tempDirs = [];
const workspaces = [];

test.after(() => {
  workspaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-colours-'));
  tempDirs.push(dir);
  return dir;
}

const mark = (type, color) => (color ? { type, attrs: { color } } : { type });
const run = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const para = (...content) => ({ type: 'paragraph', content });

// Yellow is one of Word's highlighter colours. Peach isn't. Navy is too dark to read black on, so on paper it's lightened.
const COLOURED = {
  type: 'doc',
  content: [
    para(run('Marked in '), run('sunlight', mark('highlight', '#ffff00')), run(' and '), run('peach', mark('highlight', '#ffd8a8'), mark('bold')), run('.')),
    para(run('Written in '), run('crimson', mark('textColor', '#c00000')), run(' and '), run('both at once', mark('highlight', '#00ffff'), mark('textColor', '#1f4e9e'), mark('italic')), run('.')),
    para(run('Deep ', mark('highlight', '#000080')), run('water.')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [para(run('a listed ', mark('underline')), run('amber', mark('textColor', '#ffbf00'), mark('underline')))] }] },
    { type: 'blockquote', content: [para(run('quoted green', mark('textColor', '#2e7d32')))] },
  ],
};
const WORDS = ['Marked', 'sunlight', 'peach', 'crimson', 'both at once', 'Deep', 'water', 'amber', 'quoted green'];

function book(body = COLOURED) {
  const space = new Workspace(new Library(path.join(tempDir(), 'library')));
  workspaces.push(space);
  const { id, outline } = space.createProject('Colour Book');
  const bookId = outline.children[0].id;
  const chapterId = outline.children[0].children[0].id;
  space.saveChapter({ id: chapterId, title: 'Colours', body: JSON.stringify(body) });
  return { space, id, bookId, chapterId };
}

async function exported(space, bookId, format) {
  const file = path.join(tempDir(), `out.${format}`);
  await exportFile(space.project, { scope: 'book', id: bookId, format, file });
  return file;
}
const unzipped = (file) => unzipSync(new Uint8Array(fs.readFileSync(file)));
const text = (file) => fs.readFileSync(file, 'utf8');

test('the saved chapter keeps the colour chosen, and its words count and are found as before', () => {
  const { space, chapterId } = book();
  const saved = JSON.parse(space.project.getItem(chapterId).body);
  assert.deepEqual(saved, COLOURED);
  const plain = JSON.parse(JSON.stringify(COLOURED), (key, value) => (key === 'marks' ? undefined : value));
  assert.equal(plainText(saved), plainText(plain));
  assert.equal(countWords(plainText(saved)), countWords(plainText(plain)));
  assert.equal(space.project.getItem(chapterId).words, countWords(plainText(plain)));
  // A word that's only partly highlighted is still one word to Find.
  const half = { type: 'doc', content: [para(run('sun'), run('light', mark('highlight', '#ffff00')))] };
  assert.equal(findInDocument(half, 'sunlight').length, 1);
  assert.equal(countWords(plainText(half)), 1);
  // Colouring words is a change to the chapter, so checking a folder again never writes over it without asking.
  assert.notEqual(fingerprint(saved), fingerprint(plain));
});

const HIGHLIGHTERS = new Set(['black', 'blue', 'cyan', 'darkBlue', 'darkCyan', 'darkGray', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'green', 'lightGray', 'magenta', 'none', 'red', 'white', 'yellow']);

test('Word: its highlighter where it has the colour, shading where it hasn’t, and letter colours', async () => {
  const { space, bookId } = book();
  const xml = strFromU8(unzipped(await exported(space, bookId, 'docx'))['word/document.xml']);
  const runs = [...xml.matchAll(/<w:r>(.*?)<\/w:r>/gs)].map((found) => found[1]);
  const propertiesOf = (words) => {
    const found = runs.find((item) => item.includes(`>${words}</w:t>`));
    assert.ok(found, `no run holds “${words}”`);
    return /<w:rPr>(.*?)<\/w:rPr>/s.exec(found)?.[1] ?? '';
  };
  const highlighterOf = (words) => /<w:highlight w:val="([^"]*)"/.exec(propertiesOf(words))?.[1] ?? null;
  const shadingOf = (words) => /<w:shd [^>]*w:fill="([^"]*)"/.exec(propertiesOf(words))?.[1] ?? null;
  const colourOf = (words) => /<w:color w:val="([^"]*)"/.exec(propertiesOf(words))?.[1] ?? null;

  assert.deepEqual([highlighterOf('sunlight'), shadingOf('sunlight'), colourOf('sunlight')], ['yellow', null, null]);
  assert.deepEqual([highlighterOf('peach'), shadingOf('peach')], [null, 'ffd8a8']);
  assert.match(propertiesOf('peach'), /<w:b\/>/);
  assert.match(propertiesOf('peach'), /<w:shd [^>]*w:val="clear"/);
  assert.deepEqual([highlighterOf('crimson'), colourOf('crimson')], [null, 'c00000']);
  assert.deepEqual([highlighterOf('both at once'), colourOf('both at once')], ['cyan', '1f4e9e']);
  assert.match(propertiesOf('both at once'), /<w:i\/>/);
  assert.equal(highlighterOf('Deep '), null);
  assert.notEqual(shadingOf('Deep '), '000080', 'navy is lightened for paper');
  assert.match(shadingOf('Deep '), /^[0-9a-f]{6}$/);
  assert.match(colourOf('amber'), /^[0-9a-f]{6}$/);
  assert.notEqual(colourOf('amber'), 'ffbf00', 'amber is darkened to read on white');
  assert.equal(colourOf('quoted green'), '2e7d32');
  assert.deepEqual([highlighterOf('water.'), shadingOf('water.'), colourOf('water.')], [null, null, null]);
  // Word allows no other value here, and the library would write any.
  for (const [, value] of xml.matchAll(/<w:highlight(?:Cs)? w:val="([^"]*)"/g)) assert.ok(HIGHLIGHTERS.has(value), value);
});

test('OpenDocument: each mix has a style of its own, and every style used is there', async () => {
  const { space, bookId } = book();
  const xml = strFromU8(unzipped(await exported(space, bookId, 'odt'))['content.xml']);
  const styles = new Map([...xml.matchAll(/<style:style style:name="([^"]+)" style:family="text"><style:text-properties ([^/]*)\/>/g)].map((found) => [found[1], found[2]]));
  const spans = new Map([...xml.matchAll(/<text:span text:style-name="([^"]+)">([^<]*)<\/text:span>/g)].map((found) => [found[2], found[1]]));
  for (const name of spans.values()) assert.ok(styles.has(name), `${name} is used and not made`);
  const lookOf = (words) => styles.get(spans.get(words));
  assert.equal(lookOf('sunlight'), 'fo:color="#000000" fo:background-color="#ffff00"');
  assert.equal(lookOf('peach'), 'fo:font-weight="bold" fo:color="#000000" fo:background-color="#ffd8a8"');
  assert.equal(lookOf('crimson'), 'fo:color="#c00000"');
  assert.equal(lookOf('both at once'), 'fo:font-style="italic" fo:color="#1f4e9e" fo:background-color="#00ffff"');
  assert.equal(lookOf('a listed '), 'style:text-underline-style="solid"');
  assert.match(lookOf('amber'), /^style:text-underline-style="solid" fo:color="#[0-9a-f]{6}"$/);
});

test('web page: colours, black words on highlights, and lighter letters where the page is dark', async () => {
  const { space, bookId } = book();
  const html = text(await exported(space, bookId, 'html'));
  assert.ok(html.includes('<span class="highlight" style="background-color:#ffff00;color:#000000">sunlight</span>'));
  assert.ok(html.includes('<span class="ink" style="color:#c00000">crimson</span>'));
  assert.ok(html.includes('<span class="highlight" style="background-color:#00ffff;color:#000000"><span class="ink on-highlight" style="color:#1f4e9e"><em>both at once</em></span></span>'));
  const dark = /@media \(prefers-color-scheme: dark\) \{ (\.ink[^\n]*) \}/.exec(html)[1];
  const lighter = /\.ink:not\(\.on-highlight\)\[style="color:#c00000"\] \{ color: (#[0-9a-f]{6}) !important; \}/.exec(dark)[1];
  assert.notEqual(lighter, '#c00000');
  assert.ok(!dark.includes('#00ffff'));
  // A book with no colour has none of this.
  const plain = book({ type: 'doc', content: [para(run('Plain.'))] });
  assert.ok(!text(await exported(plain.space, plain.bookId, 'html')).includes('.ink'));
});

test('e-book: colours go in with the words', async () => {
  const { space, bookId } = book();
  const chapter = strFromU8(unzipped(await exported(space, bookId, 'epub'))['OEBPS/chapter-1.xhtml']);
  assert.ok(chapter.includes('<span class="highlight" style="background-color:#ffff00;color:#000000">sunlight</span>'));
  assert.ok(chapter.includes('<span class="ink" style="color:#c00000">crimson</span>'));
});

const java = spawnSync('java', ['-version']).status === 0;

test('the official EPUB validator passes an e-book with colours', { skip: !java && 'Java is not installed' }, async () => {
  const { space, bookId } = book();
  const file = await exported(space, bookId, 'epub');
  const jar = fs.globSync('node_modules/epubchecker/vendors/*/epubcheck.jar')[0];
  const output = `${file}.json`;
  spawnSync('java', ['-jar', jar, file, '--json', output], { encoding: 'utf8' });
  const report = JSON.parse(text(output));
  const problems = report.messages.filter((item) => ['ERROR', 'FATAL', 'WARNING'].includes(item.severity));
  assert.deepEqual(problems.map((item) => `${item.severity} ${item.ID}: ${item.message} ${JSON.stringify(item.locations?.[0] ?? {})}`), []);
});

test('rich text: a colour table, the words pointing into it, and the words still all there', async () => {
  const { space, bookId } = book();
  const file = await exported(space, bookId, 'rtf');
  const rtf = text(file);
  const table = /\{\\colortbl;((?:\\red\d+\\green\d+\\blue\d+;)+)\}/.exec(rtf)[1];
  const colours = [...table.matchAll(/\\red(\d+)\\green(\d+)\\blue(\d+);/g)].map(([, r, g, b]) => `#${[r, g, b].map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`);
  const numberOf = (colour) => colours.indexOf(colour) + 1;
  const [black, yellow, red] = ['#000000', '#ffff00', '#c00000'].map(numberOf);
  assert.ok(black && yellow && red);
  assert.ok(rtf.includes(`{\\cf${black}\\chshdng0\\chcbpat${yellow}\\cb${yellow} sunlight}`));
  assert.ok(rtf.includes(`{\\cf${red} crimson}`));
  const read = await readSource(file);
  const back = read.blocks.map((block) => JSON.stringify(block)).join(' ');
  for (const word of WORDS) assert.ok(back.includes(word.split(' ')[0]), `${word} didn’t come back`);
  assert.ok(!back.includes(';;'), 'the colour table isn’t read as words');
  const plain = book({ type: 'doc', content: [para(run('Plain.'))] });
  assert.ok(!text(await exported(plain.space, plain.bookId, 'rtf')).includes('colortbl'));
});

test('XML: each span says its colours', async () => {
  const { space, bookId } = book();
  const xml = text(await exported(space, bookId, 'xml'));
  assert.ok(xml.includes('<span highlight="#ffff00">sunlight</span>'));
  assert.ok(xml.includes('<span style="bold" highlight="#ffd8a8">peach</span>'));
  assert.ok(xml.includes('<span style="italic" color="#1f4e9e" highlight="#00ffff">both at once</span>'));
});

test('Markdown and plain text can’t carry colours, keep every word, and say so before the export', async () => {
  const { space, bookId } = book();
  for (const [format, name] of [['md', 'Markdown'], ['txt', 'Plain text']]) {
    const output = text(await exported(space, bookId, format));
    for (const word of WORDS) assert.ok(output.includes(word), `${format} lost ${word}`);
    assert.doesNotMatch(output, /#[0-9a-f]{6}|<span|==/i);
    const [first] = checkExport(space.project, { scope: 'book', id: bookId, format });
    assert.equal(first, `${name} can’t keep colours, so the file won’t show them: 4 highlighted passages and 4 coloured passages. Your project keeps them.`);
  }
  for (const format of ['docx', 'odt', 'pdf', 'epub', 'html', 'rtf', 'xml']) {
    assert.ok(!checkExport(space.project, { scope: 'book', id: bookId, format }).some((line) => line.includes('colour')), format);
  }
  const plain = book({ type: 'doc', content: [para(run('Plain.'))] });
  assert.ok(!checkExport(plain.space.project, { scope: 'book', id: plain.bookId, format: 'md' }).some((line) => line.includes('colour')));
});

test('export everything writes Markdown, and says what it leaves out', async () => {
  const { space } = book();
  const { note } = await exportEverything(space.project, tempDir());
  assert.match(note, /^Chapters are saved as Markdown, which can’t keep colours, so these files don’t show them: 4 highlighted passages and 4 coloured passages\./);
  const plain = book({ type: 'doc', content: [para(run('Plain.'))] });
  assert.equal((await exportEverything(plain.space.project, tempDir())).note, '');
});

// A chapter can come from someone else's project file, so a colour in it is only a claim.
test('a colour that isn’t a colour reaches no export', async () => {
  const attack = '#fff"/><script>alert(1)</script>{\\evil};background:url(http://example.com/x)';
  const { space, bookId } = book({ type: 'doc', content: [para(run('safe words', mark('highlight', attack), mark('textColor', attack)), run(' and more', mark('textColor', 'red')))] });
  for (const format of ['md', 'txt', 'html', 'xml', 'rtf', 'docx', 'odt', 'epub']) {
    const file = await exported(space, bookId, format);
    const all = ['docx', 'odt', 'epub'].includes(format) ? Object.values(unzipped(file)).map((data) => strFromU8(data)).join('\n') : text(file);
    assert.ok(all.includes('safe words'), format);
    assert.doesNotMatch(all, /alert\(1\)|evil|example\.com\/x|color:red|w:val="red"/, format);
  }
});
