'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const {
  applyView,
  cleanType,
  cleanValues,
  formatNumber,
  matches,
  nextFreeNumber,
  rangeOf,
  readNumber,
} = require('../src/shared/records');
const { TEMPLATES } = require('../src/shared/templates');
const { documentFromText, mentionsIn } = require('../src/shared/text');

const tempDirs = [];
const workspaces = [];

test.after(() => {
  workspaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});

function project(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-records-'));
  tempDirs.push(dir);
  const space = new Workspace(new Library(path.join(dir, 'library'), options));
  workspaces.push(space);
  const { id, outline } = space.createProject('A Book');
  return { space, id, records: space.records, chapterId: outline.children[0].children[0].id };
}

const mention = (id, name) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: name, marks: [{ type: 'mention', attrs: { id } }] }] }],
  });

const fieldNamed = (type, name) => type.fields.find((field) => field.name === name);

// The rules, with no project

test('a record type keeps only what it knows, and gives each field a permanent ID', () => {
  const type = cleanType({
    fields: [
      { name: ' Role ', kind: 'choice', options: ['Main', 'main', ' Minor ', ''], extra: 'dropped' },
      { name: 'Age', kind: 'number' },
      { name: 'Friends', kind: 'link' },
    ],
    numbering: { prefix: 'C-', digits: 4 },
  });
  assert.equal(type.fields[0].name, 'Role');
  assert.deepEqual(type.fields[0].options, ['Main', 'Minor']);
  assert.equal('extra' in type.fields[0], false);
  assert.ok(type.fields.every((field) => /^f[0-9a-f]{10}$/.test(field.id)));
  assert.equal(type.fields[2].many, true, 'a link holds many records unless told otherwise');
  assert.deepEqual(type.numbering, { prefix: 'C-', digits: 4, ranges: [] });
  const again = cleanType(type);
  assert.deepEqual(again.fields.map((field) => field.id), type.fields.map((field) => field.id), 'IDs survive being saved again');
});

test('bad types are refused in plain words', () => {
  assert.throws(() => cleanType({ fields: [{ name: 'A', kind: 'colour' }] }), /needs a kind of field/);
  assert.throws(() => cleanType({ fields: [{ name: '', kind: 'text' }] }), /needs a name/);
  assert.throws(() => cleanType({ fields: [{ name: 'A', kind: 'text' }, { name: 'a', kind: 'number' }] }), /Two fields are called/);
  assert.throws(() => cleanType({ fields: [], numbering: { digits: 12 } }), /1 to 8 digits/);
  assert.throws(() => cleanType({ fields: [], numbering: { ranges: [{ name: 'X', from: 9, to: 2 }] } }), /first not above the last/);
  assert.throws(() => cleanType({ fields: Array.from({ length: 61 }, (_, at) => ({ name: `F${at}`, kind: 'text' })) }), /up to 60 fields/);
});

test('values are checked against their field, and empty ones aren’t kept', () => {
  const type = cleanType({
    fields: [
      { id: 'n', name: 'Age', kind: 'number' },
      { id: 'd', name: 'Born', kind: 'date' },
      { id: 'y', name: 'Alive', kind: 'yesno' },
      { id: 'c', name: 'Role', kind: 'choice', options: ['Main'] },
      { id: 't', name: 'Tags', kind: 'choice', many: true },
      { id: 'l', name: 'Friend', kind: 'link', many: false },
      { id: 's', name: 'Alias', kind: 'text' },
    ],
  });
  const clean = cleanValues(type, { n: '41', d: '2020-02-29', y: false, c: 'Main', t: ['a', 'a', 'b'], l: ['x'], s: '  ', unknown: 'gone' });
  assert.deepEqual(clean, { n: 41, d: '2020-02-29', y: false, c: 'Main', t: ['a', 'b'], l: ['x'] });
  assert.throws(() => cleanValues(type, { n: 'forty' }), /Age has to be a number/);
  assert.throws(() => cleanValues(type, { d: '2021-02-29' }), /Born has to be a date/);
  assert.throws(() => cleanValues(type, { d: '29/02/2020' }), /Born has to be a date/);
  assert.throws(() => cleanValues(type, { y: 'yes' }), /yes or no/);
  assert.throws(() => cleanValues(type, { l: ['x', 'y'] }), /links to one record/);
  assert.deepEqual(cleanValues(type, undefined), {});
});

