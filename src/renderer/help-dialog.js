// Help Center and Keyboard Shortcuts: two simple pages in the app, one dialog. The words are in ../shared/help-pages.js, and the
// shortcuts there are checked against the menu by a test, so the page can't say a key does something it doesn't.
// Help Center and Keyboard Shortcuts: two simple pages in the app, one dialog. The Help Center's words are in ../shared/help-pages.js.
// The Shortcuts page is the list of every command that can have a key (../shared/shortcuts.js), with a way to change each one. A test
// builds the menu and checks it matches that list, so the page can't say a key does something it doesn't.
import { HELP_TOPICS } from '../shared/help-pages.js';
import { SHORTCUTS, checkKey, defaultKey, keyFromPress, resolveKeys, showKeys, withKey } from '../shared/shortcuts.js';
import { el, fill } from './dom.js';

const platform = /mac/i.test(navigator.platform) ? 'darwin' : 'win32';
const keyWords = (key) => (key ? showKeys(key, platform) : 'no key');

// Set while the Shortcuts page is listening for a key. Anything that takes the person elsewhere (a menu item, the lock) calls this, so
// the page can't go on swallowing keys, and the menu can't be left without its own.
let stopCurrent = null;
export const stopShortcutCapture = () => stopCurrent?.();

// The Shortcuts page. It reads what the author has set, shows each command's key, and listens for the new one after Change. While it
// listens the menu's own keys are off (so pressing one reaches here and doesn't run), and they come back when it stops.
function shortcutsPage(api, dialog) {
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
    stopListening();
    listening = item.id;
    api.pauseShortcuts(true).catch(() => {});
    listener = async (event) => {
      // A window that has been taken away mustn't keep taking keys.
      if (!page.isConnected) {
        stopListening();
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
      el('p', { class: 'shortcut-note' }, 'Choose Change beside a command, then press the keys you would rather use. Keys for copying, pasting, undoing, zoom and full screen stay as they are, so nothing here can get in the way of typing.'),
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
  draw(null);
  api.settings().then((values) => {
    overrides = values.shortcuts ?? {};
    draw(null);
  }).catch(() => {});
  return page;
}

function centerPage() {
  return el(
    'div',
    { id: 'help-page' },
    HELP_TOPICS.map((topic) => el('section', { class: 'help-topic', id: `help-${topic.id}` }, el('h3', {}, topic.title), topic.body.map((text) => el('p', {}, text)))),
  );
}

// `page` is 'center' or 'shortcuts'. The other is one click away.
export function openHelp({ page = 'center', api } = {}) {
  stopShortcutCapture();
  document.getElementById('help-dialog')?.remove();
  const body = el('div', { class: 'help-body' });
  const tabs = {
    center: el('button', { id: 'help-tab-center', class: 'mode-tab', onclick: () => show('center') }, 'Help Center'),
    shortcuts: el('button', { id: 'help-tab-shortcuts', class: 'mode-tab', onclick: () => show('shortcuts') }, 'Keyboard Shortcuts'),
  };
  const show = (which) => {
    body.querySelector('#shortcuts-page')?.stopListening();
    body.replaceChildren(which === 'shortcuts' ? shortcutsPage(api, dialog) : centerPage());
    for (const [name, tab] of Object.entries(tabs)) {
      tab.classList.toggle('active', name === which);
      tab.setAttribute('aria-pressed', String(name === which));
    }
    body.scrollTop = 0;
  };
  const dialog = el(
    'dialog',
    { id: 'help-dialog', class: 'dialog help-dialog', 'aria-label': 'Help' },
    el('div', { class: 'help-head' }, el('div', { class: 'mode-tabs', role: 'group', 'aria-label': 'Help' }, tabs.center, tabs.shortcuts)),
    body,
    el('div', { class: 'dialog-actions' }, el('button', { id: 'help-done', class: 'primary', onclick: () => dialog.close() }, 'Done')),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  show(page);
  dialog.showModal();
}
