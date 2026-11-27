'use strict';
// The two lists: which rows show when something is folded, duplicating a book or a chapter, and the menu for a right-click in text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { contextTemplate } = require('../src/main/context-menu');
const { holdersOf, visibleRows } = require('../src/shared/outline');
const { Library } = require('../src/main/storage/library');
const { Workspace } = require('../src/main/workspace');
const { plainText } = require('../src/shared/text');

const dirs = [];
const spaces = [];
test.after(() => {
  spaces.forEach((space) => space.closeProject());
  dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
});
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-lists-'));
  dirs.push(dir);
  const space = new Workspace(new Library(path.join(dir, 'library')));
  spaces.push(space);
  const { outline } = space.createProject('Lists');
  return { space, projectId: outline.id, bookId: outline.children[0].id, chapterId: outline.children[0].children[0].id };
}
const node = (id, kind, ...children) => ({ id, kind, title: id, children });
const tree = node('p', 'project',
  node('s', 'series', node('b1', 'book', node('c1', 'chapter')), node('b2', 'book')),
  node('b3', 'book', node('part', 'part', node('c2', 'chapter')), node('c3', 'chapter')));
const shown = (rows) => rows.map(({ node: one, depth }) => `${'.'.repeat(depth)}${one.id}`);
const books = (one) => one.kind === 'book';

test('a folded series or part hides what’s inside it, at any depth', () => {
  assert.deepEqual(shown(visibleRows(tree.children, { closed: books })), ['s', '.b1', '.b2', 'b3']);
  assert.deepEqual(shown(visibleRows(tree.children, { closed: books, folded: new Set(['s']) })), ['s', 'b3']);
  const chapters = tree.children[1].children;
  assert.deepEqual(shown(visibleRows(chapters)), ['part', '.c2', 'c3']);
  assert.deepEqual(shown(visibleRows(chapters, { folded: new Set(['part', 'gone']) })), ['part', 'c3']);
});

test('what a row is inside is what has to be opened to show it', () => {
  assert.deepEqual(holdersOf(tree, 'c1'), ['b1', 's']);
  assert.deepEqual(holdersOf(tree, 'c2'), ['part', 'b3']);
  assert.deepEqual(holdersOf(tree, 'b3'), []);
  assert.deepEqual(holdersOf(tree, 'nothing'), []);
});

const doc = (text, commentId) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(commentId ? { marks: [{ type: 'comment', attrs: { id: commentId } }] } : {}) }] }] });

test('a duplicated chapter comes straight after it, with its writing and its own copies of the comments', () => {
  const { space, bookId, chapterId } = project();
  const after = space.addItem({ kind: 'chapter', parentId: bookId, title: 'Last' }).item.id;
  const comment = space.addComment({ chapterId, text: 'Check this.' });
  space.saveChapter({ id: chapterId, title: 'First', body: doc('Words with a note.', comment.id) });
  space.setGoal({ id: chapterId, goal: 500 });
  const today = space.progress().today;
  const made = space.duplicate(chapterId);
  assert.deepEqual(made.outline.children[0].children.map((one) => one.title), ['First', 'First (copy)', 'Last']);
  assert.equal(plainText(space.loadChapter(made.id).body), 'Words with a note.');
  assert.equal(space.loadChapter(made.id).goal, 500);
  const [theirs] = space.listComments(made.id);
  assert.equal(theirs.text, 'Check this.');
  assert.notEqual(theirs.id, comment.id);
  assert.ok(space.loadChapter(made.id).body.includes(theirs.id) && !space.loadChapter(made.id).body.includes(comment.id), 'the copy’s words are marked with the copy’s comment');
  assert.ok(space.loadChapter(chapterId).body.includes(comment.id), 'and the first chapter is as it was');
  space.editComment({ id: theirs.id, text: 'Changed in the copy.' });
  assert.equal(space.listComments(chapterId)[0].text, 'Check this.');
  assert.equal(space.progress().today, today, 'copying isn’t writing');
  assert.equal(space.listVersions(made.id).length, 0);
  assert.equal(made.filesLeft, 0);
  assert.ok(after);
});

