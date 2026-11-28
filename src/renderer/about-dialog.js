// Help, then About RT Story Tracker: what the app is, its version, where it lives on the web, and the details a bug report needs,
// copied in one click. It's laid out like RT Markdown Reader's, from the same words (../shared/family.js). Nothing about the
// person or the project is in it.
import { ABOUT, APP_NAME, BLURB, LAME_NOTICE, copyright, engineLine, versionWords } from '../shared/family.js';
import { el } from './dom.js';
import { icon } from './icons.js';

export async function openAbout(api) {
  document.getElementById('about-dialog')?.remove();
  const info = await api.aboutApp();
  const status = el('p', { id: 'about-copied', class: 'quiet-note', role: 'status' });
  // A link names itself, and the address is looked up in the main process, so the window can't send anyone anywhere else.
  const link = (id, text) => el('a', { href: '#', id: `about-${id}`, onclick: (event) => {
    event.preventDefault();
    api.openLink(id);
  } }, text);
  const dialog = el(
    'dialog',
    { id: 'about-dialog', class: 'dialog about-dialog', 'aria-labelledby': 'about-title' },
    el('button', { id: 'about-x', class: 'quiet about-x', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close')),
    el('div', { class: 'about-top' },
      el('img', { class: 'about-logo', src: 'icon.png', alt: '', width: '64', height: '64' }),
      el('div', {}, el('h2', { id: 'about-title' }, APP_NAME), el('p', { id: 'about-version', class: 'about-version' }, versionWords(info)))),
    el('p', { id: 'about-blurb', class: 'about-blurb' }, BLURB),
    el('ul', { class: 'about-links' }, ABOUT.rows.map((row) => el('li', {}, link(row.id, row.label), el('span', {}, row.note)))),
    el('p', { id: 'about-tech', class: 'about-tech' }, `${engineLine(info)} · ${info.os}`),
    el('p', { class: 'about-legal' }, el('span', { id: 'about-copyright' }, copyright(info.year)), ' · ', link('license', ABOUT.license), ' · ', link('notices', ABOUT.notices)),
    // The MP3 encoder's licence asks that its notice is shown wherever the app shows copyright notices.
    el('p', { id: 'about-lame', class: 'about-legal' }, LAME_NOTICE),
    status,
    el(
      'div',
      { class: 'dialog-actions spread' },
      el('button', { id: 'about-copy', class: 'link', onclick: async () => {
        try {
          await api.copyDetails();
          status.textContent = ABOUT.copied;
        } catch (error) {
          status.textContent = error.message;
        }
      } }, icon('copy'), ABOUT.copy),
      el('button', { id: 'about-done', class: 'primary', onclick: () => dialog.close() }, ABOUT.done),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  document.getElementById('about-done').focus();
}
