'use strict';
// Record types and records, as the window asks for them. Everything from the window is checked here.
const {
  applyView,
  cleanNumberOf,
  cleanType,
  cleanValues,
  formatNumber,
  matches,
  nextFreeNumber,
  parseRecord,
  parseType,
} = require('../shared/records');
const { TEMPLATES } = require('../shared/templates');
const { parseDocument } = require('../shared/text');

const MAX_NAME = 500;
const MAX_NOTES = 8 * 1024 * 1024;
const MAX_FOUND = 30;

function needId(id) {
  if (typeof id !== 'string' || !id) throw new Error('That record is missing.');
  return id;
}

function cleanName(title, fallback) {
  if (title === undefined) return fallback;
  if (typeof title !== 'string') throw new Error('A name has to be text.');
  return title.trim().slice(0, MAX_NAME) || fallback;
}

class Records {
  constructor(workspace) {
    this.workspace = workspace;
  }

  get project() {
    return this.workspace.open();
  }

  typeItem(id) {
    const item = this.project.getItem(needId(id));
    if (item?.kind !== 'recordtype') throw new Error("That isn't a record type.");
    return item;
  }

  recordItem(id) {
    const item = this.project.getItem(needId(id));
    if (item?.kind !== 'record') throw new Error("That isn't a record.");
    return item;
  }

  typeView(item) {
    const type = parseType(item.details);
    return { id: item.id, title: item.title, ...type, count: this.project.recordCount(item.id) };
  }

