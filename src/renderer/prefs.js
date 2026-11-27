import { BACKUP_EVERY, LIMITS, LOCK_AFTER, PAGE_FONTS, THEMES, UI_FONTS } from '../shared/themes.js';
import { createAppsPanel } from './apps-panel.js';
import { el } from './dom.js';
import { openHelp } from './help-dialog.js';
import { icon } from './icons.js';
import { applyLook } from './look.js';
import { createShortcutsEditor, stopShortcutCapture } from './shortcuts-editor.js';

function field(label, control) {
  return el('label', { class: 'field' }, el('span', {}, label), control);
}

function select(id, options, value, onChange) {
  const control = el(
    'select',
    { id, onchange: () => onChange(control.value) },
    Object.entries(options).map(([key, option]) => el('option', { value: key }, option.label)),
  );
  control.value = value;
  return control;
}

function range(id, name, value, onChange) {
  const [min, max] = LIMITS[name];
  const control = el('input', { id, type: 'range', min: String(min), max: String(max), step: '1', value: String(value) });
  control.addEventListener('input', () => onChange(Number(control.value)));
  return control;
}

function wordRow(word, onRemove) {
  return el(
    'li',
    { class: 'word-row' },
    el('span', {}, word),
    el('button', { class: 'quiet', 'aria-label': `Remove ${word}`, onclick: () => onRemove(word) }, 'Remove'),
  );
}