test('numbers read back whatever way they were typed, and the next free one skips what’s taken', () => {
  const numbering = { prefix: 'W-', digits: 3, ranges: [{ id: 'r1', name: 'Series A', from: 100, to: 102 }] };
  assert.equal(formatNumber(numbering, 7), 'W-007');
  assert.equal(formatNumber(null, 7), '007');
  assert.equal(formatNumber(numbering, null), '');
  assert.equal(readNumber(numbering, 'w-7'), 7);
  assert.equal(readNumber(numbering, '0042'), 42);
  assert.equal(readNumber(numbering, 'X-7'), null);
  assert.equal(readNumber(numbering, ''), null);
  assert.equal(nextFreeNumber(numbering, new Set([1, 2, 4])), 3);
  assert.equal(nextFreeNumber(numbering, new Set([100, 101]), 'r1'), 102);
  assert.equal(nextFreeNumber(numbering, new Set([100, 101, 102]), 'r1'), null, 'a full range says so');
  assert.equal(rangeOf(numbering, 101).name, 'Series A');
  assert.equal(rangeOf(numbering, 7), null);
});

test('views filter, then sort, and empty values come last either way', () => {
  const type = cleanType({
    fields: [
      { id: 'age', name: 'Age', kind: 'number' },
      { id: 'role', name: 'Role', kind: 'choice', options: ['Main', 'Minor'] },
      { id: 'dead', name: 'Dead', kind: 'yesno' },
      { id: 'born', name: 'Born', kind: 'date' },
      { id: 'pals', name: 'Pals', kind: 'link' },
    ],
  });
  const rec = (title, number, values, updatedAt = '2026-01-01T00:00:00Z') => ({ title, number, values, updatedAt });
  const all = [
    rec('Cara', 3, { age: 30, role: 'Main', born: '2000-05-01' }),
    rec('Abe', 1, { age: 9, role: 'Minor', dead: true, pals: ['p1'] }),
    rec('Bea', 2, { role: 'Main', born: '1990-01-01' }),
    rec('Dov', null, { age: 100 }),
  ];
  const names = (view) => applyView(view, [...all], type).map((record) => record.title);
  assert.deepEqual(names({}), ['Abe', 'Bea', 'Cara', 'Dov'], 'by name when there is no view');
  assert.deepEqual(names({ filters: [{ field: 'role', test: 'is', value: 'main' }] }), ['Bea', 'Cara']);
  assert.deepEqual(names({ filters: [{ field: 'age', test: 'more', value: '10' }] }), ['Cara', 'Dov']);
  assert.deepEqual(names({ filters: [{ field: 'age', test: 'empty' }] }), ['Bea']);
  assert.deepEqual(names({ filters: [{ field: 'dead', test: 'yes' }] }), ['Abe']);
  assert.deepEqual(names({ filters: [{ field: 'dead', test: 'no' }] }), ['Bea', 'Cara', 'Dov']);
  assert.deepEqual(names({ filters: [{ field: 'pals', test: 'has', value: 'p1' }] }), ['Abe']);
  assert.deepEqual(names({ filters: [{ field: 'born', test: 'before', value: '1995-01-01' }] }), ['Bea']);
  assert.deepEqual(names({ filters: [{ field: '@name', test: 'contains', value: 'e' }] }), ['Abe', 'Bea']);
  assert.deepEqual(names({ sort: { field: 'age', direction: 'up' } }), ['Abe', 'Cara', 'Dov', 'Bea']);
  assert.deepEqual(names({ sort: { field: 'age', direction: 'down' } }), ['Dov', 'Cara', 'Abe', 'Bea']);
  assert.deepEqual(names({ sort: { field: '@number', direction: 'up' } }), ['Abe', 'Bea', 'Cara', 'Dov']);
  assert.ok(matches('main', all[0], type));
  assert.ok(!matches('zzz', all[0], type));
  assert.ok(matches('', all[0], type));
});