test('a duplicated book brings its parts, chapters, details and cover, leaves out what’s in the Trash, and says how many files stayed', async () => {
  const { space, bookId, chapterId } = project();
  space.saveChapter({ id: chapterId, title: 'Opening', body: doc('Once.') });
  const part = space.addItem({ kind: 'part', parentId: bookId, title: 'Part Two' }).item.id;
  const inside = space.addItem({ kind: 'chapter', parentId: part, title: 'Inside' }).item.id;
  space.saveChapter({ id: inside, title: 'Inside', body: doc('Twice.') });
  const gone = space.addItem({ kind: 'chapter', parentId: bookId, title: 'Thrown away' }).item.id;
  space.trashItem(gone);
  space.saveDetails({ id: bookId, details: { author: 'A. Writer', subtitle: 'A tale' } });
  space.setCover(bookId, { type: 'image/png', data: Buffer.from('picture'), width: 1, height: 1 });
  await space.project.addAttachment(bookId, { name: 'map.png', source: Buffer.from('map') });
  const made = space.duplicate(bookId);
  const [first, second] = made.outline.children;
  assert.deepEqual([first.id, second.id, second.title], [bookId, made.id, `${first.title} (copy)`]);
  assert.deepEqual(second.children.map((one) => one.title), ['Opening', 'Part Two']);
  assert.deepEqual(second.children[1].children.map((one) => one.title), ['Inside']);
  assert.equal(second.words, 2);
  assert.equal(space.getDetails(made.id).details.subtitle, 'A tale');
  assert.equal(Buffer.from(space.project.cover(made.id).data).toString(), 'picture');
  assert.equal(made.filesLeft, 1);
  assert.equal(space.listAttachments(made.id).length, 0);
});

test('only a book or a chapter can be duplicated, and not from the Trash', () => {
  const { space, projectId, bookId, chapterId } = project();
  const series = space.addItem({ kind: 'series', parentId: projectId, title: 'S' }).item.id;
  for (const id of [projectId, series]) assert.throws(() => space.duplicate(id), /Only a book or a chapter/);
  space.trashItem(chapterId);
  assert.throws(() => space.duplicate(chapterId), /Trash/);
  assert.ok(bookId);
});

test('a right-click in text offers what fits where it was', () => {
  const calls = [];
  const hooks = { replace: (word) => calls.push(['replace', word]), learn: (word) => calls.push(['learn', word]), send: (command) => calls.push(['send', command]) };
  const flags = { canCut: true, canCopy: true, canPaste: false };
  const names = (template) => template.map((item) => item.label ?? item.role ?? '-');

  // Nothing to type in and nothing selected: no menu. With words selected, they can be copied.
  assert.deepEqual(contextTemplate({ isEditable: false, selectionText: '', editFlags: flags }, hooks), []);
  assert.deepEqual(names(contextTemplate({ isEditable: false, selectionText: 'a word', editFlags: flags }, hooks)), ['copy']);

  // A field to type in has the usual four, without what only the writing page can do.
  const field = contextTemplate({ isEditable: true, selectionText: '', editFlags: flags, dictionarySuggestions: [] }, hooks);
  assert.deepEqual(names(field), ['cut', 'copy', 'paste', '-', 'selectAll']);
  assert.equal(field[2].enabled, false);

  // The writing page keeps those, and adds a comment, which needs words selected, and find and replace.
  const page = contextTemplate({ isEditable: true, selectionText: 'teh', misspelledWord: 'teh', dictionarySuggestions: ['the'], editFlags: flags }, { ...hooks, onPage: true });
  assert.deepEqual(names(page), ['the', 'Add “teh” to Dictionary', '-', 'cut', 'copy', 'paste', '-', 'selectAll', '-', 'Comment on the Selected Words', 'Find and Replace…']);
  for (const label of ['the', 'Add “teh” to Dictionary', 'Comment on the Selected Words', 'Find and Replace…']) page.find((item) => item.label === label).click();
  assert.deepEqual(calls, [['replace', 'the'], ['learn', 'teh'], ['send', 'context-comment'], ['send', 'replace']]);
  const empty = contextTemplate({ isEditable: true, selectionText: '  ', editFlags: flags }, { ...hooks, onPage: true });
  assert.equal(empty.find((item) => item.label === 'Comment on the Selected Words').enabled, false);
});
