'use strict';
// Highlighting and letter colours. A chapter keeps the colour the writer chose. What's shown on screen, and what goes into an export,
// is a shade of it with the same hue, only as much lighter or darker as it takes for the words to be easy to read on what's behind
// them: a red stays a red, and a yellow highlight stays a yellow highlight. Shared, so the screen and every export agree.

const { THEMES } = require('./themes');

// The highlight colours are ones Word's own highlighter has, so a Word export can use the highlighter for them. `word` is its name there.
const HIGHLIGHTS = [
  { name: 'Yellow', color: '#ffff00', word: 'yellow' },
  { name: 'Green', color: '#00ff00', word: 'green' },
  { name: 'Turquoise', color: '#00ffff', word: 'cyan' },
  { name: 'Pink', color: '#ff00ff', word: 'magenta' },
  { name: 'Grey', color: '#c0c0c0', word: 'lightGray' },
];

const TEXT_COLOURS = [
  { name: 'Red', color: '#c00000' },
  { name: 'Orange', color: '#b45309' },
  { name: 'Green', color: '#2e7d32' },
  { name: 'Blue', color: '#1f4e9e' },
  { name: 'Purple', color: '#7030a0' },
  { name: 'Grey', color: '#666666' },
];

// The two marks in a saved chapter. Each has one setting, `color`.
const HIGHLIGHT_MARK = 'highlight';
const TEXT_MARK = 'textColor';

// WCAG asks 4.5:1 of text. On screen a little more is asked, as room for what a Look draws behind the page.
const SCREEN_TEXT = 4.8;
const PAPER_TEXT = 4.5;
// High Contrast asks for more.
const STRONG_TEXT = 7;
// Highlighted words on screen are always dark on a light shade, in a light theme or a dark one, and well past the minimum.
const SCREEN_HIGHLIGHT = 7;
const HIGHLIGHT_INK = '#141414';
// In a dark theme the brightest highlights are taken down a little, to glare less.
const DARK_THEME_LIGHTEST = 0.9;

// Only a plain six-digit colour is ever used. A chapter can come from someone else, and this value ends up in styles and in files.
const cleanColour = (value) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);

const channelsOf = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
const hexOf = (channels) => `#${channels.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('')}`;
const toLinear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const fromLinear = (value) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