test('a view is only saved with fields the type has', () => {
  assert.throws(
    () => cleanType({ fields: [], views: [{ name: 'V', filters: [{ field: 'nope', test: 'is', value: 'x' }] }] }),
    /isn’t there/,
  );
  assert.throws(
    () => cleanType({ fields: [{ id: 'a', name: 'A', kind: 'number' }], views: [{ name: 'V', filters: [{ field: 'a', test: 'contains', value: 'x' }] }] }),
    /can’t be filtered that way/,
  );
  const type = cleanType({
    fields: [{ id: 'a', name: 'A', kind: 'number' }],
    views: [{ name: 'Big', mode: 'cards', filters: [{ field: 'a', test: 'more', value: 5 }], sort: { field: 'gone', direction: 'down' }, columns: ['a', 'gone'] }],
  });
  assert.equal(type.views[0].mode, 'cards');
  assert.deepEqual(type.views[0].columns, ['a']);
  assert.deepEqual(type.views[0].sort, { field: '@name', direction: 'up' }, 'a sort on a missing field falls back to the name');
  assert.equal(type.views[0].filters[0].value, '5');
});

test('mentions are found in a saved document, and only real ones', () => {
  assert.deepEqual(mentionsIn(mention('abc', 'Marit')), ['abc']);
  assert.deepEqual(mentionsIn(JSON.stringify(documentFromText('no marks, but the word "mention"'))), []);
  assert.deepEqual(mentionsIn('plain text'), []);
  assert.deepEqual(mentionsIn(''), []);
});

test('every template makes sense: types are named once and links point inside it', () => {
  for (const template of TEMPLATES) {
    const keys = new Set(template.types.map((type) => type.key));
    assert.equal(keys.size, template.types.length, `${template.name} repeats a type`);
    for (const type of template.types) {
      const clean = cleanType({ fields: type.fields.map((field) => ({ ...field, to: undefined })), numbering: type.numbering ?? null });
      assert.ok(clean.fields.length > 0);
      for (const field of type.fields.filter((item) => item.to)) assert.ok(keys.has(field.to), `${type.name}.${field.name} links to ${field.to}`);
    }
  }
});

// With a project

test('records are items, and stay out of the outline of books and chapters', () => {
  const { space, records } = project();
  const type = records.createType({ title: 'Character', fields: [{ name: 'Role', kind: 'choice', options: ['Main'] }] });
  const record = records.create({ typeId: type.id, title: 'Marit', values: { [type.fields[0].id]: 'Main' } });
  assert.equal(space.outline().children.every((node) => node.kind === 'book'), true);
  assert.equal(JSON.stringify(space.outline()).includes('Marit'), false);
  assert.equal(space.project.getItem(record.id).kind, 'record');
  assert.equal(space.project.getItem(record.id).parentId, type.id);
  const { records: listed } = records.list(type.id);
  assert.deepEqual(listed.map((item) => item.title), ['Marit']);
  assert.equal(records.overview().types[0].count, 1);
});

