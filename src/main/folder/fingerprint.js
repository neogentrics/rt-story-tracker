'use strict';
// A short mark of what a chapter says, to tell whether it has changed. Two documents get the same mark when they'd read and look the
// same. Comments and record links are left out of it: they're the author's notes on the words, not the words, so adding one isn't a
// change to the text. So is what the editor fills in by itself, such as a setting left at its usual value or an empty line at the end.
const crypto = require('node:crypto');
const { toDocument } = require('../../shared/text');

const NOTES = new Set(['comment', 'mention']);
const USUAL = { textAlign: 'left', start: 1 };

function settings(attrs) {
  const kept = Object.entries(attrs ?? {}).filter(([name, value]) => value !== null && value !== undefined && USUAL[name] !== value);
  return kept.length ? Object.fromEntries(kept.sort(([a], [b]) => a.localeCompare(b))) : undefined;
}

function tidy(node) {
  const marks = (node.marks ?? [])
    .filter((mark) => !NOTES.has(mark.type))
    .map((mark) => [mark.type, settings(mark.attrs) ?? null])
    .sort(([a], [b]) => a.localeCompare(b));
  if (node.type === 'text') return { text: node.text ?? '', ...(marks.length ? { marks } : {}) };
  const content = [];
  for (const child of (node.content ?? []).map(tidy)) {
    const last = content.at(-1);
    // Words split only where a comment began or ended are one run of words again.
    if (child.text !== undefined && last?.text !== undefined && JSON.stringify(child.marks) === JSON.stringify(last.marks)) last.text += child.text;
    else content.push(child);
  }
  const attrs = settings(node.attrs);
  return { type: node.type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

const emptyLine = (node) => node.type === 'paragraph' && !node.content;

function fingerprint(body) {
  const document = tidy(typeof body === 'string' ? toDocument(body) : body);
  const content = [...(document.content ?? [])];
  while (content.length && emptyLine(content.at(-1))) content.pop();
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

// How many comments and record links a chapter's text carries.
function notesIn(body) {
  const found = { comment: new Set(), mention: new Set() };
  const walk = (node) => {
    for (const mark of node.marks ?? []) if (NOTES.has(mark.type)) found[mark.type].add(mark.attrs?.id);
    (node.content ?? []).forEach(walk);
  };
  walk(toDocument(body));
  return { comments: found.comment.size, links: found.mention.size };
}

module.exports = { fingerprint, notesIn };
