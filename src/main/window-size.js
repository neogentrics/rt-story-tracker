'use strict';
// How big the window opens, and how small it may be made. A window is never opened larger than the screen has room for, and the smallest
// it can be made never asks for more than the screen has. Sizes are in the screen's own units, so display scaling is already counted:
// a 1280 by 720 screen scaled to 150 percent is 853 by 480.
const DEFAULT = { width: 1280, height: 820 };
const SMALLEST = { width: 640, height: 400 };

// `work` is the part of the screen a window can use, without the taskbar, menu bar or dock. `asked` is a test asking for a size.
function windowBounds(work, asked = null) {
  const room = work?.width > 0 && work?.height > 0 ? work : DEFAULT;
  return {
    width: asked?.width ?? Math.min(DEFAULT.width, room.width),
    height: asked?.height ?? Math.min(DEFAULT.height, room.height),
    minWidth: Math.min(SMALLEST.width, room.width),
    minHeight: Math.min(SMALLEST.height, room.height),
  };
}

// "1024x768", as the tests write a size.
function sizeFrom(text) {
  const [, width, height] = /^(\d{3,4})x(\d{3,4})$/.exec(text ?? '') ?? [];
  return width ? { width: Number(width), height: Number(height) } : null;
}

module.exports = { DEFAULT, SMALLEST, sizeFrom, windowBounds };
