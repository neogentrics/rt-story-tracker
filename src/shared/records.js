'use strict';
// What a record type and a record are made of, shared by the main process (which checks everything that comes in) and
// the window (which filters and sorts what it has), so the two can't disagree.
//
// A record type is an item whose `details` hold its fields, numbering and saved views. A record is an item under it:
// its title is its name, its `body` is its notes, and its `details` hold the numbered place and the field values.

const FIELD_KINDS = ['text', 'longtext', 'number', 'choice', 'date', 'link', 'yesno'];
const KIND_LABELS = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  choice: 'Choice',
  date: 'Date',
  link: 'Link to records',
  yesno: 'Yes or no',
};

const LIMITS = {
  fields: 60,
  options: 60,
  views: 30,
  ranges: 40,
  filters: 12,
  name: 200,
  text: 2000,
  longtext: 100000,
  links: 300,
  number: 99999999,
  prefix: 12,
};

// Every kind of field says which tests make sense for it. `value` is what the author types, when the test needs one.
const FILTER_TESTS = {
  text: ['contains', 'is', 'not', 'filled', 'empty'],
  longtext: ['contains', 'filled', 'empty'],
  number: ['is', 'not', 'more', 'less', 'filled', 'empty'],
  choice: ['is', 'not', 'filled', 'empty'],
  date: ['is', 'before', 'after', 'filled', 'empty'],
  link: ['has', 'filled', 'empty'],
  yesno: ['yes', 'no'],
};
const TEST_LABELS = {
  contains: 'contains',
  is: 'is',
  not: 'is not',
  more: 'is more than',
  less: 'is less than',
  before: 'is before',
  after: 'is after',
  has: 'includes',
  filled: 'is filled in',
  empty: 'is empty',
  yes: 'is yes',
  no: 'is no',
};
const NEEDS_VALUE = new Set(['contains', 'is', 'not', 'more', 'less', 'before', 'after', 'has']);

// The things every record has, which a view can use as if they were fields.
const BUILT_IN = [
  { id: '@name', name: 'Name', kind: 'text' },
  { id: '@number', name: 'Number', kind: 'number' },
  { id: '@updated', name: 'Last changed', kind: 'date' },
];