test('creating and saving a record keeps its values, and rejects what the field wouldn’t take', () => {
  const { records } = project();
  const type = records.createType({
    title: 'Character',
    fields: [{ name: 'Age', kind: 'number' }, { name: 'Born', kind: 'date' }],
  });
  const [age, born] = type.fields;
  const made = records.create({ typeId: type.id, title: '  Marit  ', values: { [age.id]: 30 } });
  assert.equal(made.title, 'Marit');
  const saved = records.save({ id: made.id, values: { [age.id]: 31, [born.id]: '1990-04-01' }, notes: JSON.stringify(documentFromText('Notes here')) });
  assert.deepEqual(saved.values, { [age.id]: 31, [born.id]: '1990-04-01' });
  assert.equal(records.get(made.id).notes.includes('Notes here'), true);
  assert.throws(() => records.save({ id: made.id, values: { [age.id]: 'old' } }), /has to be a number/);
  assert.throws(() => records.save({ id: made.id, notes: 'not a document {' }), /can't be saved/);
  assert.equal(records.get(made.id).record.values[age.id], 31, 'a refused save changes nothing');
  assert.throws(() => records.create({ typeId: made.id, title: 'x' }), /isn't a record type/);
  assert.throws(() => records.get(type.id), /isn't a record/);
});

test('numbers: the next free one is given, none can be used twice, and the Trash keeps them taken', () => {
  const { space, records } = project();
  const type = records.createType({
    title: 'Weapon',
    fields: [],
    numbering: { prefix: 'W-', digits: 3, ranges: [{ id: 'r1', name: 'North', from: 100, to: 101 }] },
  });
  const first = records.create({ typeId: type.id, title: 'Sword' });
  const second = records.create({ typeId: type.id, title: 'Axe' });
  assert.deepEqual([first.number, second.number], [1, 2]);
  assert.equal(second.label, 'W-002');
  assert.throws(() => records.create({ typeId: type.id, title: 'Bow', number: 2 }), /W-002 is already used by “Axe”/);
  assert.throws(() => records.save({ id: second.id, number: 1 }), /W-001 is already used by “Sword”/);
  assert.equal(records.save({ id: second.id, number: 2 }).number, 2, 'keeping its own number is fine');
  assert.equal(records.create({ typeId: type.id, title: 'Spear', number: null }).number, null, 'no number on purpose');
  assert.deepEqual(records.nextNumber({ typeId: type.id }), { number: 3, label: 'W-003' });
  assert.deepEqual(records.nextNumber({ typeId: type.id, rangeId: 'r1' }), { number: 100, label: 'W-100' });
  space.trashItem(second.id);
  assert.equal(records.nextNumber({ typeId: type.id }).number, 3, 'the Trash still holds 2');
  assert.throws(() => records.create({ typeId: type.id, title: 'Mace', number: 2 }), /already used/);
  assert.equal(records.list(type.id).records.some((record) => record.id === second.id), false);
  space.restoreItem(second.id);
  assert.equal(records.list(type.id).records.length, 3, 'and it comes back with its number');
});

test('a type without numbering gives no numbers', () => {
  const { records } = project();
  const type = records.createType({ title: 'Idea', fields: [] });
  assert.equal(records.create({ typeId: type.id, title: 'One' }).number, null);
  assert.equal(records.create({ typeId: type.id, title: 'Two', number: 5 }).label, '005');
});

test('links go both ways: a record shows what points at it', () => {
  const { space, records } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  const friends = { name: 'Friends', kind: 'link', to: people.id };
  const typed = records.saveType({ id: people.id, fields: [friends] });
  const friend = fieldNamed(typed, 'Friends');
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  const jon = records.create({ typeId: people.id, title: 'Jon', values: { [friend.id]: [marit.id] } });
  const back = records.get(marit.id).backlinks;
  assert.equal(back.length, 1);
  assert.deepEqual({ ...back[0] }, { kind: 'record', id: jon.id, title: 'Jon', context: 'Character', via: 'Friends', typeId: people.id });
  assert.equal(records.get(jon.id).targets[marit.id].title, 'Marit');
  assert.throws(() => records.save({ id: marit.id, values: { [friend.id]: [marit.id] } }), /can't link to itself/);
  space.trashItem(jon.id);
  assert.equal(records.get(marit.id).backlinks.length, 0, 'what is in the Trash points at nothing');
  space.restoreItem(jon.id);
  assert.equal(records.get(marit.id).backlinks.length, 1);
  records.save({ id: jon.id, values: {} });
  assert.equal(records.get(marit.id).backlinks.length, 0, 'removing the link removes the backlink');
});

test('a link field that names a type only takes that type', () => {
  const { records } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  const places = records.createType({ title: 'Place', fields: [] });
  const typed = records.saveType({ id: people.id, fields: [{ name: 'Home', kind: 'link', to: places.id, many: false }] });
  const home = fieldNamed(typed, 'Home');
  const town = records.create({ typeId: places.id, title: 'Harbour' });
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  assert.deepEqual(records.save({ id: marit.id, values: { [home.id]: [town.id] } }).values[home.id], [town.id]);
  const jon = records.create({ typeId: people.id, title: 'Jon' });
  assert.throws(() => records.save({ id: marit.id, values: { [home.id]: [jon.id] } }), /different kind of record/);
  assert.throws(() => records.saveType({ id: people.id, fields: [{ name: 'Home', kind: 'link', to: 'nope' }] }), /isn't there/);
});

test('an @ in a chapter or in a record’s notes is a link back, and goes when the words do', () => {
  const { space, records, chapterId } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  const jon = records.create({ typeId: people.id, title: 'Jon', notes: mention(marit.id, 'Marit') });
  space.saveChapter({ id: chapterId, title: 'Chapter 1', body: mention(marit.id, 'Marit') });
  const back = records.get(marit.id).backlinks;
  assert.deepEqual(back.map((link) => link.kind).sort(), ['chapter', 'record']);
  const chapter = back.find((link) => link.kind === 'chapter');
  assert.equal(chapter.id, chapterId);
  assert.equal(chapter.context, 'A Book', 'a chapter says which book it is in');
  assert.equal(back.find((link) => link.kind === 'record').via, null);
  space.saveChapter({ id: chapterId, title: 'Chapter 1', body: JSON.stringify(documentFromText('Marit, but no link now')) });
  assert.deepEqual(records.get(marit.id).backlinks.map((link) => link.id), [jon.id]);
  space.trashItem(chapterId);
  space.restoreItem(chapterId);
  space.saveChapter({ id: chapterId, title: 'Chapter 1', body: mention(marit.id, 'Marit') });
  space.trashItem(chapterId);
  assert.deepEqual(records.get(marit.id).backlinks.map((link) => link.id), [jon.id], 'a chapter in the Trash is left out');
});

test('a mention counts as words in the chapter, like any other words', () => {
  const { space, records, chapterId } = project();
  const type = records.createType({ title: 'Character', fields: [] });
  const marit = records.create({ typeId: type.id, title: 'Marit' });
  const saved = space.saveChapter({ id: chapterId, title: 'Chapter 1', body: mention(marit.id, 'Marit Vance') });
  assert.equal(saved.words, 2);
});

test('removing a record for good clears its links, and a link to it quietly disappears', () => {
  const { space, records } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  const typed = records.saveType({ id: people.id, fields: [{ name: 'Friends', kind: 'link', to: people.id }] });
  const friend = fieldNamed(typed, 'Friends');
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  const jon = records.create({ typeId: people.id, title: 'Jon', values: { [friend.id]: [marit.id] } });
  space.project.removeItem(marit.id);
  assert.equal(space.project.db.prepare('SELECT COUNT(*) AS n FROM record_links').get().n, 0);
  assert.deepEqual(records.get(jon.id).record.values, {}, 'the window is never shown a link to nothing');
  assert.equal(records.save({ id: jon.id, title: 'Jon Vance' }).title, 'Jon Vance');
  assert.ok(space.project.removalMarkers().some((marker) => marker.itemId === marit.id), 'and the removal is still marked for sync');
});

test('a link to a record in the Trash stays, and shows as being there', () => {
  const { space, records } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  const typed = records.saveType({ id: people.id, fields: [{ name: 'Friends', kind: 'link', to: people.id }] });
  const friend = fieldNamed(typed, 'Friends');
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  const jon = records.create({ typeId: people.id, title: 'Jon', values: { [friend.id]: [marit.id] } });
  space.trashItem(marit.id);
  const view = records.get(jon.id);
  assert.deepEqual(view.record.values[friend.id], [marit.id]);
  assert.equal(view.targets[marit.id].trashed, true);
  records.save({ id: jon.id, values: view.record.values });
  space.restoreItem(marit.id);
  assert.equal(records.get(marit.id).backlinks.length, 1, 'the link survived being edited around');
});

test('removing a field from a type keeps old values stored, and a changed type re-reads its links', () => {
  const { space, records } = project();
  const people = records.createType({ title: 'Character', fields: [{ name: 'Age', kind: 'number' }, { name: 'Pals', kind: 'link' }] });
  const [age, pals] = people.fields;
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  const jon = records.create({ typeId: people.id, title: 'Jon', values: { [age.id]: 5, [pals.id]: [marit.id] } });
  assert.equal(records.get(marit.id).backlinks.length, 1);
  records.saveType({ id: people.id, fields: [people.fields[0]] });
  assert.equal(records.get(marit.id).backlinks.length, 0, 'with the link field gone nothing links');
  assert.deepEqual(records.get(jon.id).record.values, { [age.id]: 5 });
  assert.ok(space.project.getItem(jon.id).details.includes(pals.id), 'the value is still stored');
});

test('type names stay one each, and a type goes to the Trash with its records', () => {
  const { space, records } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  assert.equal(records.createType({ title: 'character', fields: [] }).title, 'character 2');
  const other = records.createType({ title: 'Place', fields: [] });
  assert.throws(() => records.saveType({ id: other.id, title: 'CHARACTER' }), /already a record type called/);
  const marit = records.create({ typeId: people.id, title: 'Marit' });
  space.trashItem(people.id);
  assert.equal(records.overview().types.some((type) => type.id === people.id), false);
  assert.deepEqual(records.find({ query: 'Marit' }), [], 'its records are out of sight with it');
  assert.deepEqual(space.listTrash().map((entry) => entry.title), ['Character'], 'the Trash shows the type, not each record in it');
  space.trashItem(marit.id);
  assert.throws(() => space.restoreItem(marit.id), /Restore “Character” first/);
  space.restoreItem(people.id);
  space.restoreItem(marit.id);
  assert.equal(records.find({ query: 'Marit' }).length, 1);
});

test('find looks across every type by name or number, best match first', () => {
  const { records } = project();
  const people = records.createType({ title: 'Character', fields: [] });
  const arms = records.createType({ title: 'Weapon', fields: [], numbering: { prefix: 'W-', digits: 3 } });
  records.create({ typeId: people.id, title: 'Marit' });
  records.create({ typeId: people.id, title: 'Summer Marit' });
  records.create({ typeId: arms.id, title: 'Marit’s blade' });
  const found = records.find({ query: 'marit' });
  assert.deepEqual(found.map((entry) => entry.title), ['Marit', 'Marit’s blade', 'Summer Marit']);
  assert.equal(found[1].label, 'W-001');
  assert.equal(found[1].typeTitle, 'Weapon');
  assert.deepEqual(records.find({ query: 'W-001' }).map((entry) => entry.title), ['Marit’s blade']);
  assert.deepEqual(records.find({ query: 'marit', typeId: people.id }).map((entry) => entry.typeTitle), ['Character', 'Character']);
  assert.equal(records.find({ query: '' }).length, 3);
});

test('a template makes its types and links them, and a second go leaves what’s there alone', () => {
  const { records } = project();
  assert.deepEqual(records.templates().map((template) => template.id), ['novel', 'series', 'universe']);
  const first = records.applyTemplate('universe');
  assert.deepEqual(first.made, ['Character', 'Weapon', 'Material', 'Place']);
  const weapon = first.types.find((type) => type.title === 'Weapon');
  const material = first.types.find((type) => type.title === 'Material');
  assert.equal(fieldNamed(weapon, 'Made of').to, material.id, 'links point at the new type, not its key');
  assert.equal(weapon.numbering.prefix, 'W-');
  const again = records.applyTemplate('universe');
  assert.deepEqual(again.made, []);
  assert.equal(again.types.length, 4);
  assert.deepEqual(records.applyTemplate('novel').made, [], 'Character and Place already exist');
  assert.throws(() => records.applyTemplate('nope'), /isn't known/);
});

test('record work is in the change log, so it can be synced, and everything is encrypted with the rest', () => {
  const { space, records } = project();
  const type = records.createType({ title: 'Character', fields: [{ name: 'Age', kind: 'number' }] });
  const record = records.create({ typeId: type.id, title: 'Marit', values: { [type.fields[0].id]: 3 } });
  const logged = space.project.changesSince(0).filter((change) => change.itemId === record.id);
  assert.ok(logged.length >= 2);
  assert.ok(logged.some((change) => change.fields.includes('details')));
  assert.equal(space.project.db.prepare("SELECT COUNT(*) AS n FROM changes WHERE item_id = 'record_links'").get().n, 0, 'the link table is never logged');
});

test('an older project gets the link table when it opens', () => {
  const { space, id } = project();
  const file = space.project.file;
  space.project.db.exec('DROP TABLE record_links');
  space.project.db.pragma('user_version = 6');
  space.closeProject();
  const reopened = space.openProject(id);
  assert.equal(reopened.id, id);
  assert.equal(space.project.db.prepare('SELECT COUNT(*) AS n FROM record_links').get().n, 0);
  assert.ok(file);
});

test('the sample shows records: two characters, linked from the first chapters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-records-'));
  tempDirs.push(dir);
  const space = new Workspace(new Library(path.join(dir, 'library')));
  workspaces.push(space);
  space.createSample();
  const { types } = space.records.overview();
  assert.deepEqual(types.map((type) => [type.title, type.count]), [['Character', 2]]);
  const [character] = types;
  const { records } = space.records.list(character.id);
  const marit = records.find((record) => record.title === 'Marit');
  const back = space.records.get(marit.id).backlinks;
  assert.deepEqual(back.map((link) => link.title).sort(), ['The Ledger', 'The Mule']);
  assert.equal(back[0].context, 'The Salt Road');
  assert.equal(space.outline().children[0].words > 0, true, 'the chapters read as before');
});
