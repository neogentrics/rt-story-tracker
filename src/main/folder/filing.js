'use strict';
// Which section a file belongs in, from its type, its name and the folders it came from. It's a plain function of those, so it works
// the same for a file being brought in and for one that was brought in before there were sections. "Other files" is only for a type
// this doesn't know.
const signs = require('./signs');

// Types Find my files doesn't read as writing, pictures or sound, which still have an obvious home.
const ALSO = new Map(Object.entries({
  picture: ['avif', 'jfif', 'heif'],
  audio: ['aif', 'aiff', 'wma', 'opus'],
  video: ['m4v', 'wmv', 'mpg', 'mpeg'],
  writing: ['doc', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp'],
}).flatMap(([kind, list]) => list.map((extension) => [extension, kind])));
const COVER_WORD = /\bcovers?\b/i;

// `name` is the file's own name, which says its type. `from` is where it came from, "Book 1/Covers/Front.png", which says its
// folders. For a picture taken out of a document, `from` is the document.
function sectionOf(name, from = '') {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const stem = signs.tidy(dot > 0 ? name.slice(0, dot) : name);
  const folders = String(from ?? '').split('/').slice(0, -1).map(signs.tidy);
  const kind = ALSO.get(extension) ?? signs.kindOf(extension);
  if (kind === 'audio') return 'audio';
  if (kind === 'video') return 'video';
  if (kind === 'picture') return COVER_WORD.test(stem) || folders.some((folder) => COVER_WORD.test(folder)) ? 'cover' : 'art';
  if (kind === 'published') return 'finished';
  if (kind === 'writing') return folders.some((folder) => signs.FINISHED_FOLDER.test(folder)) ? 'finished' : 'notes';
  return 'other';
}

module.exports = { sectionOf };
