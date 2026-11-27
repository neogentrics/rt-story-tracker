'use strict';
// The size the window opens at, on big screens and small ones.
const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT, SMALLEST, sizeFrom, windowBounds } = require('../src/main/window-size');

test('on a roomy screen the window opens at its usual size', () => {
  assert.deepEqual(windowBounds({ width: 1920, height: 1040 }), { width: 1280, height: 820, minWidth: 640, minHeight: 400 });
});

test('it never opens larger than the screen has room for', () => {
  for (const work of [{ width: 1024, height: 560 }, { width: 1024, height: 528 }, { width: 1280, height: 672 }, { width: 853, height: 440 }, { width: 800, height: 560 }, { width: 600, height: 360 }]) {
    const bounds = windowBounds(work);
    assert.ok(bounds.width <= work.width && bounds.height <= work.height, `${work.width}x${work.height}: opened ${bounds.width}x${bounds.height}`);
    assert.ok(bounds.minWidth <= work.width && bounds.minHeight <= work.height, 'and the smallest it can be made fits too');
    assert.ok(bounds.minWidth <= bounds.width && bounds.minHeight <= bounds.height);
  }
  assert.deepEqual(windowBounds({ width: 600, height: 360 }), { width: 600, height: 360, minWidth: 600, minHeight: 360 }, 'a screen smaller than the smallest gets all of itself');
});

test('the smallest window suits a small laptop at 150 percent', () => {
  // 1280 by 720 at 150 percent is 853 by 480, less a taskbar.
  assert.ok(SMALLEST.width <= 853 && SMALLEST.height <= 440);
});

test('a screen that can’t be read gets the usual size, and a test can ask for its own', () => {
  assert.deepEqual([windowBounds(undefined).width, windowBounds({ width: 0, height: 0 }).height], [DEFAULT.width, DEFAULT.height]);
  assert.deepEqual(windowBounds({ width: 1920, height: 1040 }, { width: 900, height: 560 }), { width: 900, height: 560, minWidth: 640, minHeight: 400 });
  assert.deepEqual(sizeFrom('1024x768'), { width: 1024, height: 768 });
  for (const odd of ['', undefined, '1024', 'big', '99999x1']) assert.equal(sizeFrom(odd), null);
});
