'use strict';
// The author's settings for this computer. They aren't inside any project, so a project looks right wherever it opens.
const fs = require('node:fs');
const path = require('node:path');
const { cleanSettings } = require('../shared/themes');
const { writeFileSafely } = require('./storage/keys');

class Settings {
  constructor(root) {
    this.file = path.join(root, 'settings.json');
    this.values = cleanSettings(this.read());
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  save(changes) {
    // Read aloud's settings are several, and a change names only the ones it changes.
    const readAloud = changes?.readAloud ? { readAloud: { ...this.values.readAloud, ...changes.readAloud } } : {};
    this.values = cleanSettings({ ...this.values, ...changes, ...readAloud });
    writeFileSafely(this.file, `${JSON.stringify(this.values, null, 2)}\n`);
    return this.values;
  }
}

module.exports = { Settings };
