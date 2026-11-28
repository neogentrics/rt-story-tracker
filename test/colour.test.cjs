'use strict';
// Highlighting and letter colours: the shades the window draws and the files get.
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HIGHLIGHTS, HIGHLIGHT_INK, TEXT_COLOURS, cleanColour, colouredWords, contrast, countColoured, oklchOf, onPaper, pageBackgrounds,
  paperHighlight, paperText, screenColours,
} = require('../src/shared/colour');
const { THEMES } = require('../src/shared/themes');

const PALETTE = [...new Set([...HIGHLIGHTS, ...TEXT_COLOURS].map((item) => item.color))];
// A spread over everything the system's colour picker can give, black and white included.
const STEPS = [0, 51, 102, 153, 204, 255];
const hex = (value) => value.toString(16).padStart(2, '0');
const ANY = STEPS.flatMap((r) => STEPS.flatMap((g) => STEPS.map((b) => `#${hex(r)}${hex(g)}${hex(b)}`)));
const EVERY = [...PALETTE, ...ANY];

const strongEnough = (colour) => oklchOf(colour)[1] > 0.1;
const turned = (a, b) => {
  const degrees = (Math.abs(oklchOf(a)[2] - oklchOf(b)[2]) * 180) / Math.PI;
  return degrees > 180 ? 360 - degrees : degrees;
};
// A shade keeps its meaning if its hue hasn't moved. Greys have no hue to keep, and nor has a colour left with hardly any strength.
const sameHue = (chosen, shade) => !strongEnough(chosen) || oklchOf(shade)[1] < 0.05 || turned(chosen, shade) < 4;

test('only a plain six-digit colour is ever used', () => {
  assert.equal(cleanColour('#FFcc00'), '#ffcc00');
  for (const wrong of ['red', '#fff', '#ffffffff', '#12345g', ' #123456', '#123456;color:red', '#123456"><script>', 'url(x)', '', null, undefined, 5, {}]) {
    assert.equal(cleanColour(wrong), null, String(wrong));
  }
});

for (const [id, theme] of Object.entries(THEMES)) {
  test(`on screen every colour can be read, and keeps its hue: ${theme.label}`, () => {
    const shades = screenColours(id);
    const pages = pageBackgrounds(id);
    const least = theme.flat ? 7 : 4.8;
    for (const chosen of EVERY) {
      const letters = shades.text(chosen);
      for (const page of pages) assert.ok(contrast(letters, page) >= least, `${chosen} as ${letters} on ${page}`);
      assert.ok(sameHue(chosen, letters), `${chosen} as letters turned into ${letters}`);
      const behind = shades.highlight(chosen);
      assert.ok(contrast(shades.highlightInk, behind) >= 7, `${chosen} as a highlight ${behind}`);
      assert.ok(sameHue(chosen, behind), `${chosen} as a highlight turned into ${behind}`);
    }
    for (const highlight of HIGHLIGHTS) {
      for (const chosen of PALETTE) {
        const letters = shades.textOnHighlight(chosen, highlight.color);
        assert.ok(contrast(letters, shades.highlight(highlight.color)) >= 4.8, `${chosen} on ${highlight.name}`);
      }
    }
  });
}

test('a colour that already reads well is left exactly as chosen', () => {
  const paper = screenColours('light');
  for (const name of ['Red', 'Green', 'Blue', 'Purple']) {
    const { color } = TEXT_COLOURS.find((item) => item.name === name);
    assert.equal(paper.text(color), color, name);
  }
  assert.equal(paper.highlight('#ffff00'), '#ffff00');
  assert.equal(paper.highlightInk, HIGHLIGHT_INK);
  // On a dark page the same red has to be lighter, and is still red.
  const night = screenColours('dark').text('#c00000');
  assert.notEqual(night, '#c00000');
  assert.ok(turned('#c00000', night) < 4);
});

test('on paper every colour can be read, and the palette comes through as chosen', () => {
  for (const chosen of EVERY) {
    assert.ok(contrast(paperText(chosen), '#ffffff') >= 4.5, `${chosen} as letters`);
    assert.ok(contrast('#000000', paperHighlight(chosen)) >= 4.5, `${chosen} as a highlight`);
    assert.ok(sameHue(chosen, paperText(chosen)) && sameHue(chosen, paperHighlight(chosen)), chosen);
  }
  for (const { color } of TEXT_COLOURS) assert.equal(paperText(color), color);
  for (const { color } of HIGHLIGHTS) assert.equal(paperHighlight(color), color);
});

const run = (text, marks = {}) => ({ type: 'text', text, marks: Object.entries(marks).map(([type, color]) => ({ type, attrs: { color } })) });

test('what goes into a file, and when Word can use its highlighter', () => {
  assert.deepEqual(onPaper(run('a')), { fill: null, ink: null, highlighter: null });
  assert.deepEqual(onPaper(run('a', { highlight: '#ffff00' })), { fill: '#ffff00', ink: null, highlighter: 'yellow' });
  assert.deepEqual(onPaper(run('a', { highlight: '#ffd8a8', textColor: '#c00000' })), { fill: '#ffd8a8', ink: '#c00000', highlighter: null });
  // A dark highlight is lightened until black can be read on it, and letters are shaded for the highlight they're on.
  const dark = onPaper(run('a', { highlight: '#000080', textColor: '#ffff00' }));
  assert.ok(contrast('#000000', dark.fill) >= 4.5 && contrast(dark.ink, dark.fill) >= 4.5, JSON.stringify(dark));
  assert.deepEqual(onPaper(run('a', { highlight: 'yellow', textColor: '#fff"/><x' })), { fill: null, ink: null, highlighter: null });
});

test('passages are counted as a reader would see them', () => {
  const document = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [run('one ', { highlight: '#ffff00' }), run('still one', { highlight: '#ffff00', bold: undefined }), run(' plain '), run('two', { highlight: '#ffff00' }), run('three', { highlight: '#00ff00' })] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [run('red', { textColor: '#c00000' }), run('damaged', { textColor: 'nonsense' })] }] }] },
    ],
  };
  assert.deepEqual(countColoured([document]), { highlight: 3, text: 1 });
  assert.equal(colouredWords({ highlight: 3, text: 1 }), '3 highlighted passages and 1 coloured passage');
  assert.equal(colouredWords({ highlight: 0, text: 2 }), '2 coloured passages');
  assert.equal(colouredWords({ highlight: 0, text: 0 }), '');
});