// Preferences is a window with its sections listed on the left and the chosen section's settings on the right, as RT Markdown Reader's
// is. It's sized to the app window, and only the right side scrolls. Everything changes as it's picked, so there's nothing to apply and
// nothing to lose.
export async function openPreferences(api, { section = 'general' } = {}) {
  stopShortcutCapture();
  document.getElementById('help-dialog')?.remove();
  document.getElementById('preferences')?.remove();
  let settings = await api.settings();
  const { version } = await api.status();
  const change = async (name, value) => {
    settings = await api.saveSettings({ [name]: value });
    applyLook(settings);
  };

  const words = el('ul', { id: 'dictionary-words', class: 'word-list' });
  const showWords = async () => {
    const list = await api.dictionary();
    words.replaceChildren(
      ...(list.length ? list.map((word) => wordRow(word, removeWord)) : [el('li', { class: 'quiet-note' }, 'No words yet.')]),
    );
  };
  const removeWord = async (word) => {
    await api.removeWord(word);
    await showWords();
  };
  const newWord = el('input', { id: 'new-word', type: 'text', placeholder: 'A name or word', 'aria-label': 'Word to add' });
  const addWord = async (event) => {
    event.preventDefault();
    if (!newWord.value.trim()) return;
    await api.addWord(newWord.value.trim());
    newWord.value = '';
    await showWords();
  };

  const folder = el('span', { id: 'backup-folder', class: 'backup-folder' });
  const backupNote = el('p', { id: 'backup-note', class: 'quiet-note', role: 'status' });
  const showBackups = async () => {
    folder.textContent = settings.backupFolder || 'No folder chosen yet';
    const { last, error } = await api.backupStatus();
    if (error) backupNote.textContent = `The last backup had a problem. ${error}`;
    else backupNote.textContent = last ? `Last backup: ${new Date(last).toLocaleString()}` : 'No backups yet.';
  };
  const chooseFolder = async () => {
    settings = await api.chooseBackupFolder();
    await showBackups();
  };
  const backupNow = async () => {
    try {
      const { saved, error } = await api.backupNow();
      await showBackups();
      if (!error && saved === 0) backupNote.textContent = 'Nothing has changed since the last backup.';
    } catch (error) {
      backupNote.textContent = error.message;
    }
  };

  const apps = createAppsPanel(api);

  const themes = { system: { label: 'Same as this computer' }, ...THEMES };
  const check = (id, checked, label, onChange) => el(
    'label',
    { class: 'check' },
    el('input', { id, type: 'checkbox', checked, onchange: (event) => onChange(event.target.checked) }),
    el('span', {}, label),
  );
  const note = (...words) => el('p', { class: 'quiet-note' }, ...words);

  // The sections, in the order they're listed. A new one (AI and Claude, when it's built) is one more entry here. `shown` is run the
  // first time a section is looked at.
  const sections = [
    {
      id: 'general',
      label: 'General',
      body: () => [
        check('pref-reopen', settings.reopenLast, 'Reopen the project I had open when the app starts', (value) => change('reopenLast', value)),
        note('Turn this off to start in the library every time.'),
        el('h4', {}, 'Updates'),
        note(`This is RT Story Tracker ${version}. An installed copy looks for a new version when it starts and every few hours. Where it can’t update itself, it points you to the download.`),
        el('div', { class: 'prefs-actions' },
          el('button', { id: 'pref-check-updates', onclick: () => api.askForUpdates() }, 'Check for Updates…'),
          el('button', { id: 'pref-releases', onclick: () => api.openLink('releases') }, 'Releases Page')),
      ],
    },
    {
      id: 'appearance',
      label: 'Appearance',
      body: () => [
        field('Theme', select('pref-theme', themes, settings.theme, (value) => change('theme', value))),
        check('pref-glass', settings.glass, 'Glass: frosted panels over colour, with any theme but High Contrast', (value) => change('glass', value)),
        field('Page font', select('pref-page-font', PAGE_FONTS, settings.pageFont, (value) => change('pageFont', value))),
        field('App font', select('pref-ui-font', UI_FONTS, settings.uiFont, (value) => change('uiFont', value))),
        field('Text size', range('pref-text-size', 'textSize', settings.textSize, (value) => change('textSize', value))),
        field('Page width', range('pref-page-width', 'pageWidth', settings.pageWidth, (value) => change('pageWidth', value))),
      ],
    },
    {
      id: 'editing',
      label: 'Editing',
      body: () => [
        el('h4', {}, 'Spelling'),
        check('pref-spellcheck', settings.spellcheck, 'Check spelling as I type', (value) => change('spellcheck', value)),
        note('Your own words stop being marked wrong in every project. Right-click a word to add it, or add one here.'),
        el('form', { class: 'word-form', onsubmit: addWord }, newWord, el('button', { type: 'submit' }, 'Add')),
        words,
      ],
    },
    {
      id: 'backups',
      label: 'Backups',
      body: () => [
        note('Each project is saved as a closed .rtstory file, which is safe in OneDrive or Dropbox. To bring one back, use File, then Open.'),
        el('div', { class: 'word-form' }, folder, el('button', { id: 'backup-choose', onclick: chooseFolder }, 'Choose folder…')),
        field('How often', select('pref-backup-every', BACKUP_EVERY, settings.backupEvery, (value) => change('backupEvery', value))),
        field('Keep the newest', el('input', {
          id: 'pref-backup-keep',
          type: 'number',
          min: String(LIMITS.backupKeep[0]),
          max: String(LIMITS.backupKeep[1]),
          value: String(settings.backupKeep),
          onchange: (event) => change('backupKeep', Number(event.target.value)),
        })),
        el('div', { class: 'word-form' }, el('button', { id: 'backup-now', onclick: backupNow }, 'Back up now'), backupNote),
      ],
    },
    {
      id: 'lock',
      label: 'Password lock',
      body: () => [
        field('Lock a project that has a password', select('pref-lock-after', LOCK_AFTER, String(settings.lockAfter), (value) => change('lockAfter', Number(value)))),
        note('Counts time away from this app. A project with a password also locks when you close it, and when this computer locks or sleeps.'),
        note('To set or change a project’s password, open the project and choose File, then Password and Lock.'),
      ],
    },
    { id: 'apps', label: 'Linked Apps', body: () => [apps.node], shown: () => apps.load() },
    { id: 'shortcuts', label: 'Shortcuts', body: () => [], shown: (pane) => pane.append(createShortcutsEditor(api, dialog)) },
  ];

  const tabs = new Map();
  const panes = new Map();
  const seen = new Set();
  const scroller = el('div', { class: 'prefs-panes' });
  const show = (id) => {
    const wanted = sections.find((one) => one.id === id) ?? sections[0];
    // Leaving the Shortcuts section stops it listening for a key.
    stopShortcutCapture();
    for (const one of sections) {
      const on = one === wanted;
      tabs.get(one.id).setAttribute('aria-selected', String(on));
      tabs.get(one.id).tabIndex = on ? 0 : -1;
      panes.get(one.id).hidden = !on;
    }
    scroller.scrollTop = 0;
    if (!seen.has(wanted.id)) {
      seen.add(wanted.id);
      wanted.shown?.(panes.get(wanted.id));
    }
  };
  // Up and down move through the list, as in any list of tabs.
  const onTabKey = (event, at) => {
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -at, End: sections.length - 1 - at }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = sections[(at + step + sections.length) % sections.length];
    show(next.id);
    tabs.get(next.id).focus();
  };
  sections.forEach((one, at) => {
    tabs.set(one.id, el('button', {
      type: 'button', role: 'tab', id: `prefs-tab-${one.id}`, 'aria-controls': `prefs-pane-${one.id}`, dataset: { section: one.id },
      onclick: () => show(one.id), onkeydown: (event) => onTabKey(event, at),
    }, one.label));
    panes.set(one.id, el('section', { class: 'prefs-pane', id: `prefs-pane-${one.id}`, role: 'tabpanel', 'aria-labelledby': `prefs-tab-${one.id}`, hidden: true }, el('h3', {}, one.label), one.body()));
  });
  scroller.append(...panes.values());

  const dialog = el(
    'dialog',
    { id: 'preferences', class: 'dialog prefs-window', 'aria-labelledby': 'prefs-title' },
    el('div', { class: 'prefs-head' },
      el('h2', { id: 'prefs-title' }, 'Preferences'),
      el('button', { id: 'prefs-x', class: 'quiet', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close'))),
    el('div', { class: 'prefs-body' },
      el('div', { class: 'prefs-nav', role: 'tablist', 'aria-label': 'Preferences sections', 'aria-orientation': 'vertical' }, ...tabs.values()),
      scroller),
    el('div', { class: 'prefs-foot' },
      el('button', { id: 'prefs-help', class: 'quiet', type: 'button', onclick: () => openHelp({ page: 'center', api }) }, 'Help Center'),
      el('button', { id: 'pref-close', class: 'primary', onclick: () => dialog.close() }, 'Done')),
  );
  dialog.addEventListener('close', () => {
    stopShortcutCapture();
    dialog.remove();
  });
  await showWords();
  await showBackups();
  document.body.append(dialog);
  show(section);
  dialog.showModal();
  tabs.get(sections.some((one) => one.id === section) ? section : 'general').focus();
}
