'use strict';
// What the window can ask of read aloud: the voices, one sentence at a time, the project's pronunciation list, and the file an audio
// export is written into. `unlocked` is the same password check every other export goes through.
const { FORMATS } = require('./audio-files');

const REMOVE = {
  type: 'question',
  title: 'Natural voices',
  message: 'Remove the natural voices?',
  detail: 'This frees the space they use. Your computer’s own voices stay, and you can download the natural ones again at any time.',
  buttons: ['Remove', 'Cancel'],
};

function registerReadAloud({ handle, unlocked, readAloud, audioFiles, workspace, dialog, shell, window, safeName }) {
  const choose = async (box, safe) => (await dialog.showMessageBox(window(), { noLink: true, defaultId: safe, cancelId: safe, ...box })).response;

  handle('voice:status', () => readAloud().status());
  // Cancel is the button chosen by Enter and Escape, so nothing is downloaded, or agreed to, by accident.
  handle('voice:install', () => readAloud().install({
    ask: (terms) => choose({ type: 'question', ...terms }, terms.buttons.length - 1),
    openLicence: (url) => shell.openExternal(url),
    onProgress: (status) => window()?.webContents.send('voice:progress', status),
  }));
  handle('voice:cancelDownload', () => readAloud().cancelDownload());
  handle('voice:remove', async () => ((await choose(REMOVE, 1)) === 0 ? readAloud().remove() : readAloud().status()));
  handle('voice:speak', (job) => readAloud().speak(job ?? {}));
  handle('voice:cancel', () => readAloud().cancel());

  handle('reading:words', () => workspace().open().pronunciations());
  handle('reading:saveWords', (list) => workspace().open().savePronunciations(list));

  handle('audio:begin', unlocked(async ({ format, name } = {}) => {
    if (!Object.hasOwn(FORMATS, format)) throw new Error('That kind of audio file isn’t known.');
    const project = workspace().open();
    const { extension, name: kind } = FORMATS[format];
    const { canceled, filePath } = await dialog.showSaveDialog(window(), {
      title: 'Export as audio',
      defaultPath: `${safeName(name)}.${extension}`,
      filters: [{ name: kind, extensions: [extension] }],
    });
    if (canceled || !filePath) return null;
    // The dialog can stay open a long while, and the project may have locked behind it.
    if (workspace().project !== project) throw new Error('The project was closed.');
    return audioFiles().begin(filePath);
  }));
  handle('audio:write', (id, data) => audioFiles().write(String(id), data));
  handle('audio:finish', (id, end) => audioFiles().finish(String(id), end));
  handle('audio:cancel', (id) => audioFiles().abandon(String(id)));
}

module.exports = { registerReadAloud };
