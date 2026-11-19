'use strict';
// The printable part of a record, and the only way anything leaves this app as a document. Print, Export everything and
// every other path that writes a record for someone else to read goes through printable(), so the author-only part has one
// place to stay out of. A field's audience says which part it's in, and in a kind that keeps versions the notes are two: the
// ones meant for print, and the author's own, which never leave here.
const { audienceOf, showValue, versionLabel } = require('../../shared/records');
const { toDocument } = require('../../shared/text');
const { documentHtml, documentMarkdown, escapeXml } = require('./text-formats');

// source: { title, number, values, authorNotes, printNotes, fields, versioning, revision, draft, changes }. `fields` and
// `versioning` come from the version when it was frozen, so a printed version is what was frozen, whatever the kind is now.
function printable(type, source, { names = () => '' } = {}) {
  const versioning = source.versioning ?? type.versioning;
  const fields = source.fields ?? type.fields;
  const shape = { ...type, versioning };
  const shown = [];
  for (const field of fields) {
    if (audienceOf(shape, field) !== 'print') continue;
    // Long text keeps its line breaks. Anything else is one line.
    const raw = showValue(field, source.values[field.id], names);
    const text = field.kind === 'longtext' ? raw.trim() : raw.replace(/\s*\n\s*/g, ' ');
    if (text) shown.push({ name: field.name, kind: field.kind, text, long: field.kind === 'longtext' });
  }
  const notes = versioning ? source.printNotes : source.authorNotes;
  const document = notes ? toDocument(notes) : null;
  return {
    label: versionLabel(shape, source.number, source.revision ?? 1, { draft: source.draft === true }),
    versioned: versioning,
    title: source.title,
    fields: shown,
    notes: document?.content?.some((block) => block.content?.length) ? document : null,
    changes: source.changes?.print ?? [],
  };
}

// A kind that doesn't keep versions is written as it always was: its name, its number and its fields. One that does also says
// which revision it is and what changed.
function printableMarkdown(page, numberLabel = '') {
  const lines = [`# ${page.title}`, ''];
  if (page.versioned) lines.push(`*${page.label}*`, '');
  if (numberLabel) lines.push(`**Number:** ${numberLabel}`);
  for (const field of page.fields.filter((item) => !item.long)) lines.push(`**${field.name}:** ${field.text}`);
  for (const field of page.fields.filter((item) => item.long)) lines.push('', `## ${field.name}`, '', field.text);
  if (page.changes.length) lines.push('', '## Changes since the last version', '', ...page.changes.map((change) => `- ${change}`));
  const notes = page.notes ? documentMarkdown(page.notes) : '';
  if (notes.trim()) lines.push('', notes);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// One page of a printed set: the label, the name, the fields, what changed and the notes.
function pageHtml(page) {
  const short = page.fields.filter((field) => !field.long);
  const long = page.fields.filter((field) => field.long);
  return `<section class="record">
<p class="label">${escapeXml(page.label)}</p>
<h1>${escapeXml(page.title)}</h1>
${short.length ? `<dl>${short.map((field) => `<dt>${escapeXml(field.name)}</dt><dd>${escapeXml(field.text)}</dd>`).join('')}</dl>` : ''}
${long.map((field) => `<h2>${escapeXml(field.name)}</h2><p>${escapeXml(field.text)}</p>`).join('\n')}
${page.changes.length ? `<h2>Changes since the last version</h2><ul>${page.changes.map((change) => `<li>${escapeXml(change)}</li>`).join('')}</ul>` : ''}
${page.notes ? `<div class="notes">${documentHtml(page.notes)}</div>` : ''}
</section>`;
}

const STYLE = `
  @page { size: 8.5in 11in; margin: 0.9in 0.85in; @bottom-center { content: counter(page); font: 9pt serif; } }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; color: #000; }
  .record { break-before: page; }
  .record:first-child { break-before: auto; }
  .label { margin: 0 0 .3em; font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; color: #333; }
  h1 { margin: 0 0 .6em; font-size: 1.9em; line-height: 1.15; font-weight: normal; border-bottom: 1px solid #000; padding-bottom: .25em; }
  h2 { margin: 1.1em 0 .3em; font-size: 1.05em; }
  dl { display: grid; grid-template-columns: 9em 1fr; gap: .2em 1em; margin: 0 0 .8em; }
  dt { font-weight: bold; }
  dd { margin: 0; }
  p { margin: 0 0 .6em; white-space: pre-wrap; }
  .notes { margin-top: 1em; }
`;

function recordsHtml(pages, title = 'Records') {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>${STYLE}</style></head><body>\n${pages.map(pageHtml).join('\n')}\n</body></html>\n`;
}

module.exports = { pageHtml, printable, printableMarkdown, recordsHtml };