const randomId = (prefix) => `${prefix}${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

function text(value, limit, what) {
  if (typeof value !== 'string') throw new Error(`${what} has to be text.`);
  return value.trim().slice(0, limit);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const real = new Date(Date.UTC(year, month - 1, day));
  return real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === day;
}

function cleanNumber(value, what) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`${what} has to be a number.`);
  if (Math.abs(number) > 1e15) throw new Error(`${what} is too large.`);
  return number;
}

function cleanOptions(options) {
  if (options === undefined) return [];
  if (!Array.isArray(options)) throw new Error('Choices have to be a list.');
  const seen = new Set();
  const clean = [];
  for (const option of options) {
    const value = text(option, LIMITS.name, 'A choice');
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    clean.push(value);
  }
  if (clean.length > LIMITS.options) throw new Error(`A field can have up to ${LIMITS.options} choices.`);
  return clean;
}

function cleanField(input, at) {
  if (!input || typeof input !== 'object') throw new Error('A field is missing.');
  const kind = FIELD_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw new Error(`“${String(input.name ?? '')}” needs a kind of field.`);
  const name = text(input.name ?? '', LIMITS.name, 'A field name');
  if (!name) throw new Error(`Field ${at + 1} needs a name.`);
  const field = { id: typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(input.id) ? input.id : randomId('f'), name, kind };
  if (kind === 'choice') {
    field.options = cleanOptions(input.options);
    if (input.many) field.many = true;
  }
  if (kind === 'link') {
    if (typeof input.to === 'string' && input.to) field.to = input.to;
    if (input.many !== false) field.many = true;
  }
  return field;
}

function cleanRanges(ranges) {
  if (ranges === undefined) return [];
  if (!Array.isArray(ranges) || ranges.length > LIMITS.ranges) throw new Error('Those number ranges can’t be saved.');
  return ranges.map((range) => {
    const from = Number(range?.from);
    const to = Number(range?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > LIMITS.number || to < from) {
      throw new Error('A number range needs a first and a last number, with the first not above the last.');
    }
    const name = text(range.name ?? '', LIMITS.name, 'A range name');
    if (!name) throw new Error('A number range needs a name, such as the series it belongs to.');
    return { id: typeof range.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(range.id) ? range.id : randomId('r'), name, from, to };
  });
}

function cleanNumbering(input) {
  if (!input) return null;
  const prefix = text(input.prefix ?? '', LIMITS.prefix, 'A prefix');
  const digits = input.digits === undefined ? 3 : Number(input.digits);
  if (!Number.isInteger(digits) || digits < 1 || digits > 8) throw new Error('Numbers can have 1 to 8 digits.');
  return { prefix, digits, ranges: cleanRanges(input.ranges) };
}

function cleanFilter(input, fields) {
  const known = [...BUILT_IN, ...fields].find((field) => field.id === input?.field);
  if (!known) throw new Error('A filter points at a field that isn’t there.');
  const test = input.test;
  if (!FILTER_TESTS[known.kind].includes(test)) throw new Error(`“${known.name}” can’t be filtered that way.`);
  const filter = { field: known.id, test };
  if (NEEDS_VALUE.has(test)) {
    filter.value = typeof input.value === 'string' || typeof input.value === 'number' ? String(input.value).slice(0, LIMITS.text) : '';
  }
  return filter;
}

function cleanView(input, fields) {
  if (!input || typeof input !== 'object') throw new Error('A view is missing.');
  const name = text(input.name ?? '', LIMITS.name, 'A view name');
  if (!name) throw new Error('A view needs a name.');
  const columns = (Array.isArray(input.columns) ? input.columns : []).filter((id) => fields.some((field) => field.id === id));
  const sortField = input.sort?.field;
  const sortable = [...BUILT_IN, ...fields].some((field) => field.id === sortField);
  return {
    id: typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(input.id) ? input.id : randomId('v'),
    name,
    mode: input.mode === 'cards' ? 'cards' : 'table',
    filters: (Array.isArray(input.filters) ? input.filters : []).slice(0, LIMITS.filters).map((filter) => cleanFilter(filter, fields)),
    sort: sortable ? { field: sortField, direction: input.sort.direction === 'down' ? 'down' : 'up' } : { field: '@name', direction: 'up' },
    columns,
  };
}

// What a record type keeps in its details. Anything unknown is dropped, so a type can't be filled with other things.
function cleanType(input) {
  if (!input || typeof input !== 'object') throw new Error('That record type can’t be saved.');
  const fields = (Array.isArray(input.fields) ? input.fields : []).map(cleanField);
  if (fields.length > LIMITS.fields) throw new Error(`A record type can have up to ${LIMITS.fields} fields.`);
  const names = new Set();
  for (const field of fields) {
    if (names.has(field.name.toLowerCase())) throw new Error(`Two fields are called “${field.name}”.`);
    names.add(field.name.toLowerCase());
  }
  const ids = new Set(fields.map((field) => field.id));
  if (ids.size !== fields.length) throw new Error('Two fields share an ID.');
  const views = (Array.isArray(input.views) ? input.views : []).map((view) => cleanView(view, fields));
  if (views.length > LIMITS.views) throw new Error(`A record type can have up to ${LIMITS.views} saved views.`);
  return { fields, numbering: cleanNumbering(input.numbering), views };
}

function parseType(details) {
  try {
    const parsed = JSON.parse(details);
    return { fields: parsed.fields ?? [], numbering: parsed.numbering ?? null, views: parsed.views ?? [] };
  } catch {
    return { fields: [], numbering: null, views: [] };
  }
}

function parseRecord(details) {
  try {
    const parsed = JSON.parse(details);
    return { number: Number.isInteger(parsed.number) ? parsed.number : null, values: parsed.values ?? {} };
  } catch {
    return { number: null, values: {} };
  }
}

const isEmpty = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

// A value that has been checked against its field, or nothing when it's empty. Links are only checked for shape here:
// whether the records exist is for the project to say.
function cleanValue(field, value) {
  if (isEmpty(value)) return undefined;
  switch (field.kind) {
    case 'text':
      return text(value, LIMITS.text, field.name) || undefined;
    case 'longtext':
      return text(value, LIMITS.longtext, field.name) || undefined;
    case 'number':
      return cleanNumber(value, field.name);
    case 'date':
      if (!isDate(value)) throw new Error(`${field.name} has to be a date.`);
      return value;
    case 'yesno':
      if (typeof value !== 'boolean') throw new Error(`${field.name} has to be yes or no.`);
      return value;
    case 'choice': {
      const picked = (Array.isArray(value) ? value : [value]).map((item) => text(item, LIMITS.name, field.name)).filter(Boolean);
      const unique = [...new Set(picked)];
      if (!unique.length) return undefined;
      if (!field.many) return unique[0];
      return unique;
    }
    case 'link': {
      const ids = (Array.isArray(value) ? value : [value]).filter((id) => typeof id === 'string' && id);
      const unique = [...new Set(ids)];
      if (unique.length > LIMITS.links) throw new Error(`${field.name} can link up to ${LIMITS.links} records.`);
      if (!field.many && unique.length > 1) throw new Error(`${field.name} links to one record.`);
      return unique.length ? unique : undefined;
    }
    default:
      return undefined;
  }
}

function cleanValues(type, values) {
  if (values === undefined || values === null) return {};
  if (typeof values !== 'object' || Array.isArray(values)) throw new Error('Those values can’t be saved.');
  const clean = {};
  for (const field of type.fields) {
    const value = cleanValue(field, values[field.id]);
    if (value !== undefined) clean[field.id] = value;
  }
  return clean;
}

function cleanNumberOf(value) {
  if (isEmpty(value)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > LIMITS.number) throw new Error('A record number is a whole number from 0 up.');
  return number;
}

// Numbering

function formatNumber(numbering, number) {
  if (number === null || number === undefined) return '';
  return `${numbering?.prefix ?? ''}${String(number).padStart(numbering?.digits ?? 3, '0')}`;
}

// “W-007”, “w-7” or “7” all mean 7. A different prefix doesn't.
function readNumber(numbering, typed) {
  const wanted = String(typed ?? '').trim();
  if (!wanted) return null;
  const prefix = numbering?.prefix ?? '';
  const rest = prefix && wanted.toLowerCase().startsWith(prefix.toLowerCase()) ? wanted.slice(prefix.length) : wanted;
  return /^\d{1,8}$/.test(rest.trim()) ? Number(rest.trim()) : null;
}

// The lowest number nobody has, inside the chosen range if there is one.
function nextFreeNumber(numbering, used, rangeId = null) {
  const range = numbering?.ranges?.find((item) => item.id === rangeId);
  const from = range?.from ?? 1;
  const to = range?.to ?? LIMITS.number;
  for (let number = from; number <= to; number += 1) if (!used.has(number)) return number;
  return null;
}

function rangeOf(numbering, number) {
  return numbering?.ranges?.find((range) => number >= range.from && number <= range.to) ?? null;
}

// Showing and filtering

function fieldsFor(type) {
  return [...BUILT_IN, ...type.fields];
}

function rawValue(record, field) {
  if (field.id === '@name') return record.title;
  if (field.id === '@number') return record.number;
  if (field.id === '@updated') return record.updatedAt?.slice(0, 10) ?? '';
  return record.values[field.id];
}

// What a value looks like in a table cell or on a card. Links need the other records' names.
function showValue(field, value, titleOf = () => '') {
  if (isEmpty(value)) return '';
  if (field.kind === 'yesno') return value ? 'Yes' : 'No';
  if (field.kind === 'link') return value.map((id) => titleOf(id)).filter(Boolean).join(', ');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function passes(filter, record, type) {
  const field = fieldsFor(type).find((item) => item.id === filter.field);
  if (!field) return true;
  const value = rawValue(record, field);
  const wanted = filter.value ?? '';
  const list = Array.isArray(value) ? value : [value];
  switch (filter.test) {
    case 'filled':
      return !isEmpty(value);
    case 'empty':
      return isEmpty(value);
    case 'yes':
      return value === true;
    case 'no':
      return value !== true;
    case 'has':
      return list.includes(wanted);
    case 'contains':
      return list.some((item) => String(item ?? '').toLowerCase().includes(String(wanted).toLowerCase()));
    case 'is':
      if (field.kind === 'number') return !isEmpty(value) && Number(value) === Number(wanted);
      return list.some((item) => String(item ?? '').toLowerCase() === String(wanted).toLowerCase());
    case 'not':
      if (field.kind === 'number') return isEmpty(value) || Number(value) !== Number(wanted);
      return !list.some((item) => String(item ?? '').toLowerCase() === String(wanted).toLowerCase());
    case 'more':
      return !isEmpty(value) && Number(value) > Number(wanted);
    case 'less':
      return !isEmpty(value) && Number(value) < Number(wanted);
    case 'before':
      return !isEmpty(value) && String(value) < wanted;
    case 'after':
      return !isEmpty(value) && String(value) > wanted;
    default:
      return true;
  }
}

function compare(field, a, b, titleOf) {
  const empty = [isEmpty(a), isEmpty(b)];
  if (empty[0] || empty[1]) return Number(empty[0]) - Number(empty[1]);
  if (field.kind === 'number') return Number(a) - Number(b);
  if (field.kind === 'yesno') return Number(Boolean(a)) - Number(Boolean(b));
  return showValue(field, a, titleOf).localeCompare(showValue(field, b, titleOf), undefined, { numeric: true, sensitivity: 'base' });
}

// A view's records, in order. Empty values always come last, whichever way it sorts.
function applyView(view, records, type, titleOf = () => '') {
  const filters = view?.filters ?? [];
  const found = records.filter((record) => filters.every((filter) => passes(filter, record, type)));
  const field = fieldsFor(type).find((item) => item.id === (view?.sort?.field ?? '@name')) ?? BUILT_IN[0];
  const sign = view?.sort?.direction === 'down' ? -1 : 1;
  return found.sort((a, b) => {
    const x = rawValue(a, field);
    const y = rawValue(b, field);
    if (isEmpty(x) || isEmpty(y)) return compare(field, x, y, titleOf);
    return sign * compare(field, x, y, titleOf) || a.title.localeCompare(b.title);
  });
}

// For the quick filter above a list, and for looking something up while writing: the name, number and every value.
function matches(query, record, type, titleOf = () => '') {
  const wanted = String(query ?? '').trim().toLowerCase();
  if (!wanted) return true;
  const label = type?.numbering ? formatNumber(type.numbering, record.number) : '';
  const haystack = [record.title, label, ...type.fields.map((field) => showValue(field, record.values[field.id], titleOf))];
  return haystack.some((part) => String(part).toLowerCase().includes(wanted));
}

module.exports = {
  BUILT_IN,
  FIELD_KINDS,
  FILTER_TESTS,
  KIND_LABELS,
  LIMITS,
  NEEDS_VALUE,
  TEST_LABELS,
  applyView,
  cleanNumberOf,
  cleanType,
  cleanValues,
  cleanView,
  fieldsFor,
  formatNumber,
  isDate,
  matches,
  nextFreeNumber,
  parseRecord,
  parseType,
  rangeOf,
  rawValue,
  readNumber,
  showValue,
};
