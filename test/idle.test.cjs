'use strict';
// When the idle timer may lock a project with a password: never while reading aloud or audio export is going, and counting again from
// when they stop. test/e2e/idle-lock.e2e.cjs holds the app to it.
const assert = require('node:assert/strict');
const test = require('node:test');
const { IdleClock, STALLED_AFTER_MS, stillGoing } = require('../src/shared/idle');
const { cleanSettings } = require('../src/shared/themes');

const MINUTE = 60000;
function clock() {
  let now = 1_000_000;
  const idle = new IdleClock(() => now);
  return { idle, pass: (minutes) => { now += minutes * MINUTE; } };
}

test('left alone for the time chosen, it’s time to lock, and not a moment before', () => {
  const { idle, pass } = clock();
  assert.equal(cleanSettings({}).lockAfter, 15, 'fifteen minutes unless the author chooses otherwise');
  pass(14.99);
  assert.equal(idle.due(15), false);
  pass(0.01);
  assert.equal(idle.due(15), true);
});

test('using the app starts the time again, and Never is never', () => {
  const { idle, pass } = clock();
  pass(14);
  idle.used();
  pass(14);
  assert.equal(idle.due(15), false);
  pass(600);
  assert.equal(idle.due(0), false);
});

test('while reading or an export is going it never locks, however long that is', () => {
  const { idle, pass } = clock();
  // The app looks every fifteen seconds. Ten hours of a book, with nobody touching anything.
  for (let look = 0; look < 10 * 60 * 4; look += 1) {
    pass(0.25);
    assert.equal(idle.due(15, true), false);
  }
  assert.equal(idle.due(5, true), false, 'with the shortest time too');
});

test('when it stops, the time counts again from then', () => {
  const { idle, pass } = clock();
  pass(40);
  assert.equal(idle.due(15, true), false);
  // Stopped. The app is told at once, so the count starts at that moment and not at the last look before it.
  pass(0.2);
  idle.used();
  pass(14.9);
  assert.equal(idle.due(15, false), false);
  pass(0.1);
  assert.equal(idle.due(15, false), true);
});

test('only something that’s getting somewhere counts, so a voice that hangs can’t hold a project open', () => {
  assert.equal(STALLED_AFTER_MS, 15 * MINUTE);
  const now = 5_000_000;
  assert.equal(stillGoing(now, now), true);
  assert.equal(stillGoing(now - 14.9 * MINUTE, now), true);
  assert.equal(stillGoing(now - 15 * MINUTE, now), false);
});
