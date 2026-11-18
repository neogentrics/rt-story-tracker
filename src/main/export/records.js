'use strict';
// Records on the way out: a Markdown file for each record, and a spreadsheet for each kind. The Markdown is written the
// way it's read back in, so what leaves can come back in with its fields in place.
//
// What leaves is the printable part and nothing else. A kind that keeps versions has an author-only part, in fields marked
// for the author and in the author's own notes, and none of it is written here. It stays in the project and in its backups
// and .rtstory copies, which are the author's own. Everything goes through printable(), the one place that decides.
const fs = require('node:fs');
const path = require('node:path');
const { audienceOf, formatNumber, parseRecord, parseType, showValue } = require('../../shared/records');
const { printable, printableMarkdown } = require('./printable');
const { documentMarkdown } = require('./text-formats');
const { toDocument } = require('../../shared/text');

const safeName = (text) => String(text).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function freeName(dir, name) {
  const { name: stem, ext } = path.parse(name);
  let candidate = path.join(dir, name);
  for (let copy = 2; fs.existsSync(candidate); copy += 1) candidate = path.join(dir, `${stem} ${copy}${ext}`);
  return candidate;
}

function parseVersion(item) {
  try {
    return { ...JSON.parse(item.details), body: item.body };
  } catch {
    return null;
  }
}

function recordsCsv(project, type, rows, names) {
  const shown = type.fields.filter((field) => audienceOf(type, field) === 'print');
  const head = ['Name', ...(type.numbering ? ['Number'] : []), ...shown.map((field) => field.name), 'Notes'];
  const body = rows.map((item) => {
    const { number, values, printNotes } = parseRecord(item.details);
    const notes = documentMarkdown(toDocument(type.versioning ? printNotes : item.body));
    return [
      item.title,
      ...(type.numbering ? [formatNumber(type.numbering, number)] : []),
      ...shown.map((field) => (field.kind === 'longtext' ? (values[field.id] ?? '') : showValue(field, values[field.id], names).replace(/\n/g, ' '))),
      notes,
    ];
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
  const names = (id) => project.getItem(id)?.title ?? '';
  for (const typeItem of types) {
    const type = parseType(typeItem.details);
    const rows = project.recordRows(typeItem.id);
    const dir = path.join(base, safeName(typeItem.title));
    fs.mkdirSync(dir, { recursive: true });
    for (const item of rows) {
      const { number, values, printNotes } = parseRecord(item.details);
      const label = formatNumber(type.numbering, number);
      const prefix = label ? `${label} ` : '';
      const versions = project.versionRows(item.id).map(parseVersion).filter(Boolean);
      const page = printable(type, { title: item.title, number, values, printNotes, authorNotes: item.body, revision: (versions.at(-1)?.number ?? 0) + 1, draft: type.versioning }, { names });
      fs.writeFileSync(freeName(dir, `${safeName(`${prefix}${item.title}`)}.md`), printableMarkdown(page, label));
      files += 1;
      for (const version of versions) {
        const shown = printable(type, {
          title: version.title,
          number: version.recordNumber,
          values: version.values,
          printNotes: version.printNotes,
          authorNotes: version.body,
          fields: version.fields,
          versioning: true,
          revision: version.number,
          changes: version.changes,
        }, { names });
        fs.writeFileSync(freeName(dir, `${safeName(`${prefix}${version.title} v${version.number}`)}.md`), printableMarkdown(shown, formatNumber(type.numbering, version.recordNumber)));
        files += 1;
      }
    }
    fs.writeFileSync(freeName(base, `${safeName(typeItem.title)}.csv`), recordsCsv(project, type, rows, names));
    files += 1;
  }
  return files;
}

module.exports = { exportRecords };
