// Help Center and Keyboard Shortcuts: two simple pages in the app, one dialog. The words are in ../shared/help-pages.js, and the
// shortcuts there are checked against the menu by a test, so the page can't say a key does something it doesn't.
import { HELP_TOPICS, SHORTCUTS, showKeys } from '../shared/help-pages.js';
import { el } from './dom.js';

const platform = /mac/i.test(navigator.platform) ? 'darwin' : 'win32';

function shortcutsPage() {
  return el(
    'div',
    { id: 'shortcuts-page' },
    SHORTCUTS.map((group) => el(
      'section',
      { class: 'shortcut-group' },
      el('h3', {}, group.group),
      el('dl', {}, group.items.flatMap((item) => [el('dt', {}, el('kbd', {}, showKeys(item, platform))), el('dd', {}, item.does)])),
    )),
  );
}

function centerPage() {
  return el(
    'div',
    { id: 'help-page' },
    HELP_TOPICS.map((topic) => el('section', { class: 'help-topic', id: `help-${topic.id}` }, el('h3', {}, topic.title), topic.body.map((text) => el('p', {}, text)))),
  );
}

// `page` is 'center' or 'shortcuts'. The other is one click away.
export function openHelp({ page = 'center' } = {}) {
  document.getElementById('help-dialog')?.remove();
  const body = el('div', { class: 'help-body' });
  const tabs = {
    center: el('button', { id: 'help-tab-center', class: 'mode-tab', onclick: () => show('center') }, 'Help Center'),
    shortcuts: el('button', { id: 'help-tab-shortcuts', class: 'mode-tab', onclick: () => show('shortcuts') }, 'Keyboard Shortcuts'),
  };
  const show = (which) => {
    body.replaceChildren(which === 'shortcuts' ? shortcutsPage() : centerPage());
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
