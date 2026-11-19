'use strict';
// A web clip: a document of kind "research" sent by Recon Browser over App Link. The words come with their source as front
// matter (source_url, source_title, source_author, source_date, accessed, category, tags), so any app can read one. This file
// only understands that shape. It never touches the network, and it never writes anything: where a clip goes is the inbox's
// business, and the author's choice. docs/design/the-suite.md has the reasoning.
const { splitFrontMatter } = require('./import/formats');

const RESEARCH = 'Research';
const MAX_FIELD = 300;
const MAX_TAGS = 12;
const CLIP_FIELDS = ['source_url', 'source_title', 'source_author', 'source_date', 'accessed', 'category', 'tags'];
const CATEGORIES = ['lore', 'character', 'setting', 'historical', 'science', 'general'];

const tidy = (text, limit = MAX_FIELD) => (typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '');

// Only a web address is kept as one. Anything else, such as javascript: or file:, is dropped.
function webAddress(text) {
  const value = tidy(text, 2000);
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

const calendarDate = (text) => (/^\d{4}-\d{2}-\d{2}/.test(tidy(text, 40)) ? tidy(text, 40).slice(0, 10) : '');

function tagsOf(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.replace(/^\[|\]$/g, '').split(',') : [];
  return [...new Set(list.map((tag) => tidy(tag, 40).replace(/^["']|["']$/g, '')).filter(Boolean))].slice(0, MAX_TAGS);
}

// Pictures are never fetched on arrival: that would tell the site the author read it. The reference stays as words, so the
// author can still see which picture it was and open it themselves.
function picturesAsWords(body) {
  return body
    .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, alt, url) => `[Image: ${tidy(alt, 120) ? `${tidy(alt, 120)} ` : ''}(${tidy(url, 500)})]`)
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] ?? '';
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
      return `[Image: ${tidy(alt, 120) ? `${tidy(alt, 120)} ` : ''}(${tidy(src, 500)})]`;
    });
}

// What the front matter says, made safe, and the words without it. A clip with no front matter, or front matter that
// doesn't close, is still a clip: it just has no source to show.
function readClip(text) {
  const { body, title, fields } = splitFrontMatter(String(text ?? '').replace(/\r\n?/g, '\n'));
  const source = {};
  const url = webAddress(fields.source_url);
  if (url) source.source_url = url;
  for (const key of ['source_title', 'source_author']) if (tidy(fields[key])) source[key] = tidy(fields[key]);
  for (const key of ['source_date', 'accessed']) if (calendarDate(fields[key])) source[key] = calendarDate(fields[key]);
  const category = tidy(fields.category, 20).toLowerCase();
  if (CATEGORIES.includes(category)) source.category = category;
  const tags = tagsOf(fields.tags);
  if (tags.length) source.tags = tags;
  return { source, title: tidy(title), body: picturesAsWords(body) };
}

// "Site, by Author, 12 April 2026": what the window shows under the title.
function sourceLine(source) {
  let site = '';
  if (source.source_url) site = new URL(source.source_url).hostname.replace(/^www\./, '');
  const parts = [source.source_title ?? site, source.source_author ? `by ${source.source_author}` : '', source.source_date ?? ''].filter(Boolean);
  return parts.join(', ');
}

// The front matter kept at the top of the chapter as lines of words, in a fixed order. v3.12 reads them back into a record.
function sourceBlocks(source) {
  return CLIP_FIELDS
    .filter((key) => source[key] !== undefined)
    .map((key) => ({ type: 'paragraph', content: [{ type: 'text', text: `${key}: ${Array.isArray(source[key]) ? source[key].join(', ') : source[key]}` }] }));
}

// The Research book: the one the author already has, or none, in which case it's made.
function researchBook(workspace) {
  const found = workspace.outline().children.find((node) => node.kind === 'book' && !node.trashedAt && node.title.trim().toLowerCase() === RESEARCH.toLowerCase());
  return found?.id ?? null;
}

module.exports = { RESEARCH, readClip, researchBook, sourceBlocks, sourceLine };