  // Link values only keep records that still exist. A record in the Trash is kept, because it may come back.
  recordView(item, type) {
    const { number, values } = parseRecord(item.details);
    const shown = {};
    for (const field of type.fields) {
      let value = values[field.id];
      if (field.kind === 'link' && Array.isArray(value)) value = value.filter((id) => this.project.getItem(id)?.kind === 'record');
      if (value !== undefined && !(Array.isArray(value) && value.length === 0)) shown[field.id] = value;
    }
    return {
      id: item.id,
      typeId: item.parentId,
      title: item.title,
      number,
      label: formatNumber(type.numbering, number),
      values: shown,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  // Name and type for each record that others link to, so a link can show who it is and say if it's in the Trash.
  targetsOf(type, records) {
    const targets = {};
    const linkFields = type.fields.filter((field) => field.kind === 'link');
    for (const record of records) {
      for (const field of linkFields) {
        for (const id of record.values[field.id] ?? []) {
          if (targets[id]) continue;
          const item = this.project.getItem(id);
          const parent = item && this.project.getItem(item.parentId);
          if (!item || !parent) continue;
          targets[id] = { title: item.title, typeId: parent.id, typeTitle: parent.title, trashed: this.project.isHidden(id) };
        }
      }
    }
    return targets;
  }

  overview() {
    return { types: this.project.recordTypes().map((item) => this.typeView(item)) };
  }

  list(typeId) {
    const item = this.typeItem(typeId);
    const type = parseType(item.details);
    const records = this.project.recordRows(item.id).map((row) => this.recordView(row, type));
    return { type: this.typeView(item), records, targets: this.targetsOf(type, records) };
  }

  get(id) {
    const item = this.recordItem(id);
    const typeItem = this.project.getItem(item.parentId);
    const type = parseType(typeItem.details);
    const record = this.recordView(item, type);
    return {
      type: this.typeView(typeItem),
      record,
      notes: item.body,
      targets: this.targetsOf(type, [record]),
      backlinks: this.backlinks(id),
    };
  }

  // Who points at this record: other records through a link field, and chapters or notes through an @.
  backlinks(id) {
    return this.project.linksTo(needId(id)).map(({ item, via }) => {
      if (item.kind === 'record') {
        const typeItem = this.project.getItem(item.parentId);
        const field = parseType(typeItem.details).fields.find((candidate) => candidate.id === via);
        return {
          kind: 'record',
          id: item.id,
          title: item.title,
          context: typeItem.title,
          via: field?.name ?? null,
          typeId: typeItem.id,
        };
      }
      const book = this.project.ancestor(item.id, 'book');
      return { kind: 'chapter', id: item.id, title: item.title, context: book?.title ?? '', via: null, bookId: book?.id ?? null };
    });
  }

  // Checks that every link points at a record that exists, and at the right type if the field names one.
  checkLinks(type, values, ownId) {
    for (const field of type.fields) {
      if (field.kind !== 'link' || !values[field.id]) continue;
      const kept = [];
      for (const id of values[field.id]) {
        if (id === ownId) throw new Error("A record can't link to itself.");
        const target = this.project.getItem(id);
        if (target?.kind !== 'record') continue;
        if (field.to && target.parentId !== field.to) throw new Error(`${field.name} links to a different kind of record.`);
        kept.push(id);
      }
      if (kept.length) values[field.id] = kept;
      else delete values[field.id];
    }
  }

  // Numbers stay taken while a record waits in the Trash, so putting it back can't clash.
  usedNumbers(typeId, exceptId = null) {
    const used = new Map();
    for (const row of this.project.recordRows(typeId, { all: true })) {
      if (row.id === exceptId) continue;
      const { number } = parseRecord(row.details);
      if (number !== null) used.set(number, row);
    }
    return used;
  }

  checkNumber(typeItem, type, number, exceptId = null) {
    if (number === null) return;
    const taken = this.usedNumbers(typeItem.id, exceptId).get(number);
    if (taken) throw new Error(`${formatNumber(type.numbering, number)} is already used by “${taken.title}”.`);
  }

  nextNumber({ typeId, rangeId }) {
    const item = this.typeItem(typeId);
    const type = parseType(item.details);
    const used = new Set(this.usedNumbers(item.id).keys());
    const number = nextFreeNumber(type.numbering, used, typeof rangeId === 'string' ? rangeId : null);
    return { number, label: number === null ? '' : formatNumber(type.numbering, number) };
  }

  checkNotes(notes) {
    if (typeof notes !== 'string' || notes.length > MAX_NOTES) throw new Error("Those notes can't be saved.");
    if (notes && !parseDocument(notes)) throw new Error("Those notes can't be saved.");
    return notes;
  }

  create({ typeId, title, number, values, notes }) {
    const typeItem = this.typeItem(typeId);
    const type = parseType(typeItem.details);
    const project = this.project;
    return project.db.transaction(() => {
      const clean = cleanValues(type, values);
      this.checkLinks(type, clean, null);
      let wanted = cleanNumberOf(number);
      // A type with numbering gives a new record the next free number, unless the caller says none or picks one.
      if (number === undefined && type.numbering) wanted = nextFreeNumber(type.numbering, new Set(this.usedNumbers(typeItem.id).keys()));
      this.checkNumber(typeItem, type, wanted);
      const added = project.addItem({ kind: 'record', parentId: typeItem.id, title: cleanName(title, 'Untitled') });
      const saved = project.putItem({
        id: added.id,
        details: JSON.stringify({ number: wanted, values: clean }),
        ...(notes ? { body: this.checkNotes(notes) } : {}),
      });
      return this.recordView(saved, type);
    })();
  }

  save({ id, title, number, values, notes }) {
    const item = this.recordItem(id);
    const typeItem = this.project.getItem(item.parentId);
    const type = parseType(typeItem.details);
    const before = parseRecord(item.details);
    return this.project.db.transaction(() => {
      const changes = { id: item.id };
      if (title !== undefined) changes.title = cleanName(title, item.title);
      let wanted = before.number;
      if (number !== undefined) {
        wanted = cleanNumberOf(number);
        this.checkNumber(typeItem, type, wanted, item.id);
      }
      let kept = before.values;
      if (values !== undefined) {
        kept = cleanValues(type, values);
        this.checkLinks(type, kept, item.id);
      }
      changes.details = JSON.stringify({ number: wanted, values: kept });
      if (notes !== undefined) changes.body = this.checkNotes(notes);
      const saved = this.project.putItem(changes);
      return this.recordView(saved, type);
    })();
  }

  createType({ title, fields, numbering }) {
    const clean = cleanType({ fields: fields ?? [], numbering });
    return this.project.db.transaction(() => {
      this.checkTypeLinks(clean, null);
      const item = this.project.addItem({ kind: 'recordtype', parentId: this.project.id, title: this.uniqueTypeName(cleanName(title, 'New type')) });
      const saved = this.project.putItem({ id: item.id, details: JSON.stringify(clean) });
      return this.typeView(saved);
    })();
  }

  uniqueTypeName(name) {
    const taken = new Set(this.project.recordTypes().map((item) => item.title.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let copy = 2; ; copy += 1) if (!taken.has(`${name} ${copy}`.toLowerCase())) return `${name} ${copy}`;
  }

  checkTypeLinks(type, ownId) {
    for (const field of type.fields) {
      if (field.kind !== 'link' || !field.to) continue;
      if (field.to !== ownId && this.project.getItem(field.to)?.kind !== 'recordtype') throw new Error(`${field.name} links to a kind of record that isn't there.`);
    }
  }

  // Fields keep their IDs when they're renamed or reordered, so values survive. A removed field's values stay stored but
  // aren't shown, so adding it back is a new field.
  saveType({ id, title, fields, numbering, views }) {
    const item = this.typeItem(id);
    const old = parseType(item.details);
    const clean = cleanType({
      fields: fields ?? old.fields,
      numbering: numbering === undefined ? old.numbering : numbering,
      views: views ?? old.views,
    });
    this.checkTypeLinks(clean, item.id);
    return this.project.db.transaction(() => {
      const changes = { id: item.id, details: JSON.stringify(clean) };
      if (title !== undefined) changes.title = this.renamedTypeName(item, cleanName(title, item.title));
      const saved = this.project.putItem(changes);
      this.project.reindexType(item.id);
      return this.typeView(saved);
    })();
  }

  renamedTypeName(item, name) {
    const clash = this.project.recordTypes().some((other) => other.id !== item.id && other.title.toLowerCase() === name.toLowerCase());
    if (clash) throw new Error(`There's already a record type called “${name}”.`);
    return name;
  }

  templates() {
    return TEMPLATES.map(({ id, name, summary, types }) => ({ id, name, summary, types: types.map((type) => type.name) }));
  }

  // Makes the template's types that aren't there yet. A type with the same name is left alone, and links point at it.
  applyTemplate(id) {
    const template = TEMPLATES.find((item) => item.id === id);
    if (!template) throw new Error("That template isn't known.");
    return this.project.db.transaction(() => {
      const byKey = new Map();
      const made = [];
      const skipped = [];
      for (const spec of template.types) {
        const existing = this.project.recordTypes().find((item) => item.title.toLowerCase() === spec.name.toLowerCase());
        if (existing) {
          byKey.set(spec.key, existing.id);
          skipped.push(spec.name);
          continue;
        }
        const clean = cleanType({
          fields: spec.fields.map((field) => ({ ...field, to: undefined })),
          numbering: spec.numbering ?? null,
        });
        const item = this.project.addItem({ kind: 'recordtype', parentId: this.project.id, title: spec.name });
        this.project.putItem({ id: item.id, details: JSON.stringify(clean) });
        byKey.set(spec.key, item.id);
        made.push({ spec, id: item.id, clean });
      }
      // Links need every type to exist first, so they're filled in as a second step.
      for (const { spec, id: typeId, clean } of made) {
        const fields = clean.fields.map((field, at) => {
          const wanted = spec.fields[at].to;
          return wanted && byKey.has(wanted) ? { ...field, to: byKey.get(wanted) } : field;
        });
        this.project.putItem({ id: typeId, details: JSON.stringify({ ...clean, fields }) });
      }
      return { made: made.map(({ spec }) => spec.name), skipped, ...this.overview() };
    })();
  }

  // For @ and for looking something up while writing: records of any type whose name or number matches.
  find({ query, typeId }) {
    const wanted = typeof query === 'string' ? query.trim() : '';
    const found = [];
    const types = this.project.recordTypes().filter((item) => !typeId || item.id === typeId);
    for (const typeItem of types) {
      const type = { ...parseType(typeItem.details), fields: [] };
      for (const row of this.project.recordRows(typeItem.id)) {
        const record = this.recordView(row, type);
        if (!matches(wanted, record, type)) continue;
        found.push({ id: record.id, title: record.title, label: record.label, typeId: typeItem.id, typeTitle: typeItem.title });
      }
    }
    const lower = wanted.toLowerCase();
    const rank = (entry) => (entry.title.toLowerCase().startsWith(lower) ? 0 : 1);
    return found.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)).slice(0, MAX_FOUND);
  }

  // The same filter and order a saved view uses, for callers that want a view's records without the window.
  view(typeId, view) {
    const { type, records } = this.list(typeId);
    return applyView(view, records, type);
  }
}

module.exports = { Records };
