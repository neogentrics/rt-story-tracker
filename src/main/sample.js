'use strict';
// The sample project: a short made-up story, written for this app, that shows what a book looks like in it.

const paragraph = (...content) => ({ type: 'paragraph', content });
const text = (value, ...marks) => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const plain = (value) => paragraph(text(value));
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const doc = (...content) => JSON.stringify({ type: 'doc', content });
// A name that links to its record. The words stay in the text; the mark only says which record it is.
const named = (id, value) => ({ type: 'text', text: value, marks: [{ type: 'mention', attrs: { id } }] });

const SAMPLE_TITLE = 'Sample: The Salt Road';

const chapters = ({ marit, mule }) => [
  {
    part: 'Part One: Leaving',
    title: 'The Ledger',
    body: doc(
      paragraph(named(marit, 'Marit'), text(' found the ledger under the third stair, which was the stair that had always complained.')),
      paragraph(
        text('The first page held a single line in her grandmother’s hand: '),
        text('Everything owed is written here.', 'italic'),
      ),
      plain('The rest held names, and most of them she knew. The baker. The ferryman. Her own father, twice.'),
      plain('She read until the lamp ran low, then packed the book in her coat and went to wake the mule.'),
    ),
  },
  {
    part: 'Part One: Leaving',
    title: 'The Mule',
    body: doc(
      paragraph(text('The '), named(mule, 'mule'), text(' took the news badly.')),
      plain('It stood in the yard with its ears back while she tied on the bags. It had walked the Salt Road once, years ago, and had made up its mind about the experience.'),
      paragraph(text('“Seven names,” '), named(marit, 'Marit'), text(' told it. “Seven doors, and then we come home.”')),
      plain('The mule breathed out through its nose. Neither of them believed her.'),
    ),
  },
  {
    part: 'Part Two: Try It Yourself',
    title: 'Your Turn',
    body: doc(
      heading(2, 'This chapter is yours'),
      plain('Type anywhere on this page. It saves by itself every few seconds, so there’s no Save button to remember.'),
      paragraph(
        text('Select some words to make them '),
        text('bold', 'bold'),
        text(' or '),
        text('italic', 'italic'),
        text(', or use the buttons above the page.'),
      ),
      plain('If you like Markdown, it works here too. Start a new line with # and a space for a heading, or - and a space for a list.'),
      plain('Drag a chapter in the list to move it. Double-click its name to rename it. When you’re done with this sample, you can remove it from the library.'),
      plain('Look at the names in the first two chapters: they’re linked to records. Press Ctrl or Cmd and click one to look it up beside the page, or open Records at the top to see everything that’s kept about it. Type @ and a name to link one of your own.'),
    ),
  },
];

// Two records to show what Records is for, made before the chapters so the chapters can link to them.
function fillSampleRecords(records) {
  const type = records.createType({
    title: 'Character',
    fields: [
      { name: 'Role', kind: 'choice', options: ['Main', 'Companion', 'Minor'] },
      { name: 'Wants', kind: 'longtext' },
    ],
  });
  const [role, wants] = type.fields;
  const notes = (value) => JSON.stringify({ type: 'doc', content: [plain(value)] });
  const marit = records.create({
    typeId: type.id,
    title: 'Marit',
    values: { [role.id]: 'Main', [wants.id]: 'To find the seven names in the ledger, and to bring her father home.' },
    notes: notes('Keeps her grandmother’s ledger in her coat.'),
  });
  const mule = records.create({
    typeId: type.id,
    title: 'The mule',
    values: { [role.id]: 'Companion', [wants.id]: 'To stay in the yard.' },
    notes: notes('Has walked the Salt Road once and made up its mind about it.'),
  });
  return { marit: marit.id, mule: mule.id };
}

function fillSample(project, records) {
  const ids = fillSampleRecords(records);
  const book = project.addItem({ kind: 'book', parentId: project.id, title: 'The Salt Road' });
  const parts = new Map();
  for (const chapter of chapters(ids)) {
    if (!parts.has(chapter.part)) {
      parts.set(chapter.part, project.addItem({ kind: 'part', parentId: book.id, title: chapter.part }));
    }
    project.addItem({
      kind: 'chapter',
      parentId: parts.get(chapter.part).id,
      title: chapter.title,
      body: chapter.body,
    });
  }
}

module.exports = { SAMPLE_TITLE, fillSample };
