// The Keyboard Shortcuts editor: every command that can have a key (../shared/shortcuts.js), with a way to change each one. Preferences
// shows it in its Shortcuts section and Help shows it as its Keyboard Shortcuts page. Both are this, and only one of those two windows is
// open at a time, so there's never a second copy holding old keys. A test builds the menu and checks it matches the list.
import { SHORTCUTS, checkKey, defaultKey, keyFromPress, resolveKeys, showKeys, withKey } from '../shared/shortcuts.js';
import { el, fill } from './dom.js';

const platform = /mac/i.test(navigator.platform) ? 'darwin' : 'win32';
const keyWords = (key) => (key ? showKeys(key, platform) : 'no key');

// Set while the Shortcuts page is listening for a key. Anything that takes the person elsewhere (a menu item, the lock) calls this, so
// the page can't go on swallowing keys, and the menu can't be left without its own.
let stopCurrent = null;
export const stopShortcutCapture = () => stopCurrent?.();

// The editor, for whichever window it's in. It reads what the author has set, shows each command's key, and listens for the new one after Change. While it
// listens the menu's own keys are off (so pressing one reaches here and doesn't run), and they come back when it stops.
export function createShortcutsEditor(api, dialog) {
  const page = el('div', { id: 'shortcuts-page' });
  const message = el('p', { id: 'shortcut-message', class: 'shortcut-message', role: 'status' });
  let overrides = {};
  let listening = null;
  let listener = null;

  const say = (text) => {
    message.textContent = text ?? '';
  };

  const stopListening = () => {
    if (!listening) return;
    document.removeEventListener('keydown', listener, true);
    window.removeEventListener('blur', leaveIt);
    stopCurrent = null;
    listening = null;
    listener = null;
    api.pauseShortcuts(false).catch(() => {});
  };

  // Stop listening and leave the command as it was.
  const leaveIt = () => {
    const item = SHORTCUTS.flatMap((group) => group.items).find((one) => one.id === listening);
    if (!item) return;
    stopListening();
    say(`Left ${item.does} as it was.`);
    draw(item.id);
  };

  const save = async (next, focusId) => {
    try {
      overrides = (await api.saveSettings({ shortcuts: next })).shortcuts ?? {};
    } catch (error) {
      say(`That couldn’t be saved: ${error.message}`);
    }
    draw(focusId);
  };

  const listen = (item) => {
    stopShortcutCapture();
    stopListening();
    listening = item.id;
    api.pauseShortcuts(true).catch(() => {});
    listener = async (event) => {
      // A window that has been taken away mustn't keep taking keys, and nor must this one once another has opened on top of it: the
      // key goes where it was typed.
      if (!page.isConnected) {
        stopListening();
        return;
      }
      if (event.target !== document.body && !dialog.contains(event.target)) {
        leaveIt();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        leaveIt();
        return;
      }
      const press = keyFromPress(event, platform);
      if (press.waiting) return;
      if (press.problem) {
        say(press.problem);
        return;
      }
      const verdict = checkKey(press.accelerator, item.id, overrides, platform);
      if (!verdict.ok) {
        say(verdict.reason);
        return;
      }
      stopListening();
      say(`${item.does} is now ${showKeys(press.accelerator, platform)}.`);
      await save(withKey(overrides, item.id, press.accelerator, platform), item.id);
    };
    document.addEventListener('keydown', listener, true);
    window.addEventListener('blur', leaveIt);
    stopCurrent = leaveIt;
    say(`Press the keys you want for ${item.does}. Escape leaves it as it is.`);
    draw(item.id);
  };

  // Back to the key it started with, unless another command has that key now.
  const reset = (item) => {
    stopListening();
    const original = defaultKey(item, platform);
    const verdict = original ? checkKey(original, item.id, overrides, platform) : { ok: true };
    if (!verdict.ok) {
      say(verdict.reason);
      draw(item.id);
      return;
    }
    say(`${item.does} is back to ${keyWords(original)}.`);
    save(withKey(overrides, item.id, original, platform), item.id);
  };

  const row = (item, keys) => {
    const key = keys[item.id];
    const changed = Object.hasOwn(overrides, item.id);
    const asking = listening === item.id;
    return [
      el('dt', {}, asking ? el('span', { class: 'shortcut-listening' }, 'Press the keys…') : key ? el('kbd', {}, showKeys(key, platform)) : el('span', { class: 'shortcut-none' }, 'No key')),
      el(
        'dd',
        { dataset: { shortcut: item.id } },
        el('span', { class: 'shortcut-does' }, item.does),
        el('span', { class: 'shortcut-actions' },
          el('button', { class: 'quiet', 'aria-label': `Change the shortcut for ${item.does}`, 'data-change': item.id, onclick: () => listen(item) }, 'Change'),
          changed
            ? el('button', { class: 'quiet', 'aria-label': `Reset the shortcut for ${item.does} to ${keyWords(defaultKey(item, platform))}`, 'data-reset': item.id, onclick: () => reset(item) }, 'Reset')
            : null),
      ),
    ];
  };

  function draw(focusId) {
    const keys = resolveKeys(overrides, platform);
    fill(
      page,
      el('p', { class: 'shortcut-note' }, 'Choose Change beside a command, then press the keys you would rather use. The keys for editing and formatting your writing, zoom and full screen stay as they are, so nothing here can get in the way of typing.'),
      message,
      SHORTCUTS.map((group) => el('section', { class: 'shortcut-group' }, el('h3', {}, group.group), el('dl', {}, group.items.flatMap((item) => row(item, keys))))),
      Object.keys(overrides).length
        ? el('p', {}, el('button', {
          id: 'shortcuts-reset-all',
          onclick: () => {
            stopListening();
            say('Every shortcut is back to its standard key.');
            save({}, null);
          },
        }, 'Reset all to the standard keys'))
        : null,
    );
    if (focusId) page.querySelector(`[data-change="${focusId}"]`)?.focus();
  }

  dialog.addEventListener('close', stopListening);
  dialog.addEventListener('cancel', (event) => {
    if (listening) event.preventDefault();
  });
  page.stopListening = stopListening;
  // The rows wait for the saved keys, so the page never shows, or checks against, keys that aren't the ones in use.
  api.settings().then((values) => {
    overrides = values.shortcuts ?? {};
    draw(null);
  }).catch((error) => {
    say(`Your shortcuts couldn’t be read: ${error.message}`);
    fill(page, message);
  });
  return page;
}
