'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { NAME, NEW, NUMBER, RecordImporter, SKIP, cleanLinkName, guessKind, parseCsv, splitList, toDate } = require('../src/main/records-import');
const { plainText } = require('../src/shared/text');

const tempDirs = [];
const workspaces = [];

test.after(() => {
  workspaces.forEach((space) => space.closeProject());
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recimport-'));
  tempDirs.push(dir);
  const space = new Workspace(new Library(path.join(dir, 'library')));
  workspaces.push(space);
  space.createProject('A Book');
  return { space, records: space.records, dir };
}

function files(dir, entries) {
  return Object.entries(entries).map(([name, text]) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  });
}

const fieldNamed = (type, name) => type.fields.find((field) => field.name === name);
const titles = (records, typeId) => records.list(typeId).records.map((record) => record.title);

test('spreadsheets are read the way they were written', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n', ','), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n', ','), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\n"two\nlines",z\n\n\n', ','), [['a', 'b'], ['two\nlines', 'z']], 'a line break inside quotes stays, a blank line goes');
  assert.deepEqual(parseCsv('a;b\n1;2', ';'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1', ','), [['a', 'b'], ['1']], 'a short row is filled out when the file is loaded, not here');
});

test('small readers: lists, links, dates and kinds', () => {
  assert.deepEqual(splitList('Marit; Jon,Reed'), ['Marit', 'Jon,Reed'].flatMap((item) => (item.includes(',') ? ['Jon,Reed'] : [item])));
  assert.deepEqual(splitList('Marit, Jon Reed, Kay'), ['Marit', 'Jon Reed', 'Kay']);
  assert.equal(cleanLinkName('Marit Vance (https://www.notion.so/Marit-123?pvs=4)'), 'Marit Vance');
  assert.equal(cleanLinkName('[Marit Vance](Marit%20Vance.md)'), 'Marit Vance');
  assert.equal(cleanLinkName('[[Marit Vance]]'), 'Marit Vance');
  assert.equal(toDate('2020-02-29'), '2020-02-29');
  assert.equal(toDate('March 5, 2021'), '2021-03-05');
  assert.equal(toDate('25/12/2020'), '2020-12-25');
  assert.equal(toDate('someday'), null);
  assert.equal(guessKind(['1', '2.5', '']), 'number');
  assert.equal(guessKind(['2020-01-01']), 'date');
  assert.equal(guessKind(['yes', 'no']), 'yesno');
  assert.equal(guessKind(['1', 'two']), 'text');
  assert.equal(guessKind([]), 'text');
});

test('a spreadsheet goes to a kind of record by column, and the preview guesses from the names', () => {
  const { records, dir } = project();
  const people = records.createType({
    title: 'Character',
    fields: [{ name: 'Role', kind: 'choice', options: ['Main'] }, { name: 'Age', kind: 'number' }],
    numbering: { prefix: 'C-', digits: 3 },
  });
  const importer = new RecordImporter();
  const [file] = files(dir, { 'people.csv': 'Name,Role,Age,Number,Mood\nMarit,Main,30,C-007,calm\nJon,Minor,41,,angry\n' });
  assert.deepEqual(importer.load([file]), { kind: 'csv', files: 1, rows: 2, names: ['people.csv'] });
  const preview = importer.preview(records.typeItem(people.id));
  assert.deepEqual(preview.columns.map((column) => [column.label, column.target === people.fields[0].id ? 'Role' : column.target === people.fields[1].id ? 'Age' : column.target]), [
    ['Name', NAME], ['Role', 'Role'], ['Age', 'Age'], ['Number', NUMBER], ['Mood', SKIP],
  ]);
  assert.equal(preview.columns[2].kind, 'number');
  assert.deepEqual(preview.firstRows[0], ['Marit', 'Main', '30', 'C-007', 'calm']);

  const result = importer.run(records, { typeId: people.id, mapping: preview.columns.map(({ label, target }) => ({ label, target })) });
  assert.deepEqual([result.created, result.updated, result.skipped], [2, 0, 0]);
  const list = records.list(people.id).records;
  const marit = list.find((record) => record.title === 'Marit');
  const jon = list.find((record) => record.title === 'Jon');
  assert.equal(marit.label, 'C-007', 'a number in the file is kept');
  assert.equal(jon.number, 1, 'a record with none gets the next free number');
  assert.equal(marit.values[people.fields[1].id], 30);
  assert.ok(records.get(marit.id).type.fields[0].options.includes('Minor'), 'a choice that wasn’t there is added');
  assert.equal(jon.values[people.fields[0].id], 'Minor');
});

