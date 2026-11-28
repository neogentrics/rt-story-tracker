'use strict';
// When the idle timer may lock a project that has a password. Reading aloud and making audio count as using the app (the owner's
// decision, 28 November 2026), so the timer never locks while either is going: a listener may touch nothing for as long as a book
// lasts. When they stop, it counts again from then. Lock Project, locking the computer and sleep don't come through here, and still lock.

// "Going" has to mean getting somewhere. A voice can hang without ever saying so, and that mustn't hold a project open for good. So
// reading, or an export, that hasn't got a step further in this long no longer counts.
const STALLED_AFTER_MS = 15 * 60 * 1000;

// Whether something that last got a step further at `lastStep` is still going.
const stillGoing = (lastStep, now = Date.now()) => now - lastStep < STALLED_AFTER_MS;

class IdleClock {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.lastUsed = now();
  }

  used() {
    this.lastUsed = this.now();
  }

  // True when it's time to lock. `minutes` is the author's setting, 0 for never. `inUse` says reading or an export is going.
  due(minutes, inUse = false) {
    if (inUse) {
      this.used();
      return false;
    }
    return Boolean(minutes) && this.now() - this.lastUsed >= minutes * 60000;
  }
}

module.exports = { IdleClock, STALLED_AFTER_MS, stillGoing };