function luminance(hex) {
  const [r, g, b] = channelsOf(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// OKLCH, so a colour can be made lighter or darker without its hue moving.
function oklchOf(hex) {
  const [r, g, b] = channelsOf(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function linearOf(lightness, chroma, hue) {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// The same hue at another lightness. Where a screen can't show that much colour there, the colour is made a little less strong.
function atLightness(hex, lightness) {
  const [, chroma, hue] = oklchOf(hex);
  const fits = (value) => linearOf(lightness, value, hue).every((channel) => channel >= -0.0001 && channel <= 1.0001);
  let strong = chroma;
  if (!fits(strong)) {
    let low = 0;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + strong) / 2;
      if (fits(middle)) low = middle;
      else strong = middle;
    }
    strong = low;
  }
  return hexOf(linearOf(lightness, strong, hue).map((channel) => fromLinear(Math.min(1, Math.max(0, channel)))));
}

// The shade nearest in lightness to `hex` that passes, looking only the ways in `directions`.
function nearest(hex, passes, directions = [-1, 1]) {
  if (passes(hex)) return hex;
  const [start] = oklchOf(hex);
  for (let step = 1; step <= 200; step += 1) {
    for (const way of directions) {
      const lightness = start + way * step * 0.005;
      if (lightness < 0 || lightness > 1) continue;
      const shade = atLightness(hex, lightness);
      if (passes(shade)) return shade;
    }
  }
  return null;
}

// Letters of this colour, readable on every one of the backgrounds.
function readableOn(hex, backgrounds, ratio) {
  const passes = (shade) => backgrounds.every((background) => contrast(shade, background) >= ratio);
  const worst = (shade) => Math.min(...backgrounds.map((background) => contrast(shade, background)));
  return nearest(hex, passes) ?? (worst('#000000') > worst('#ffffff') ? '#000000' : '#ffffff');
}

// A highlight of this colour that `ink` can be read on. It only ever gets lighter.
const lightEnough = (hex, ink, ratio) => nearest(hex, (shade) => contrast(ink, shade) >= ratio, [1]) ?? '#ffffff';

function screenHighlight(hex, { dark = false } = {}) {
  const toned = dark && oklchOf(hex)[0] > DARK_THEME_LIGHTEST ? atLightness(hex, DARK_THEME_LIGHTEST) : hex;
  return lightEnough(toned, HIGHLIGHT_INK, SCREEN_HIGHLIGHT);
}

// Splits #rrggbb or #rrggbbaa into the colour and how solid it is.
const solidity = (value) => (value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1);
const over = (top, amount, bottom) => {
  const under = channelsOf(bottom);
  return hexOf(channelsOf(top.slice(0, 7)).map((channel, at) => channel * amount + under[at] * (1 - amount)));
};

// What can be behind a letter on the page in a theme: the page itself, and the page as Glass draws it, letting some of the desk's
// colours through. The tint behind a comment or a link to a record gives way to a line under coloured letters (style.css), so it
// doesn't have to be allowed for.
const GLASS_PAGE = 0.9;

function pageBackgrounds(themeName) {
  const theme = THEMES[themeName] ?? THEMES.light;
  const sheet = theme.sheet.slice(0, 7);
  const behind = [theme.desk, ...(theme.deskStops ?? [])].map((value) => value.slice(0, 7));
  const pages = new Set([sheet]);
  const amounts = [solidity(theme.sheet), ...(theme.flat ? [] : [solidity(theme.sheet) * GLASS_PAGE])];
  for (const amount of amounts) for (const under of behind) pages.add(over(sheet, amount, under));
  return [...pages];
}

// What the window draws in one theme.
function screenColours(themeName) {
  const theme = THEMES[themeName] ?? THEMES.light;
  const backgrounds = pageBackgrounds(themeName);
  const dark = theme.tone === 'dark';
  const highlight = (chosen) => screenHighlight(chosen, { dark });
  return {
    highlight,
    highlightInk: HIGHLIGHT_INK,
    text: (chosen) => readableOn(chosen, backgrounds, theme.flat ? STRONG_TEXT : SCREEN_TEXT),
    textOnHighlight: (chosen, behind) => readableOn(chosen, [highlight(behind)], SCREEN_TEXT),
  };
}

// For an export: shades that read on paper or a white page, where the words with no colour of their own are black.
const paperHighlight = (chosen) => lightEnough(chosen, '#000000', PAPER_TEXT);
const paperText = (chosen, behind = '#ffffff') => readableOn(chosen, [behind], PAPER_TEXT);

const chosenOn = (node, type) => cleanColour(node.marks?.find((mark) => mark.type === type)?.attrs?.color);

// The colours of one run of text as they go into a file. `highlighter` is the name Word's highlighter has for it, if it has it.
function onPaper(node) {
  const behind = chosenOn(node, HIGHLIGHT_MARK);
  const letters = chosenOn(node, TEXT_MARK);
  const fill = behind ? paperHighlight(behind) : null;
  return {
    fill,
    ink: letters ? paperText(letters, fill ?? '#ffffff') : null,
    highlighter: HIGHLIGHTS.find((item) => item.color === fill)?.word ?? null,
  };
}

// How many passages of each kind there are, for saying what a format without colour leaves out. Words side by side in one colour are
// one passage, however else they differ.
function countColoured(documents) {
  const found = { highlight: 0, text: 0 };
  const walk = (node) => {
    if (!node.content) return;
    for (const [key, type] of [['highlight', HIGHLIGHT_MARK], ['text', TEXT_MARK]]) {
      let last = null;
      for (const child of node.content) {
        const colour = child.type === 'text' ? chosenOn(child, type) : null;
        if (colour && colour !== last) found[key] += 1;
        last = colour;
      }
    }
    node.content.forEach(walk);
  };
  documents.forEach(walk);
  return found;
}

const passages = (count, words) => `${count} ${words} ${count === 1 ? 'passage' : 'passages'}`;

// "2 highlighted passages and 1 coloured passage", or nothing if there's no colour.
function colouredWords({ highlight, text }) {
  return [highlight ? passages(highlight, 'highlighted') : '', text ? passages(text, 'coloured') : ''].filter(Boolean).join(' and ');
}

module.exports = {
  HIGHLIGHTS, HIGHLIGHT_INK, HIGHLIGHT_MARK, PAPER_TEXT, SCREEN_TEXT, TEXT_COLOURS, TEXT_MARK,
  atLightness, cleanColour, colouredWords, contrast, countColoured, oklchOf, onPaper, pageBackgrounds, paperHighlight, paperText,
  readableOn, screenColours,
};
