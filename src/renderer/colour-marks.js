// Highlighting and letter colours on the page. A mark keeps the colour the writer chose and nothing else, so that's what's saved.
// The shade the window draws it in depends on the theme, and comes from rules made here (../shared/colour.js says how). The page's
// security policy refuses a <style> element added later, so the rules live in a stylesheet made in code.
import { Mark } from '@tiptap/core';
import { HIGHLIGHT_MARK, TEXT_MARK, cleanColour, screenColours } from '../shared/colour.js';

export const ATTRIBUTES = { [HIGHLIGHT_MARK]: 'data-highlight', [TEXT_MARK]: 'data-color' };
const used = { [HIGHLIGHT_MARK]: new Set(), [TEXT_MARK]: new Set() };
let shades = screenColours('light');
let sheet = null;

const highlightedAs = (colour) => `[data-highlight='${colour}']`;
const lettersIn = (colour) => `[data-color='${colour}']`;

function draw() {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  const rules = [];
  for (const behind of used[HIGHLIGHT_MARK]) {
    rules.push(`.page-text ${highlightedAs(behind)} { background-color: ${shades.highlight(behind)}; color: ${shades.highlightInk}; }`);
    // The line under a button, which has to follow the theme as the page does.
    rules.push(`.colour-bar${highlightedAs(behind)} { background-color: ${shades.highlight(behind)}; }`);
  }
  for (const letters of used[TEXT_MARK]) {
    rules.push(`.page-text ${lettersIn(letters)} { color: ${shades.text(letters)}; }`);
    rules.push(`.colour-bar${lettersIn(letters)} { background-color: ${shades.text(letters)}; }`);
    // Coloured letters on a highlight are shaded for the highlight, not for the page. A highlight is always outside them.
    for (const behind of used[HIGHLIGHT_MARK]) {
      rules.push(`.page-text ${highlightedAs(behind)} ${lettersIn(letters)} { color: ${shades.textOnHighlight(letters, behind)}; }`);
    }
  }
  // Where the system uses its own colours, style.css marks highlights with the system's.
  sheet.replaceSync(`@media screen and (forced-colors: none) {\n${rules.join('\n')}\n}`);
}

// Makes sure there are rules for a colour.
export function note(type, colour) {
  if (used[type].has(colour)) return;
  used[type].add(colour);
  draw();
}

// Called whenever the theme changes.
export function shadeFor(themeName) {
  shades = screenColours(themeName);
  if (sheet) draw();
}

// The shade a colour is drawn in now, for the menus and the buttons.
export const shadeOf = (type, colour) => (type === HIGHLIGHT_MARK ? shades.highlight(colour) : shades.text(colour));

const colourMark = (name) => {
  const attribute = ATTRIBUTES[name];
  return Mark.create({
    name,
    addAttributes() {
      return {
        color: {
          default: null,
          parseHTML: (element) => cleanColour(element.getAttribute(attribute)),
          renderHTML: (attributes) => {
            const colour = cleanColour(attributes.color);
            if (!colour) return {};
            note(name, colour);
            return { [attribute]: colour };
          },
        },
      };
    },
    // Only this app's own copies are read back, as when words are cut and pasted. Colours from other programs aren't taken in.
    parseHTML() {
      return [{ tag: `span[${attribute}]`, getAttrs: (element) => (cleanColour(element.getAttribute(attribute)) ? null : false) }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', HTMLAttributes, 0];
    },
  });
};

// In this order, so a highlight is drawn around the letters' colour.
export const HighlightMark = colourMark(HIGHLIGHT_MARK);
export const TextColourMark = colourMark(TEXT_MARK);
