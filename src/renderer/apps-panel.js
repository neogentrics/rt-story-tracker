// The Apps panel: every Recon Towers app, whether it's linked, found or installed or not there at all, and the one button that
// goes with each. It's shown in Preferences and from the toolbar icon, and both are this. The words come from
// ../shared/suite-apps.js, which every app copies, so they say the same thing in each. The panel looks when it opens and when
// Refresh is pressed, never on a timer, and finding an app never links it.
import { STATES, TITLE, UPDATE, dotOf, dotWords } from '../shared/suite-apps.js';
import { el } from './dom.js';
import { icon } from './icons.js';

// The toolbar listens for this, so its dot is right after anything changes here.
export const APPS_EVENT = 'apps-status';

export function dotFor(status) {
  const dot = dotOf(status);
  return { dot, words: dotWords(dot) };
}

export function createAppsPanel(api) {
  const list = el('ul', { id: 'linked-apps', class: 'word-list' });
  const note = el('p', { id: 'link-note', class: 'quiet-note', role: 'status' });
  const off = el('div', { id: 'apps-off', class: 'apps-off', role: 'status', hidden: true },
    el('span', {}, 'App Link is off, so no other app can find this one and none can be linked. '),
    el('button', { id: 'apps-turn-on', onclick: () => change(() => api.setLink(true)) }, 'Turn on'));
  const toggle = el('input', { id: 'pref-link', type: 'checkbox', onchange: () => change(() => api.setLink(toggle.checked)) });
  const refresh = el('button', { id: 'apps-refresh', type: 'button', onclick: () => change(() => api.linkStatus({ refresh: true })) }, 'Refresh');

  const show = (status) => {
    toggle.checked = status.on;
    off.hidden = status.on;
    // "Couldn't check for updates" is said once, and everything else carries on. A site that hasn't published the file yet says nothing.
    note.textContent = status.error ?? [status.on && !status.safe ? 'This computer has no safe place to keep a link, so links last until the app closes.' : '', status.updates === 'unreachable' ? `${UPDATE.unreachable}.` : ''].filter(Boolean).join(' ');
    const start = (item) => {
      note.textContent = `Starting ${item.name}…`;
      change(() => api.openApp(item.id));
      // An app takes a few seconds to come up, so look once more after the person has asked to start one.
      setTimeout(() => {
        if (list.isConnected) change(() => api.linkStatus());
      }, 4000);
    };
    const buttons = (item) => [
      item.canOpen && item.update?.action !== 'open' ? el('button', { 'aria-label': `Open ${item.name}`, onclick: () => start(item) }, STATES.linked.button) : null,
      item.state === 'found' && status.on && item.canLink
        ? el('button', { 'aria-label': `Link ${item.name}`, onclick: () => {
          note.textContent = `Answer in ${item.name}.`;
          change(() => api.pairApp(item.id));
        } }, STATES.found.button)
        : null,
      item.update?.action === 'open' && item.canOpen ? el('button', { class: 'update-button', 'aria-label': `${UPDATE.open}: ${item.name}`, onclick: () => start(item) }, UPDATE.open) : null,
      item.update?.action === 'download' ? el('button', { class: 'update-button', 'aria-label': `Download ${item.name}`, onclick: () => change(async () => {
        await api.getApp(item.id);
        return status;
      }) }, UPDATE.download) : null,
      item.canGet ? el('button', { 'aria-label': `Get ${item.name}`, onclick: () => change(async () => {
        await api.getApp(item.id);
        return status;
      }) }, STATES.missing.button) : null,
      item.linked ? el('button', { class: 'quiet', 'aria-label': `Remove the link to ${item.name}`, onclick: () => change(() => api.unlinkApp(item.id)) }, 'Remove') : null,
    ];
    const row = (item) => el(
      'li',
      { class: 'word-row app-row', dataset: { app: item.id, state: item.state } },
      el(
        'span',
        { class: 'app-info' },
        el('strong', {}, item.name),
        item.version ? el('small', {}, ` ${item.version}`) : null,
        el('small', { class: 'app-states' }, ` · ${STATES[item.state].words}`),
        item.about ? el('small', { class: 'app-about' }, item.about) : null,
        item.needsUpdate ? el('small', { class: 'app-needs' }, `${UPDATE.needs}: ${item.needsUpdate === 'us' ? 'this app' : item.name}.`) : null,
        item.update ? el('small', { class: 'app-update' }, `${UPDATE.available}: ${item.update.line}`) : null,
        item.line ? el('small', { class: 'app-line' }, item.line) : null,
      ),
      el('span', { class: 'app-buttons' }, ...buttons(item)),
    );
    list.replaceChildren(...(status.apps.length ? status.apps.map(row) : [el('li', { class: 'quiet-note' }, 'No other Recon Towers app was found on this computer.')]));
    document.dispatchEvent(new CustomEvent(APPS_EVENT, { detail: status }));
  };

  async function change(work) {
    try {
      show(await work());
    } catch (error) {
      note.textContent = error.message;
    }
  }

  const node = el(
    'div',
    { class: 'apps-panel' },
    el('p', { class: 'quiet-note' }, 'The other Recon Towers apps. Finding one never links it: you link once, and answer in the app being asked.'),
    off,
    el('label', { class: 'check' }, toggle, 'Let Recon Towers apps on this computer find this one and link with it'),
    el('p', { class: 'quiet-note' }, 'A linked app can send you documents, and you choose where each one goes. It can see a short line about what’s open, and ask for a book’s word count. It can’t read your writing. A project with a password is never described or sent.'),
    list,
    note,
    el('p', {}, refresh),
  );
  return { node, load: () => change(() => api.linkStatus()), show };
}

// The icon for a toolbar, on the writing screen and on the library screen: a dot that only summarises, and the same words as its name.
// It looks once when it's made, and again whenever the panel looks. Nothing asks on a timer.
export function createAppsButton(api) {
  const dot = el('span', { class: 'apps-dot', 'aria-hidden': 'true', dataset: { dot: 'off' } });
  const button = el('button', { class: 'bar-button apps-button', onclick: () => openApps(api) }, icon('apps'), dot);
  const show = (status) => {
    const { dot: kind, words } = dotFor(status);
    dot.dataset.dot = kind;
    button.title = words;
    button.setAttribute('aria-label', words);
  };
  // A screen that has been replaced no longer listens. The panel only reports once the screen is on show, so this is never early.
  const listen = (event) => {
    if (button.isConnected) show(event.detail);
    else document.removeEventListener(APPS_EVENT, listen);
  };
  document.addEventListener(APPS_EVENT, listen);
  show({ on: false, apps: [] });
  api.linkStatus().then(show).catch(() => {});
  return { button, show, destroy: () => document.removeEventListener(APPS_EVENT, listen) };
}

// The toolbar icon opens this.
export async function openApps(api) {
  document.getElementById('apps-dialog')?.remove();
  const panel = createAppsPanel(api);
  const dialog = el(
    'dialog',
    { id: 'apps-dialog', class: 'dialog', 'aria-label': TITLE },
    el('h2', {}, TITLE),
    panel.node,
    el('div', { class: 'dialog-actions' }, el('button', { id: 'apps-close', class: 'primary', onclick: () => dialog.close() }, 'Done')),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  await panel.load();
}
