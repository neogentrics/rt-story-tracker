'use strict';
// The file an audio export is written into. The window makes the sound, and this only writes the bytes it's sent to the one file the
// author chose in the system's own dialog. The file takes its name once it's whole. An export that's stopped, or whose project closes
// or locks, leaves nothing behind. Audio isn't encrypted, so starting one takes the same password check as any other export (ipc.js).
const crypto = require('node:crypto');
const fs = require('node:fs');

const FORMATS = { mp3: { name: 'MP3 audio', extension: 'mp3' }, m4b: { name: 'Audiobook', extension: 'm4b' } };
const MOST_AT_ONCE = 32 * 1024 * 1024;
const STOPPED = 'The audio export stopped, so no file was made.';

class AudioFiles {
  constructor() {
    this.jobs = new Map();
  }

  begin(file) {
    const id = crypto.randomUUID();
    const part = `${file}.part`;
    this.jobs.set(id, { file, part, handle: fs.openSync(part, 'w'), size: 0 });
    return id;
  }

  need(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(STOPPED);
    return job;
  }

  static bytes(data) {
    if (!(data instanceof Uint8Array) || data.byteLength > MOST_AT_ONCE) throw new Error('That isn’t audio.');
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  write(id, data) {
    const job = this.need(id);
    const bytes = AudioFiles.bytes(data);
    fs.writeSync(job.handle, bytes, 0, bytes.length, job.size);
    job.size += bytes.length;
  }

  // `tail` goes on the end. `patches` fill in what could only be known at the end, inside what's already written.
  finish(id, { tail = new Uint8Array(0), patches = [] } = {}) {
    const job = this.need(id);
    this.write(id, tail);
    for (const patch of patches) {
      const bytes = AudioFiles.bytes(patch.bytes);
      if (!Number.isInteger(patch.at) || patch.at < 0 || patch.at + bytes.length > job.size) throw new Error('That isn’t audio.');
      fs.writeSync(job.handle, bytes, 0, bytes.length, patch.at);
    }
    fs.fsyncSync(job.handle);
    fs.closeSync(job.handle);
    this.jobs.delete(id);
    fs.renameSync(job.part, job.file);
    return job.file;
  }

  abandon(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    try {
      fs.closeSync(job.handle);
    } finally {
      fs.rmSync(job.part, { force: true, maxRetries: 3 });
    }
  }

  abandonAll() {
    for (const id of [...this.jobs.keys()]) this.abandon(id);
  }
}

module.exports = { AudioFiles, FORMATS, STOPPED };