test('what can’t be read is reported and left out, not guessed', () => {
  const { records, dir } = project();
  const type = records.createType({ title: 'Person', fields: [{ name: 'Age', kind: 'number' }, { name: 'Born', kind: 'date' }, { name: 'Alive', kind: 'yesno' }], numbering: { prefix: 'P-', digits: 2 } });
  const importer = new RecordImporter();
  importer.load(files(dir, { 'p.csv': 'Name,Age,Born,Alive,No\nA,old,never,maybe,x\n,5,,,\nB,6,2001-02-03,yes,P-05\nC,7,,,P-05\n' }));
  const mapping = [['Name', NAME], ['Age', type.fields[0].id], ['Born', type.fields[1].id], ['Alive', type.fields[2].id], ['No', NUMBER]].map(([label, target]) => ({ label, target }));
  const result = importer.run(records, { typeId: type.id, mapping });
  assert.deepEqual([result.created, result.skipped], [3, 1]);
  const messages = result.problems.map((item) => `${item.where}: ${item.message}`).join('\n');
  assert.match(messages, /Row 2: “old” isn’t a number/);
  assert.match(messages, /Row 2: “never” isn’t a date/);
  assert.match(messages, /Row 2: “maybe” isn’t yes or no/);
  assert.match(messages, /Row 2: “x” isn’t a number here/);
  assert.match(messages, /Row 3: It has no name/);
  assert.match(messages, /Row 5: P-05 is already used by “B”, so “C” got the next free number/);
  const list = records.list(type.id).records;
  assert.equal(list.find((record) => record.title === 'B').label, 'P-05');
  assert.equal(list.find((record) => record.title === 'A').label, 'P-01', 'a number that can’t be read gets the next free one');
  assert.equal(list.find((record) => record.title === 'C').label, 'P-02');
  assert.deepEqual(list.find((record) => record.title === 'A').values, {}, 'nothing unreadable was saved');
});

test('a name that’s already there is skipped, or updated without wiping the rest', () => {
  const { records, dir } = project();
  const type = records.createType({ title: 'Person', fields: [{ name: 'Age', kind: 'number' }, { name: 'Role', kind: 'text' }] });
  const [age, role] = type.fields;
  records.create({ typeId: type.id, title: 'Marit', values: { [age.id]: 30, [role.id]: 'Main' } });
  const mapping = [{ label: 'Name', target: NAME }, { label: 'Age', target: age.id }];
  const importer = new RecordImporter();
  importer.load(files(dir, { 'a.csv': 'Name,Age\nmarit,99\nJon,5\njon,6\n' }));
  const skipped = importer.run(records, { typeId: type.id, mapping, duplicates: 'skip' });
  assert.deepEqual([skipped.created, skipped.updated, skipped.skipped], [1, 0, 2], 'a repeat inside the file counts as already there');
  assert.equal(records.list(type.id).records.find((record) => record.title === 'Marit').values[age.id], 30);
  const updated = importer.run(records, { typeId: type.id, mapping, duplicates: 'update' });
  assert.deepEqual([updated.created, updated.updated], [0, 3]);
  const marit = records.list(type.id).records.find((record) => record.title === 'Marit');
  assert.deepEqual(marit.values, { [age.id]: 99, [role.id]: 'Main' }, 'only what the file has is changed');
});

