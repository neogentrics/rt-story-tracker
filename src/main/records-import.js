'use strict';
// Bringing records in from files. A spreadsheet (CSV) gives one record per row. A Markdown file gives one record, with
// its name from the title and any “Label: value” lines going to the fields they're named for. Nothing is written until
// the author has seen what goes where, and it all lands in one step, so a failure leaves the project as it was.
const fs = require('node:fs');
const path = require('node:path');
const { formatNumber, isDate, parseRecord, parseType, readNumber } = require('../shared/records');
const { markdownToBlocks } = require('./import/formats');

const MAX_FILES = 2000;
const MAX_ROWS = 3000;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_LABELS = 60;
const MAX_PROBLEMS = 200;
const EXTENSIONS = { '.csv': 'csv', '.tsv': 'csv', '.md': 'markdown', '.markdown': 'markdown', '.txt': 'markdown' };

const SKIP = '@skip';
const NAME = '@name';
const NUMBER = '@number';
const NEW = '@new';

function decode(bytes) {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// A spreadsheet, as rows of cells. Quotes can hold commas and line breaks, and a doubled quote is one quote.
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[at + 1] === '\n') at += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function guessDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((mark) => [mark, first.split(mark).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

// Markdown

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const BOLD_LABEL = /^\s*(?:[-*+]\s+)?(?:\*\*|__)([^*_:\n]{1,40}?):?(?:\*\*|__):?[ \t]*(.*)$/;
const PLAIN_LABEL = /^\s*(?:[-*+]\s+)?([A-Za-z][^:\n|#*_[\]]{0,39}):[ \t]+(.+)$/;
const TABLE_LABEL = /^\|\s*([^|\n]{1,40}?)\s*\|\s*([^|\n]+?)\s*\|\s*$/;

function frontMatter(text) {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { labels: [], body: text };
  const labels = [];
  const lines = match[1].split(/\r?\n/);
  for (let at = 0; at < lines.length; at += 1) {
    const pair = /^([A-Za-z][\w .-]{0,39}):\s*(.*)$/.exec(lines[at]);
    if (!pair) continue;
    let value = pair[2].trim();
    if (!value) {
      const items = [];
      while (/^\s+-\s+/.test(lines[at + 1] ?? '')) items.push(lines[(at += 1)].replace(/^\s+-\s+/, '').trim());
      value = items.join('; ');
    }
    value = value.replace(/^\[(.*)\]$/, '$1').replace(/^["']|["']$/g, '');
    if (value) labels.push({ label: pair[1].trim(), value, line: -1 });
  }
  return { labels, body: text.slice(match[0].length) };
}

// The “Label: value” lines of a Markdown file, with where they are, so that the ones that go to fields can be taken out
// of the notes and the rest left alone.
function readMarkdown(text, file) {
  const { labels: head, body } = frontMatter(text);
  const lines = body.split(/\r?\n/);
  const labels = [...head];
  let fenced = false;
  let title = null;
  let titleLine = -1;
  lines.forEach((line, at) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    if (title === null && /^#\s+\S/.test(line)) {
      title = line.replace(/^#\s+/, '').replace(/\s*#*\s*$/, '').trim();
      titleLine = at;
      return;
    }
    if (/^\|[\s:|-]+\|?\s*$/.test(line)) return;
    const found = BOLD_LABEL.exec(line) ?? TABLE_LABEL.exec(line) ?? PLAIN_LABEL.exec(line);
    if (found && found[2].trim()) labels.push({ label: found[1].trim().replace(/\s+/g, ' '), value: found[2].trim().replace(/\s*(\*\*|__)\s*$/, ''), line: at });
  });
  const fromTitle = head.find((item) => /^(title|name)$/i.test(item.label))?.value;
  return { name: fromTitle || title || path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim(), labels, lines, titleLine, source: path.basename(file) };
}

// The notes are what's left once the lines that went to fields are out, as the editor's own document.
function notesOf(row, taken) {
  const kept = row.lines.filter((_, at) => at !== row.titleLine && !taken.has(at));
  const text = kept.join('\n').trim();
  if (!text) return '';
  const { blocks } = markdownToBlocks(text);
  const fixed = blocks.map((block) => (block.type === 'heading' ? { ...block, attrs: { ...block.attrs, level: block.attrs?.level === 1 ? 2 : Math.min(block.attrs?.level ?? 2, 3) } } : block));
  return fixed.length ? JSON.stringify({ type: 'doc', content: fixed }) : '';
}

// Turning words into values

const YES = /^(yes|y|true|1|✓|x)$/i;
const NO = /^(no|n|false|0)$/i;

function cleanLinkName(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\(https?:\/\/[^)]*\)/g, '')
    .replace(/^\[\[|\]\]$/g, '')
    .trim();
}

function toDate(text) {
  if (isDate(text)) return text;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash && Number(slash[1]) > 12) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
  const parsed = new Date(`${text} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  const made = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
  return isDate(made) && parsed.getUTCFullYear() > 999 ? made : null;
}

function splitList(text) {
  return text.split(/\s*[;|]\s*|\s*,\s+(?=[A-Z0-9“"'‘])|\s*,\s*$/).map((part) => part.trim()).filter(Boolean);
}

// The kind a new field should have, judged from what's in its column. Anything doubtful stays plain text.
function guessKind(values) {
  const filled = values.filter((value) => value !== '');
  if (!filled.length) return 'text';
  if (filled.every((value) => /^-?\d+(\.\d+)?$/.test(value))) return 'number';
  if (filled.every((value) => isDate(value))) return 'date';
  if (filled.every((value) => YES.test(value) || NO.test(value)) && filled.some((value) => /^(yes|no|true|false)$/i.test(value))) return 'yesno';
  if (filled.some((value) => value.length > 160 || value.includes('\n'))) return 'longtext';
  return 'text';
}

class RecordImporter {
  constructor() {
    this.files = [];
    this.kind = null;
    this.rows = null;
    this.headers = [];
  }

  // Every spreadsheet or Markdown file in a folder and the folders inside it, in name order. Hidden folders are left alone.
  loadFolder(dir) {
    const found = [];
    const walk = (folder, depth) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory() && depth < 6) walk(full, depth + 1);
        else if (entry.isFile() && EXTENSIONS[path.extname(entry.name).toLowerCase()] && found.length <= MAX_FILES) found.push(full);
      }
    };
    walk(dir, 0);
    if (!found.length) throw new Error('There are no spreadsheets or Markdown files in that folder.');
    return this.load(found);
  }

  // Reads the chosen files into rows. A mix of spreadsheets and Markdown isn't one import.
  load(paths) {
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('Choose some files first.');
    if (paths.length > MAX_FILES) throw new Error(`That's more than ${MAX_FILES} files. Bring them in a folder at a time.`);
    const kinds = new Set(paths.map((file) => EXTENSIONS[path.extname(file).toLowerCase()]));
    if (kinds.has(undefined)) throw new Error('Records come from spreadsheets (CSV) or Markdown files.');
    if (kinds.size > 1) throw new Error('Choose spreadsheets or Markdown files, not both at once.');
    [this.kind] = kinds;
    const rows = [];
    let headers = [];
    for (const file of paths) {
      const stat = fs.statSync(file);
      if (stat.size > MAX_BYTES) throw new Error(`“${path.basename(file)}” is too large to bring in.`);
      const text = decode(fs.readFileSync(file));
      if (this.kind === 'markdown') {
        rows.push(readMarkdown(text, file));
      } else {
        const table = parseCsv(text, path.extname(file).toLowerCase() === '.tsv' ? '\t' : guessDelimiter(text));
        if (table.length < 2) continue;
        const [head, ...body] = table;
        const names = head.map((cell, at) => cell.trim() || `Column ${at + 1}`);
        if (!headers.length) headers = names;
        for (const cells of body) {
          const labels = names.map((label, at) => ({ label, value: (cells[at] ?? '').trim(), line: -1 }));
          rows.push({ name: '', labels, lines: [], titleLine: -1, source: path.basename(file) });
        }
      }
      if (rows.length > MAX_ROWS) throw new Error(`That's more than ${MAX_ROWS} records. Bring them in a few files at a time.`);
    }
    if (!rows.length) throw new Error('There was nothing to bring in. A spreadsheet needs a row of headings and at least one more row.');
    this.files = paths.map((file) => path.basename(file));
    this.rows = rows;
    this.headers = headers;
    return { kind: this.kind, files: this.files.length, rows: rows.length, names: this.files.slice(0, 5) };
  }

  // Every label found, how often, and a few examples, so the author can say where each one goes.
  columns() {
    const found = new Map();
    for (const row of this.rows) {
      for (const { label, value } of row.labels) {
        const key = label.toLowerCase();
        const entry = found.get(key) ?? { label, count: 0, samples: [], values: [] };
        if (value !== '') {
          entry.count += 1;
          if (entry.samples.length < 3 && !entry.samples.includes(value)) entry.samples.push(value.slice(0, 120));
        }
        if (entry.values.length < 200) entry.values.push(value);
        found.set(key, entry);
      }
    }
    const ordered = this.kind === 'csv' ? this.headers.map((label) => found.get(label.toLowerCase())).filter(Boolean) : [...found.values()].sort((a, b) => b.count - a.count);
    return ordered.slice(0, MAX_LABELS);
  }

  // Where each label would go, going by names: Name and Title to the name, a field with the same name to that field.
  suggest(typeItem) {
    const type = typeItem ? parseType(typeItem.details) : { fields: [], numbering: null };
    const columns = this.columns();
    let nameTaken = false;
    return columns.map((column) => {
      const lower = column.label.toLowerCase();
      let target = type.fields.find((field) => field.name.toLowerCase() === lower)?.id ?? null;
      if (!target && /^(name|title)$/.test(lower) && !nameTaken) target = NAME;
      if (!target && type.numbering && /^(number|no\.?|id|#)$/.test(lower)) target = NUMBER;
      if (target === NAME) nameTaken = true;
      if (!target) target = typeItem ? SKIP : NEW;
      return { label: column.label, count: column.count, samples: column.samples, kind: guessKind(column.values), target };
    });
  }


  // What a typed value becomes for a field, or why it can't.
  convert(field, raw) {
    const value = raw.trim();
    if (value === '') return { value: undefined };
    switch (field.kind) {
      case 'number': {
        const number = Number(value.replace(/[,\s$£€]/g, ''));
        return Number.isFinite(number) ? { value: number } : { problem: `“${value.slice(0, 40)}” isn’t a number, so ${field.name} was left empty.` };
      }
      case 'date': {
        const date = toDate(value);
        return date ? { value: date } : { problem: `“${value.slice(0, 40)}” isn’t a date I can read, so ${field.name} was left empty.` };
      }
      case 'yesno':
        if (YES.test(value)) return { value: true };
        if (NO.test(value)) return { value: false };
        return { problem: `“${value.slice(0, 40)}” isn’t yes or no, so ${field.name} was left empty.` };
      case 'choice':
        return { value: field.many ? splitList(value) : value };
      case 'link':
        return { links: splitList(value).map(cleanLinkName).filter(Boolean) };
      default:
        return { value };
    }
  }

  // Makes the fields for labels sent to a new field, and adds choices the type doesn't have yet. Returns the fields to use.
  prepareType(records, { typeItem, newTypeName, mapping }) {
    const taken = new Set((typeItem ? parseType(typeItem.details).fields : []).map((field) => field.name.toLowerCase()));
    const columns = this.columns();
    const made = [];
    const fresh = mapping.filter((entry) => entry.target === NEW).map((entry) => {
      let name = entry.label.slice(0, 200);
      for (let copy = 2; taken.has(name.toLowerCase()); copy += 1) name = `${entry.label.slice(0, 190)} ${copy}`;
      taken.add(name.toLowerCase());
      const kind = guessKind(columns.find((column) => column.label.toLowerCase() === entry.label.toLowerCase())?.values ?? []);
      made.push(name);
      return { entry, field: { name, kind } };
    });
    let type = typeItem ? records.typeView(typeItem) : null;
    if (!type) {
      type = records.createType({ title: newTypeName, fields: fresh.map((item) => item.field), numbering: null });
    } else if (fresh.length) {
      type = records.saveType({ id: type.id, fields: [...type.fields, ...fresh.map((item) => item.field)] });
    }
    const typeId = type.id;
    const assigned = new Map();
    fresh.forEach(({ entry, field }) => {
      assigned.set(entry.label.toLowerCase(), type.fields.find((candidate) => candidate.name === field.name)?.id);
    });
    // Words in a choice column that aren't choices yet become choices.
    const wanted = new Map();
    for (const entry of mapping) {
      const id = assigned.get(entry.label.toLowerCase()) ?? entry.target;
      const field = type.fields.find((candidate) => candidate.id === id);
      if (field?.kind !== 'choice') continue;
      const have = new Set(field.options.map((option) => option.toLowerCase()));
      for (const row of this.rows) {
        const raw = row.labels.find((item) => item.label.toLowerCase() === entry.label.toLowerCase())?.value ?? '';
        for (const word of field.many ? splitList(raw) : [raw.trim()]) {
          if (word && !have.has(word.toLowerCase())) {
            have.add(word.toLowerCase());
            wanted.set(field.id, [...(wanted.get(field.id) ?? []), word]);
          }
        }
      }
    }
    if (wanted.size) {
      type = records.saveType({ id: typeId, fields: type.fields.map((field) => (wanted.has(field.id) ? { ...field, options: [...field.options, ...wanted.get(field.id)] } : field)) });
    }
    return { type, assigned, made, typeId };
  }

  run(records, { typeId, newTypeName, mapping, duplicates = 'skip' }) {
    if (!this.rows) throw new Error('Choose some files first.');
    if (!Array.isArray(mapping)) throw new Error('Say where each column goes first.');
    if (!['skip', 'update'].includes(duplicates)) throw new Error('Say what to do about a name that’s already there.');
    const typeItem = typeId ? records.typeItem(typeId) : null;
    const typeName = typeof newTypeName === 'string' ? newTypeName.trim() : '';
    if (!typeItem && !typeName) throw new Error('Give the new kind of record a name.');
    const known = new Map(this.columns().map((column) => [column.label.toLowerCase(), column]));
    const clean = mapping.filter((entry) => entry && known.has(String(entry.label).toLowerCase()) && typeof entry.target === 'string' && entry.target !== SKIP);
    if (this.kind === 'csv' && clean.filter((entry) => entry.target === NAME).length !== 1) throw new Error('Choose which column is the name.');
    const fieldIds = new Set(typeItem ? parseType(typeItem.details).fields.map((field) => field.id) : []);
    for (const entry of clean) {
      if (![NAME, NUMBER, NEW].includes(entry.target) && !fieldIds.has(entry.target)) throw new Error(`“${entry.label}” is going to a field that isn’t there.`);
    }
    const project = records.project;
    project.backupTo(path.join(path.dirname(project.file), 'backups', 'before-records-import.db'));
    return project.db.transaction(() => this.write(records, { typeItem, newTypeName: typeName, mapping: clean, duplicates }))();
  }

  write(records, { typeItem, newTypeName, mapping, duplicates }) {
    const { type, assigned, made, typeId } = this.prepareType(records, { typeItem, newTypeName, mapping });
    const typeRow = records.typeItem(typeId);
    const numbering = parseType(typeRow.details).numbering;
    const byLabel = new Map(mapping.map((entry) => [entry.label.toLowerCase(), assigned.get(entry.label.toLowerCase()) ?? entry.target]));
    const fieldById = new Map(type.fields.map((field) => [field.id, field]));
    const result = { created: 0, updated: 0, skipped: 0, problems: [], moreProblems: 0, typeId, newFields: made };
    const problem = (where, message) => {
      if (result.problems.length < MAX_PROBLEMS) result.problems.push({ where, message });
      else result.moreProblems += 1;
    };
    const used = new Map([...records.usedNumbers(typeId)].map(([number, row]) => [number, row.title]));
    const names = new Map(records.project.recordRows(typeId).map((row) => [row.title.toLowerCase(), row.id]));
    const planned = [];

    this.rows.forEach((row, at) => {
      const where = this.kind === 'csv' ? `Row ${at + 2}` : row.source;
      const values = {};
      const links = {};
      const taken = new Set();
      let name = this.kind === 'markdown' ? row.name : '';
      let number;
      let numberTold = false;
      for (const { label, value, line } of row.labels) {
        const target = byLabel.get(label.toLowerCase());
        if (!target) continue;
        if (line >= 0) taken.add(line);
        if (target === NAME) {
          if (value.trim()) name = value.trim();
        } else if (target === NUMBER) {
          const wanted = readNumber(numbering, value);
          if (value.trim() && wanted === null) problem(where, `“${value.slice(0, 40)}” isn’t a number here, so it got the next free one.`);
          else if (wanted !== null) {
            numberTold = true;
            number = wanted;
          }
        } else if (fieldById.has(target)) {
          const field = fieldById.get(target);
          if (field.id in values || field.id in links) continue;
          const made = this.convert(field, value);
          if (made.problem) problem(where, made.problem);
          else if (made.links) links[field.id] = made.links;
          else if (made.value !== undefined) values[field.id] = made.value;
        }
      }
      if (!name) {
        problem(where, 'It has no name, so it was left out.');
        result.skipped += 1;
        return;
      }
      const existing = names.get(name.toLowerCase());
      if (existing && duplicates === 'skip') {
        result.skipped += 1;
        return;
      }
      const notes = this.kind === 'markdown' ? notesOf(row, taken) : '';
      if (numberTold && !existing && used.has(number)) {
        problem(where, `${formatNumber(numbering, number)} is already used by “${used.get(number)}”, so “${name}” got the next free number.`);
        numberTold = false;
      }
      if (existing) {
        const kept = parseRecord(records.recordItem(existing).details);
        if (kept.locked) {
          problem(where, `“${name}” is under canon lock, so it was left alone.`);
          result.skipped += 1;
          return;
        }
        const current = kept.values;
        const saved = records.save({ id: existing, values: { ...current, ...values }, ...(notes ? { notes } : {}) });
        planned.push({ id: saved.id, name, values: { ...current, ...values }, links });
        result.updated += 1;
        return;
      }
      const made = records.create({ typeId, title: name, ...(numberTold ? { number } : {}), values, ...(notes ? { notes } : {}) });
      if (made.number !== null) used.set(made.number, made.title);
      names.set(name.toLowerCase(), made.id);
      planned.push({ id: made.id, name, values, links, where });
      result.created += 1;
    });

    // Links are made last, so a link can point at a record from the same files.
    for (const item of planned) {
      const fields = Object.keys(item.links);
      if (!fields.length) continue;
      const values = { ...item.values };
      for (const fieldId of fields) {
        const field = fieldById.get(fieldId);
        const pool = field.to ? records.project.recordRows(field.to) : records.project.recordTypes().flatMap((typeRowItem) => records.project.recordRows(typeRowItem.id));
        const byName = new Map(pool.map((row) => [row.title.toLowerCase(), row.id]));
        const ids = [];
        for (const wanted of item.links[fieldId]) {
          const id = byName.get(wanted.toLowerCase());
          if (id && id !== item.id) ids.push(id);
          else if (!id) problem(item.where ?? item.name, `${field.name}: “${wanted.slice(0, 40)}” isn’t a record yet, so it wasn’t linked.`);
        }
        if (ids.length) values[fieldId] = field.many ? ids : ids.slice(0, 1);
      }
      records.save({ id: item.id, values });
    }
    return result;
  }

  preview(typeItem) {
    return {
      kind: this.kind,
      files: this.files.length,
      rows: this.rows.length,
      columns: this.suggest(typeItem),
      firstRows: this.kind === 'csv' ? this.rows.slice(0, 3).map((row) => row.labels.slice(0, 8).map((item) => item.value.slice(0, 60))) : [],
    };
  }
}

module.exports = { EXTENSIONS, NAME, NEW, NUMBER, RecordImporter, SKIP, cleanLinkName, guessKind, parseCsv, readMarkdown, splitList, toDate };
