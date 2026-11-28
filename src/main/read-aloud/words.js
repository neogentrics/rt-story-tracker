'use strict';
// What the shared speech engine says when something goes wrong, in this app's own plain words. The engine's messages are English and
// written for any app, and some carry file names or a library's own text, so none is shown as it comes. It's all here, so there's one
// place to translate when the app has more than one language.

// Not an error: the author skipped, paused or stopped, or the project closed.
const CANCELLED = 'cancelled';

const SPEAKING = [
  [/natural voices aren.t downloaded/i, 'not_downloaded', 'The natural voices aren’t on this computer yet. You can download them in Preferences, under Reading Aloud.'],
  [/couldn.t start|failed to load|no available backend|initwasm/i, 'cannot_start', 'The natural voices couldn’t start on this computer.'],
  [/stopped unexpectedly/i, 'stopped', 'The natural voice stopped.'],
  [/unknown voice|voices don.t fit together|nothing to blend/i, 'unknown_voice', 'That voice couldn’t be used. Choose another one.'],
  [/memory|bad_alloc|allocation/i, 'no_memory', 'There isn’t enough free memory for the natural voices. Close some other apps and try again.'],
];

const DOWNLOADING = [
  [/checksum|larger than expected/i, 'A file that arrived wasn’t the one expected, so it was thrown away. Try again.'],
  [/server answered (\d+)/i, 'The place the voices come from didn’t send them. Try again later.'],
  [/ENOSPC|no space/i, 'There isn’t enough free space on this computer. The voices need about 400 MB.'],
  [/EACCES|EPERM|EROFS/i, 'This computer wouldn’t let the app save the voices.'],
];

// `engine` is the engine's message. Gives { code, error }.
function speakingProblem(engine) {
  const text = String(engine ?? '');
  if (text === CANCELLED) return { code: CANCELLED, error: CANCELLED };
  const found = SPEAKING.find(([pattern]) => pattern.test(text));
  return found ? { code: found[1], error: found[2] } : { code: 'failed', error: 'The natural voice couldn’t read that sentence.' };
}

function downloadProblem(engine) {
  const text = String(engine ?? '');
  if (!text) return '';
  const found = DOWNLOADING.find(([pattern]) => pattern.test(text));
  return found ? found[1] : 'The voices couldn’t be downloaded. Check your internet connection and try again. What has already arrived is kept.';
}

module.exports = { CANCELLED, downloadProblem, speakingProblem };
