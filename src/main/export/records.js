'use strict';
// Records on the way out: a Markdown file for each record, and a spreadsheet for each kind. The Markdown is written the
// way it's read back in, so what leaves can come back in with its fields in place.
const fs = require('node:fs');
const path = require('node:path');
const { formatNumber, parseRecord, parseType, showValue } = require('../../shared/records');
const { toDocument } = require('../../shared/text');
const { documentMarkdown } = require('./text-formats');

const safeName = (text) => String(text).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function freeName(dir, name) {
  const { name: stem, ext } = path.parse(name);
  let candidate = path.join(dir, name);
  for (let copy = 2; fs.existsSync(candidate); copy += 1) candidate = path.join(dir, `${stem} ${copy}${ext}`);
  return candidate;
}

// A link leaves as the other record's name, because an ID means nothing outside this app.
function plain(project, field, value) {
  const names = (id) => project.getItem(id)?.title ?? '';
  return showValue(field, value, names).replace(/\n/g, ' ');
}

function recordMarkdown(project, type, item) {
  const { number, values } = parseRecord(item.details);
  const lines = [`# ${item.title}`, ''];
  if (number !== null) lines.push(`**Number:** ${formatNumber(type.numbering, number)}`);
  const long = [];
  for (const field of type.fields) {
    const value = values[field.id];
    if (value === undefined) continue;
    if (field.kind === 'longtext') long.push([field.name, value]);
    else lines.push(`**${field.name}:** ${plain(project, field, value)}`);
  }
  for (const [name, text] of long) lines.push('', `## ${name}`, '', text);
  const notes = documentMarkdown(toDocument(item.body));
  if (notes.trim()) lines.push('', notes);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function recordsCsv(project, type, rows) {
  const head = ['Name', ...(type.numbering ? ['Number'] : []), ...type.fields.map((field) => field.name), 'Notes'];
  const body = rows.map((item) => {
    const { number, values } = parseRecord(item.details);
    const notes = documentMarkdown(toDocument(item.body));
    return [item.title, ...(type.numbering ? [formatNumber(type.numbering, number)] : []), ...type.fields.map((field) => (field.kind === 'longtext' ? (values[field.id] ?? '') : plain(project, field, values[field.id]))), notes];
  });
  return `${[head, ...body].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

// Returns how many files were written.
function exportRecords(project, root) {
  let files = 0;
  const types = project.recordTypes();
  if (!types.length) return 0;
  const base = path.join(root, 'Records');
  fs.mkdirSync(base, { recursive: true });
  for (const typeItem of types) {
    const type = parseType(typeItem.details);
    const rows = project.recordRows(typeItem.id);
    const dir = path.join(base, safeName(typeItem.title));
    fs.mkdirSync(dir, { recursive: true });
    for (const item of rows) {
      const { number } = parseRecord(item.details);
      const prefix = number !== null ? `${formatNumber(type.numbering, number)} ` : '';
      fs.writeFileSync(freeName(dir, `${safeName(`${prefix}${item.title}`)}.md`), recordMarkdown(project, type, item));
      files += 1;
    }
    fs.writeFileSync(freeName(base, `${safeName(typeItem.title)}.csv`), recordsCsv(project, type, rows));
    files += 1;
  }
  return files;
}

module.exports = { exportRecords };
