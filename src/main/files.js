'use strict';
// The files kept with a project, and what can be done with them: look, move between sections and books, use a picture as a cover, or
// turn writing into a chapter or a record. A file is only ever read into memory here. Nothing is written out unencrypted: "Save a copy"
// is the one way out, and it's somewhere else.
const path = require('node:path');
const { SECTION_IDS } = require('../shared/sections');
const { plainText, countWords } = require('../shared/text');
const { imageSize, readSource, sectionsOf } = require('./import');
const { documentOf, wordsIn } = require('./import/split');

const MAX_PREVIEW = 30 * 1024 * 1024;
const MAX_READ = 200 * 1024 * 1024;
const MAX_SHOWN = 20000;
const PICTURES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const SOUNDS = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
const WRITING = new Set(['md', 'markdown', 'mdown', 'txt', 'text', 'rtf', 'html', 'htm', 'xhtml', 'docx', 'doc', 'epub', 'odt', 'pdf', 'pages']);
const HOLDERS = new Set(['project', 'series', 'book']);

const extensionOf = (name) => path.extname(name).slice(1).toLowerCase();

// What can be done with a file, going by its name, so the window only offers what will work.
function abilities(name) {
  const extension = extensionOf(name);
  return {
    look: PICTURES[extension] ? 'picture' : SOUNDS[extension] ? 'sound' : WRITING.has(extension) ? 'text' : '',
    writing: WRITING.has(extension),
    cover: extension === 'png' || extension === 'jpg' || extension === 'jpeg',
  };
}

class Files {
  constructor(workspace) {
    this.workspace = workspace;
  }

  get project() {
    return this.workspace.open();
  }

  need(id) {
    return this.project.attachment(String(id));
  }

  // Every file under a series, a book or the whole project, with the covers of the books there, and the places a file can be moved to.
  list(rootId) {
    const project = this.project;
    const root = project.getItem(String(rootId));
    if (!root) throw new Error("That isn't here any more.");
    const places = [];
    const covers = [];
    const walk = (node, depth) => {
      if (node.kind === 'series' || node.kind === 'book') places.push({ id: node.id, kind: node.kind, title: node.title, depth });
      for (const child of node.children) walk(child, depth + 1);
    };
    const outline = project.outline();
    places.push({ id: outline.id, kind: 'project', title: outline.title, depth: 0 });
    for (const child of outline.children) walk(child, 1);
    const within = new Set();
    const collect = (node, inside) => {
      const here = inside || node.id === root.id;
      if (here) within.add(node.id);
      node.children.forEach((child) => collect(child, here));
    };
    collect(outline, false);
    for (const place of places) {
      if (place.kind === 'book' && within.has(place.id) && project.cover(place.id)) covers.push({ bookId: place.id, book: place.title });
    }
    return { files: project.listAttachments(root.id).map((file) => ({ ...file, ...abilities(file.name) })), covers, places };
  }

  setSection(ids, section) {
    if (!SECTION_IDS.has(section)) throw new Error('That section isn’t known.');
    const project = this.project;
    project.db.transaction(() => {
      for (const id of ids) {
        const { file, size, type, from } = this.need(id);
        project.putItem({ id: String(id), details: JSON.stringify({ file, size, type, from, section }) });
      }
    })();
    return ids.length;
  }

  move(ids, parentId) {
    const project = this.project;
    const parent = project.getItem(String(parentId));
    if (!parent || !HOLDERS.has(parent.kind) || parent.trashedAt) throw new Error("Files can't be moved there.");
    project.db.transaction(() => {
      for (const id of ids) {
        if (this.need(id).parentId !== parent.id) project.moveItem(String(id), { parentId: parent.id });
      }
    })();
    return ids.length;
  }

  trash(ids) {
    const project = this.project;
    project.db.transaction(() => {
      for (const id of ids) {
        this.need(id);
        this.workspace.trashItem(String(id));
      }
    })();
    return ids.length;
  }

  // A look at a file: a picture, a sound to play, or the first part of what a document says.
  async preview(id) {
    const { file, size, name } = this.need(id);
    const extension = extensionOf(name);
    const { look } = abilities(name);
    if (!look) return { kind: 'none', why: 'This kind of file can’t be shown here. Save a copy to open it.' };
    if (size > MAX_PREVIEW) return { kind: 'none', why: 'It’s too big to show here. Save a copy to open it.' };
    const data = await this.project.attachments.read(file);
    if (look === 'picture') return { kind: 'picture', url: `data:${PICTURES[extension]};base64,${data.toString('base64')}` };
    if (look === 'sound') return { kind: 'sound', url: `data:${SOUNDS[extension]};base64,${data.toString('base64')}` };
    try {
      const source = await readSource(name, data);
      const text = source.sections
        ? source.sections.map((section) => `${section.title}\n\n${section.blocks ? plainText(JSON.stringify(documentOf(section.blocks))) : ''}`).join('\n\n')
        : plainText(JSON.stringify(documentOf(source.blocks)));
      return { kind: 'text', text: text.slice(0, MAX_SHOWN), words: countWords(text), cut: text.length > MAX_SHOWN };
    } catch (error) {
      return { kind: 'none', why: `It couldn’t be read: ${error.message}` };
    }
  }

