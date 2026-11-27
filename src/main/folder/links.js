'use strict';
// Which folders were chosen on this computer. A project carries the path of the folder it was brought in from, and a project can come
// from someone else, so a path in it is only ever looked at where it was chosen here. This keeps a mark of each such path, not the
// path itself, so a locked project's folder names aren't written down outside it.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeFileSafely } = require('../storage/keys');

const markOf = (root) => crypto.createHash('sha256').update(root).digest('hex');

class FolderLinks {
  constructor(directory) {
    this.file = path.join(directory, 'folder-links.json');
  }

  read() {
    try {
      const found = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return found?.links && typeof found.links === 'object' ? found.links : {};
    } catch {
      return {};
    }
  }

  has(projectId, importId, root) {
    return this.read()[`${projectId}/${importId}`] === markOf(root);
  }

  add(projectId, importId, root) {
    writeFileSafely(this.file, `${JSON.stringify({ links: { ...this.read(), [`${projectId}/${importId}`]: markOf(root) } }, null, 2)}\n`);
  }
}

module.exports = { FolderLinks };