test('links are made by name, from the same files too, and Notion-style names work', () => {
  const { records, dir } = project();
  const type = records.createType({ title: 'Person', fields: [] });
  const typed = records.saveType({ id: type.id, fields: [{ name: 'Friends', kind: 'link', to: type.id }] });
  const friends = fieldNamed(typed, 'Friends');
  records.create({ typeId: type.id, title: 'Old Friend' });
  const importer = new RecordImporter();
  importer.load(files(dir, { 'f.csv': 'Name,Friends\nAnna,"Bea (https://www.notion.so/Bea-9f8), Old Friend; Nobody"\nBea,\n' }));
  const result = importer.run(records, { typeId: type.id, mapping: [{ label: 'Name', target: NAME }, { label: 'Friends', target: friends.id }] });
  assert.equal(result.created, 2);
  assert.match(result.problems.map((item) => item.message).join('\n'), /Friends: “Nobody” isn’t a record yet/);
  const list = records.list(type.id).records;
  const anna = list.find((record) => record.title === 'Anna');
  const names = anna.values[friends.id].map((id) => records.get(id).record.title).sort();
  assert.deepEqual(names, ['Bea', 'Old Friend']);
  assert.equal(records.get(list.find((record) => record.title === 'Bea').id).backlinks[0].title, 'Anna');
});

test('new fields and a new kind of record can come from the files themselves', () => {
  const { records, dir } = project();
  const importer = new RecordImporter();
  importer.load(files(dir, { 'places.csv': 'Title,Population,Founded,Notes about it\nHarbour,1200,1850-01-01,"A long note.\nTwo lines."\n' }));
  const preview = importer.preview(null);
  assert.deepEqual(preview.columns.map((column) => [column.label, column.target, column.kind]), [
    ['Title', NAME, 'text'], ['Population', NEW, 'number'], ['Founded', NEW, 'date'], ['Notes about it', NEW, 'longtext'],
  ]);
  const result = importer.run(records, { newTypeName: 'Place', mapping: preview.columns.map(({ label, target }) => ({ label, target })) });
  assert.deepEqual(result.newFields, ['Population', 'Founded', 'Notes about it']);
  const view = records.list(result.typeId);
  assert.deepEqual(view.type.fields.map((field) => [field.name, field.kind]), [['Population', 'number'], ['Founded', 'date'], ['Notes about it', 'longtext']]);
  assert.equal(view.records[0].values[fieldNamed(view.type, 'Population').id], 1200);
  assert.throws(() => importer.run(records, { mapping: [{ label: 'Title', target: NAME }] }), /Give the new kind of record a name/);
  const again = new RecordImporter();
  again.load(files(dir, { 'more.csv': 'Title,Population\nTown,5\n' }));
  const added = again.run(records, { typeId: result.typeId, mapping: [{ label: 'Title', target: NAME }, { label: 'Population', target: NEW }] });
  assert.deepEqual(added.newFields, ['Population 2'], 'a new field never takes the name of one that’s there');
});