  // A picture becomes its book's cover. The cover it takes the place of is kept with the book's covers, if it isn't there already.
  async useAsCover(id) {
    const attachment = this.need(id);
    const project = this.project;
    const book = this.bookOf(attachment.parentId);
    if (!book) throw new Error('Move the picture to a book first, then use it as that book’s cover.');
    if (!abilities(attachment.name).cover) throw new Error('A cover has to be a JPEG or PNG picture.');
    const data = await project.attachments.read(attachment.file);
    const size = imageSize(data);
    if (!size) throw new Error('That picture couldn’t be read.');
    const old = project.cover(book.id);
    if (old && !Buffer.from(old.data).equals(data)) await this.keepOldCover(book.id, old);
    project.db.transaction(() => {
      this.workspace.setCover(book.id, { type: PICTURES[extensionOf(attachment.name)], data, ...size });
      this.setSection([id], 'cover');
    })();
    return { bookId: book.id, book: book.title };
  }

  async keepOldCover(bookId, cover) {
    const project = this.project;
    const data = Buffer.from(cover.data);
    const sha = require('node:crypto').createHash('sha256').update(data).digest('hex');
    for (const file of project.listAttachments(bookId)) {
      const stored = project.attachment(file.id).file;
      if (project.db.prepare('SELECT 1 FROM attachment_files WHERE file = ? AND sha256 = ?').get(stored, sha)) return;
    }
    const extension = cover.type === 'image/png' ? 'png' : 'jpg';
    await project.addAttachment(bookId, { name: `Earlier cover.${extension}`, source: data, type: cover.type, section: 'cover' });
  }

  bookOf(id) {
    let item = this.project.getItem(id);
    while (item && item.kind !== 'book') item = item.parentId ? this.project.getItem(item.parentId) : null;
    return item;
  }

  async read(id) {
    const attachment = this.need(id);
    if (!abilities(attachment.name).writing) throw new Error('That isn’t a kind of writing this can read.');
    if (attachment.size > MAX_READ) throw new Error('That file is too big to read as writing.');
    const data = await this.project.attachments.read(attachment.file);
    const source = await readSource(attachment.name, data);
    const title = path.basename(attachment.name, path.extname(attachment.name)).replace(/_+/g, ' ').trim();
    return { attachment, source, title };
  }

  // Pictures inside a document go where the writing goes, so they're not left behind with the file.
  async keepPictures(source, parentId, from) {
    for (const picture of source.pictures ?? []) {
      await this.project.addAttachment(parentId, { name: picture.name, source: picture.data, type: picture.type, from });
    }
  }

  // The file's writing becomes chapters at the end of a book, split the way an import splits it. The file itself goes to the Trash.
  async makeChapter(id, bookId = null) {
    const { attachment, source, title } = await this.read(id);
    const project = this.project;
    const book = bookId ? project.getItem(String(bookId)) : this.bookOf(attachment.parentId);
    if (!book || book.kind !== 'book' || book.trashedAt) throw new Error('Choose the book it should go in.');
    const sections = sectionsOf(source, null, title);
    if (!sections.some((section) => section.type !== 'part' && wordsIn(section.blocks) > 0)) throw new Error('There are no words in that file.');
    let made;
    project.db.transaction(() => {
      made = this.workspace.importSections({ target: { kind: 'book', id: book.id }, sections, comments: source.comments, marks: source.context?.commentMarks });
      this.workspace.trashItem(String(id));
    })();
    await this.keepPictures(source, book.id, attachment.from || attachment.name);
    return { chapters: made.chapters, first: made.first, bookId: book.id, book: book.title, outline: this.workspace.outline() };
  }

  // The file's writing becomes a new record of a kind the author chooses, as its notes. The file itself goes to the Trash.
  async makeRecord(id, typeId) {
    const { attachment, source, title } = await this.read(id);
    const project = this.project;
    const blocks = source.sections ? source.sections.flatMap((section) => section.blocks ?? []) : source.blocks;
    if (!blocks?.length || wordsIn(blocks) === 0) throw new Error('There are no words in that file.');
    let record;
    project.db.transaction(() => {
      record = this.workspace.records.create({ typeId: String(typeId), title, notes: JSON.stringify(documentOf(blocks)) });
      this.workspace.trashItem(String(id));
    })();
    await this.keepPictures(source, attachment.parentId, attachment.from || attachment.name);
    return { id: record.id, title: record.title };
  }
}

module.exports = { Files, abilities };
