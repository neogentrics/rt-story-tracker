'use strict';
// The chapters a file became: each one's ID, the title the file gave it, and the marks of its text as the file has it and as the app
// does. `app` is empty once the two are known to differ.
const { cleanTitle, toImported } = require('../workspace');
const { fingerprint } = require('./fingerprint');

const piece = (id, title, blocks, appBody) => ({
  id,
  title: cleanTitle(title, 'Untitled chapter'),
  folder: fingerprint(toImported(blocks)),
  app: appBody === undefined ? '' : fingerprint(appBody),
});

// `made` are the chapters, in the order of the sections that became them. Parts in the sections aren't chapters.
function piecesOf(project, made, sections) {
  const chapters = sections.filter((section) => section.type !== 'part');
  return made.map((chapter, at) => piece(chapter.id, chapters[at].title, chapters[at].blocks, project.getItem(chapter.id).body));
}

module.exports = { piece, piecesOf };
