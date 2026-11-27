// Help Center and Keyboard Shortcuts: two simple pages in the app, one dialog. The Help Center's words are in ../shared/help-pages.js,
// and the Keyboard Shortcuts page is the same editor Preferences has (./shortcuts-editor.js).
import { HELP_TOPICS } from '../shared/help-pages.js';
import { el } from './dom.js';
import { createShortcutsEditor, stopShortcutCapture } from './shortcuts-editor.js';

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
  document.getElementById('preferences')?.remove();
  const body = el('div', { class: 'help-body' });
  const tabs = {
    center: el('button', { id: 'help-tab-center', class: 'mode-tab', onclick: () => show('center') }, 'Help Center'),
    shortcuts: el('button', { id: 'help-tab-shortcuts', class: 'mode-tab', onclick: () => show('shortcuts') }, 'Keyboard Shortcuts'),
  };
  const show = (which) => {
    body.querySelector('#shortcuts-page')?.stopListening();
    body.replaceChildren(which === 'shortcuts' ? createShortcutsEditor(api, dialog) : centerPage());
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