test('Markdown files give one record each: a title, label lines to fields, and the rest as notes', () => {
  const { records, dir } = project();
  const type = records.createType({ title: 'Character', fields: [{ name: 'Role', kind: 'choice', options: [] }, { name: 'Age', kind: 'number' }, { name: 'Allies', kind: 'link' }] });
  const [role, age, allies] = type.fields;
  const importer = new RecordImporter();
  importer.load(files(dir, {
    'marit.md': '# Marit Vance\n\n**Role:** Main\n- Age: 30\nAllies: Jon Reed\nAppearance: tall\n\n## Background\n\nShe found the ledger.\n',
    'jon.md': '---\ntitle: Jon Reed\nRole: Minor\ntags: [a, b]\n---\n\n| Field | Value |\n|---|---|\n| Age | 41 |\n\nA quiet man.\n',
    'no-title.md': 'Just words here.\n',
  }));
  const preview = importer.preview(records.typeItem(type.id));
  assert.equal(preview.rows, 3);
  const targets = Object.fromEntries(preview.columns.map((column) => [column.label, column.target]));
  assert.equal(targets.Role, role.id);
  assert.equal(targets.Age, age.id);
  assert.equal(targets.Appearance, SKIP, 'an unknown label stays in the notes unless told otherwise');
  const result = importer.run(records, { typeId: type.id, mapping: preview.columns.map(({ label, target }) => ({ label, target })) });
  assert.equal(result.created, 3);
  const byTitle = Object.fromEntries(records.list(type.id).records.map((record) => [record.title, record]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['Jon Reed', 'Marit Vance', 'no title']);
  assert.equal(byTitle['Marit Vance'].values[role.id], 'Main');
  assert.equal(byTitle['Marit Vance'].values[age.id], 30);
  assert.equal(byTitle['Jon Reed'].values[age.id], 41, 'a two-column table works too');
  assert.equal(byTitle['Jon Reed'].values[role.id], 'Minor', 'and so does front matter');
  assert.deepEqual(byTitle['Marit Vance'].values[allies.id], [byTitle['Jon Reed'].id], 'a name in a link field is found, even in a later file');
  const notes = plainText(records.get(byTitle['Marit Vance'].id).notes);
  assert.ok(notes.includes('Appearance: tall'), 'a line that wasn’t sent to a field is kept');
  assert.ok(notes.includes('She found the ledger.'));
  assert.ok(!notes.includes('Role'), 'a line that went to a field is out of the notes');
  assert.ok(!notes.includes('Marit Vance'), 'so is the title, which is now the name');
  assert.ok(plainText(records.get(byTitle['no title'].id).notes).includes('Just words here.'));
});

test('a failure part-way leaves nothing behind, and a copy of the project is kept first', () => {
  const { space, records, dir } = project();
  const type = records.createType({ title: 'Person', fields: [] });
  const importer = new RecordImporter();
  importer.load(files(dir, { 'p.csv': 'Name\nA\nB\nC\n' }));
  const real = records.create.bind(records);
  let calls = 0;
  records.create = (input) => {
    calls += 1;
    if (calls === 3) throw new Error('disk trouble');
    return real(input);
  };
  assert.throws(() => importer.run(records, { typeId: type.id, mapping: [{ label: 'Name', target: NAME }] }), /disk trouble/);
  records.create = real;
  assert.deepEqual(titles(records, type.id), []);
  assert.ok(fs.existsSync(path.join(path.dirname(space.project.file), 'backups', 'before-records-import.db')));
});

test('the files are checked before anything is read, and the mapping before anything is written', () => {
  const { records, dir } = project();
  const type = records.createType({ title: 'Person', fields: [{ name: 'Age', kind: 'number' }] });
  const importer = new RecordImporter();
  assert.throws(() => importer.run(records, { typeId: type.id, mapping: [] }), /Choose some files first/);
  assert.throws(() => importer.load([]), /Choose some files/);
  assert.throws(() => importer.load(files(dir, { 'a.docx': 'x' })), /spreadsheets \(CSV\) or Markdown/);
  assert.throws(() => importer.load(files(dir, { 'a.csv': 'Name\nA\n', 'b.md': '# B' })), /not both/);
  assert.throws(() => importer.load(files(dir, { 'empty.csv': 'Name\n' })), /nothing to bring in/);
  importer.load(files(dir, { 'ok.csv': 'Name,Age\nA,1\n' }));
  assert.throws(() => importer.run(records, { typeId: type.id, mapping: [{ label: 'Age', target: type.fields[0].id }] }), /Choose which column is the name/);
  assert.throws(() => importer.run(records, { typeId: type.id, mapping: [{ label: 'Name', target: NAME }, { label: 'Age', target: 'nope' }] }), /isn’t there/);
  assert.throws(() => importer.run(records, { typeId: type.id, mapping: [{ label: 'Name', target: NAME }], duplicates: 'wipe' }), /already there/);
  assert.deepEqual(titles(records, type.id), []);
  const many = `Name\n${Array.from({ length: 3001 }, (_, at) => `R${at}`).join('\n')}\n`;
  assert.throws(() => importer.load(files(dir, { 'many.csv': many })), /more than 3000 records/);
});

test('everything exported can be brought back in with its fields in place', async () => {
  const { exportEverything } = require('../src/main/export');
  const { space, records, dir } = project();
  const type = records.createType({
    title: 'Weapon',
    fields: [
      { name: 'Material', kind: 'choice', options: ['Steel', 'Glass'] },
      { name: 'Weight', kind: 'number' },
      { name: 'Forged', kind: 'date' },
      { name: 'Cursed', kind: 'yesno' },
      { name: 'History', kind: 'longtext' },
      { name: 'Wielder', kind: 'link' },
    ],
    numbering: { prefix: 'W-', digits: 3 },
  });
  const people = records.createType({ title: 'Person', fields: [] });
  const marit = records.create({ typeId: people.id, title: 'Marit Vance' });
  const f = (name) => fieldNamed(type, name).id;
  records.create({
    typeId: type.id,
    title: 'Dawn Blade',
    values: { [f('Material')]: 'Steel', [f('Weight')]: 4.5, [f('Forged')]: '1850-03-02', [f('Cursed')]: true, [f('History')]: 'Made in the north.\nLost twice.', [f('Wielder')]: [marit.id] },
    notes: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A bright blade, ' }, { type: 'text', text: 'Marit Vance', marks: [{ type: 'mention', attrs: { id: marit.id } }] }] }] }),
  });
  records.create({ typeId: type.id, title: 'Plain Knife' });

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-recout-'));
  tempDirs.push(out);
  const { folder, files } = await exportEverything(space.project, out);
  assert.ok(files >= 6, 'two books files, plus 3 weapon and person files');
  const weapons = path.join(folder, 'Records', 'Weapon');
  assert.deepEqual(fs.readdirSync(weapons).sort(), ['W-001 Dawn Blade.md', 'W-002 Plain Knife.md']);
  const text = fs.readFileSync(path.join(weapons, 'W-001 Dawn Blade.md'), 'utf8');
  assert.match(text, /^# Dawn Blade\n\n\*\*Number:\*\* W-001\n\*\*Material:\*\* Steel\n\*\*Weight:\*\* 4\.5\n\*\*Forged:\*\* 1850-03-02\n\*\*Cursed:\*\* Yes\n\*\*Wielder:\*\* Marit Vance\n\n## History\n\nMade in the north\./);
  assert.match(text, /A bright blade, Marit Vance\n$/, 'the @ link is just words in a file');
  const csv = fs.readFileSync(path.join(folder, 'Records', 'Weapon.csv'), 'utf8');
  assert.match(csv, /^"Name","Number","Material","Weight","Forged","Cursed","History","Wielder","Notes"\n"Dawn Blade","W-001","Steel","4\.5","1850-03-02","Yes","Made in the north\.\nLost twice\.","Marit Vance"/);

  // Into a fresh project, the same fields are found by name and the values come back.
  const again = project();
  const sameType = again.records.createType({ title: 'Weapon', fields: type.fields.map(({ id, ...rest }) => rest), numbering: { prefix: 'W-', digits: 3 } });
  again.records.createType({ title: 'Person', fields: [] });
  const importer = new RecordImporter();
  importer.load(fs.readdirSync(weapons).map((name) => path.join(weapons, name)));
  const preview = importer.preview(again.records.typeItem(sameType.id));
  const byLabel = Object.fromEntries(preview.columns.map((column) => [column.label, column.target]));
  assert.equal(byLabel.Number, NUMBER);
  assert.equal(byLabel.Material, fieldNamed(sameType, 'Material').id);
  assert.equal('History' in byLabel, false, 'a long text sits in its own section, so it isn’t a column and comes back in the notes');
  importer.run(again.records, { typeId: sameType.id, mapping: preview.columns.map(({ label, target }) => ({ label, target })) });
  const back = again.records.list(sameType.id).records.find((record) => record.title === 'Dawn Blade');
  const g = (name) => fieldNamed(sameType, name).id;
  assert.equal(back.label, 'W-001');
  assert.deepEqual([back.values[g('Material')], back.values[g('Weight')], back.values[g('Forged')], back.values[g('Cursed')]], ['Steel', 4.5, '1850-03-02', true]);
  assert.ok(plainText(again.records.get(back.id).notes).includes('Made in the north.'));
});
