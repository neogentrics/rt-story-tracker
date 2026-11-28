import { SECTIONS, sectionLabel } from '../shared/sections.js';
import { sizeOf } from './files-dialog.js';
import { el, fill, formatCount } from './dom.js';
import { icon } from './icons.js';

const KIND_ICONS = { series: 'library', book: 'book', part: 'folder', chapter: 'page', whole: 'page' };
const DRAGGABLE = new Set(['book', 'part', 'chapter', 'whole']);
// A section with more files than this starts closed, and an open one shows this many at a time, so thousands of files stay quick.
const OPEN_UP_TO = 8;
const SHOWN_AT_A_TIME = 100;
const files = (count) => `${formatCount(count)} ${count === 1 ? 'file' : 'files'}`;
const versions = (count) => `${formatCount(count)} earlier ${count === 1 ? 'version' : 'versions'}`;
let showProgress = () => {};
let listening = false;

function holdsChapters(node) {
  return node.children.filter((child) => child.kind === 'chapter' || child.kind === 'whole').length;
}

function noteFor(node) {
  if (node.kind === 'whole') return 'Split into chapters when it comes in';
  if (node.kind === 'chapter') return node.older.length ? versions(node.older.length) : '';
  const parts = [];
  if (node.kind === 'book') parts.push(`${holdsChapters(node)} ${holdsChapters(node) === 1 ? 'chapter' : 'chapters'}`);
  if (node.cover) parts.push('cover');
  if (node.attachments.length) parts.push(`${files(node.attachments.length)} kept`);
  return parts.join(' · ');
}

export async function openFolderImport({ api, chosen = null, onDone, onError }) {
  document.getElementById('find-files-dialog')?.remove();
  const body = el('div', { class: 'plan-screen', style: 'display: contents' });
  const actions = el('div', { class: 'dialog-actions' });
  const heading = el('h2', {}, 'Find my files');
  const dialog = el('dialog', { id: 'find-files-dialog', class: 'dialog huge' }, heading, body, actions);
  let working = false;
  let plan = null;
  const closed = new Set();
  let dragged = null;

  dialog.addEventListener('cancel', (event) => { if (working) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);

  const progressBar = el('progress', { id: 'folder-progress', class: 'folder-progress' });
  const progressText = el('p', { id: 'folder-progress-text', class: 'quiet-note' });
  if (!listening) {
    listening = true;
    api.onFolderProgress((data) => showProgress(data));
  }
  showProgress = (data) => {
    if (data.stage === 'looking') progressText.textContent = `Looking through your folder. ${files(data.found)} so far.`;
    else if (data.stage === 'comparing') {
      progressBar.max = data.total;
      progressBar.value = data.done;
      progressText.textContent = `Comparing files that might be copies: ${formatCount(data.done)} of ${formatCount(data.total)}.`;
    } else {
      progressBar.max = data.total;
      progressBar.value = data.done;
      progressText.textContent = `${formatCount(data.done)} of ${files(data.total)}. ${data.name}`;
    }
  };

  const button = (id, label, onclick, extra = {}) => el('button', { id, onclick, ...extra }, label);
  const close = () => dialog.close();

  async function change(edit) {
    try {
      showPlan(await api.editFolderPlan(edit));
    } catch (error) {
      onError(error.message);
    }
  }

  function renameInto(row, node, title) {
    const input = el('input', { type: 'text', value: node.title, 'aria-label': `New title for ${node.title}` });
    const done = (keep) => {
      if (keep && input.value.trim() && input.value !== node.title) change({ type: 'title', id: node.id, value: input.value });
      else input.replaceWith(title);
    };
    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        done(false);
      }
    });
    title.replaceWith(input);
    input.select();
  }

  // Which sections are open and how far each is shown, kept while the plan is worked out again after a change.
  const openSections = new Map();
  const shownOf = new Map();

  function fileRow(file, holder) {
    const role = el(
      'select',
      {
        'aria-label': `What to do with ${file.name}`,
        onchange: (event) => {
          const { value } = event.target;
          if (value === 'leave') change({ type: 'leave', id: file.id, left: true });
          else if (value === 'chapter') change({ type: 'role', id: file.id, role: 'chapter' });
          else {
            // The section it goes to is opened, so the file doesn't seem to vanish.
            openSections.set(`${holder}:${value}`, true);
            change({ type: 'section', id: file.id, section: value });
          }
        },
      },
      SECTIONS.map((section) => el('option', { value: section.id }, section.label)),
      file.kind === 'writing' ? el('option', { value: 'chapter' }, 'Chapter') : null,
      el('option', { value: 'leave' }, 'Leave out'),
    );
    role.value = file.section;
    return el('li', {}, el('div', { class: 'plan-row' }, el('span', { class: 'plan-title', title: file.rel }, file.name), el('span', { class: 'plan-note' }, sizeOf(file.size)), role));
  }

  // The files kept with a series, a book or the project, a group for each section.
  function sectionRows(node) {
    const kept = new Set(node.attachments);
    const here = plan.files.filter((file) => kept.has(file.id));
    return SECTIONS.flatMap((section) => {
      const inIt = here.filter((file) => file.section === section.id);
      if (inIt.length === 0) return [];
      const key = `${node.id}:${section.id}`;
      const open = openSections.get(key) ?? inIt.length <= OPEN_UP_TO;
      const shown = shownOf.get(key) ?? SHOWN_AT_A_TIME;
      return [el(
        'li',
        { class: 'plan-section', dataset: { section: section.id } },
        el('button', {
          type: 'button',
          class: 'plan-section-name',
          'aria-expanded': String(open),
          dataset: { toggle: key },
          onclick: () => {
            openSections.set(key, !open);
            showPlan(plan, key);
          },
        }, el('span', { 'aria-hidden': 'true' }, open ? '▾' : '▸'), ` ${section.label} (${formatCount(inIt.length)})`),
        open
          ? el('ul', {},
            inIt.slice(0, shown).map((file) => fileRow(file, node.id)),
            inIt.length > shown
              ? el('li', {}, el('button', { type: 'button', class: 'link', dataset: { more: key }, onclick: () => {
                shownOf.set(key, shown + SHOWN_AT_A_TIME);
                showPlan(plan, key);
              } }, `Show ${formatCount(Math.min(SHOWN_AT_A_TIME, inIt.length - shown))} more of ${formatCount(inIt.length)}`))
              : null)
          : null,
      )];
    });
  }

  function nodeRow(node) {
    const hasInside = node.children.length > 0 || node.attachments.length > 0;
    const open = !closed.has(node.id);
    const title = el('button', { class: 'plan-title', title: 'Double-click to rename', ondblclick: () => renameInto(row, node, title) }, node.title);
    const row = el(
      'div',
      { class: `plan-row ${node.kind}`, draggable: DRAGGABLE.has(node.kind) ? 'true' : 'false', 'data-node': node.id, 'data-kind': node.kind },
      el('button', {
        class: 'plan-toggle',
        'aria-label': `${open ? 'Close' : 'Open'} ${node.title}`,
        hidden: !hasInside,
        onclick: () => {
          if (open) closed.add(node.id);
          else closed.delete(node.id);
          showPlan(plan);
        },
      }, open ? '▾' : '▸'),
      icon(KIND_ICONS[node.kind] ?? 'book'),
      title,
      el('span', { class: 'plan-note' }, noteFor(node)),
      el('button', {
        class: 'link plan-note',
        'aria-label': `Leave out ${node.title}`,
        onclick: () => change({ type: 'leave', id: node.id, left: true }),
      }, 'Leave out'),
    );
    row.addEventListener('dragstart', (event) => {
      dragged = node;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.id);
    });
    row.addEventListener('dragover', (event) => {
      if (!dragged || dragged.id === node.id) return;
      event.preventDefault();
      row.classList.add('drop-here');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-here'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drop-here');
      const moving = dragged;
      dragged = null;
      if (!moving || moving.id === node.id) return;
      const inside = ['series', 'book', 'part'].includes(node.kind) && !(moving.kind === 'book' && node.kind === 'book');
      if (inside) change({ type: 'move', id: moving.id, to: node.id });
      else change({ type: 'move', id: moving.id, to: parentOf(node).id, before: node.id });
    });
    return el(
      'li',
      {},
      row,
      open && hasInside
        ? el('ul', {}, node.children.map(nodeRow), node.attachments.length ? el('li', { class: 'plan-files' }, el('ul', {}, sectionRows(node))) : null)
        : null,
    );
  }

  function parentOf(target, node = plan.tree) {
    for (const child of node.children) {
      if (child.id === target.id) return node;
      const found = parentOf(target, child);
      if (found) return found;
    }
    return null;
  }

  function askCard(ask) {
    return el(
      'div',
      { class: 'ask-card', 'data-ask': ask.type },
      el('p', {}, el('b', {}, ask.question)),
      el('p', { class: 'quiet-note' }, ask.detail),
      ask.files ? el('ul', { class: 'ask-files' }, ask.files.slice(0, 40).map((file) => el('li', {}, file))) : null,
      ask.options.map((option) => el(
        'label',
        {},
        el('input', { type: 'radio', name: ask.id, checked: option.value === ask.value, onchange: () => change({ type: 'answer', id: ask.id, value: option.value }) }),
        option.label,
      )),
    );
  }

  function showPlan(next, focusSection = null) {
    plan = next;
    const scrolled = body.querySelector('#plan-tree')?.scrollTop ?? 0;
    const kept = plan.totals.attachments + plan.totals.covers;
    const bySection = SECTIONS
      .map((section) => [section, (plan.totals.sections[section.id] ?? 0) + (section.id === 'cover' ? plan.totals.covers : 0)])
      .filter(([, count]) => count)
      .map(([section, count]) => `${sectionLabel(section.id)} ${formatCount(count)}`)
      .join(', ');
    const { totals } = plan;
    const room = plan.freeBytes >= totals.attachmentBytes;
    heading.textContent = `Find my files: ${plan.root.split(/[\\/]/).pop()}`;
    const summary = [
      `${files(totals.files)}, ${sizeOf(totals.bytes)}.`,
      `${formatCount(totals.chapters + totals.whole)} to read as writing, ${versions(totals.older)}, ${files(kept)} to keep${bySection ? ` (${bySection})` : ''}.`,
      totals.duplicates ? `${formatCount(totals.duplicates)} exact copies.` : '',
      `Your originals are never touched.`,
    ].filter(Boolean).join(' ');
    const open = plan.asks.filter((ask) => !ask.answered).length;
    const space = room ? [] : [el('p', { id: 'plan-space', class: 'room-message' }, `This needs ${sizeOf(totals.attachmentBytes)} of space, and only ${sizeOf(plan.freeBytes)} is free.`)];
    body.replaceChildren(
      el('p', { id: 'plan-summary', class: 'quiet-note' }, summary),
      ...space,
      el(
        'div',
        { class: 'plan-body' },
        el('div', { id: 'plan-tree', class: 'plan-tree' }, el('ul', {}, plan.tree.children.map(nodeRow), plan.tree.attachments.length ? el('li', {}, el('div', { class: 'plan-row' }, icon('attach'), el('span', { class: 'plan-title' }, 'Kept with the project')), el('ul', { class: 'plan-files' }, sectionRows(plan.tree))) : null)),
        el(
          'div',
          { id: 'plan-asks', class: 'plan-asks' },
          el('h3', {}, 'Ask me'),
          plan.asks.length
            ? el('p', { class: 'quiet-note' }, open ? 'Anything you leave uses the choice shown.' : 'All answered.')
            : el('p', { class: 'quiet-note' }, 'Nothing to ask. Everything had a clear place.'),
          plan.asks.map(askCard),
        ),
      ),
    );
    actions.replaceChildren(
      button('plan-cancel', 'Cancel', close),
      el('button', { id: 'plan-go', class: 'primary', disabled: !room, onclick: () => bringIn(api.runFolderImport) }, icon('import'), 'Bring it in'),
    );
    const tree = body.querySelector('#plan-tree');
    tree.scrollTop = scrolled;
    if (focusSection) tree.querySelector(`[data-toggle="${focusSection}"]`)?.focus({ preventScroll: true });
  }

  function showWorking(text) {
    progressText.textContent = text;
    progressBar.removeAttribute('value');
    body.replaceChildren(progressBar, progressText);
  }

  async function bringIn(start) {
    working = true;
    showWorking('Starting.');
    actions.replaceChildren(button('folder-stop', 'Stop', async (event) => {
      event.target.disabled = true;
      progressText.textContent = 'Stopping after this file.';
      await api.stopFolderImport();
    }));
    try {
      const result = await start();
      working = false;
      await onDone(result.outline);
      showReport(result);
    } catch (error) {
      working = false;
      onError(error.message);
      close();
    }
  }

  function showReport({ finished, report }) {
    heading.textContent = finished ? 'That’s everything' : 'Stopped';
    body.replaceChildren(
      el('p', { id: 'report-total' }, finished
        ? `All ${files(report.total)} accounted for.`
        : `${formatCount(report.accounted)} of ${files(report.total)} done. Choose File, then This Project, then Find My Files to pick up where this stopped.`),
      el('div', { id: 'report-groups', class: 'report-groups' }, report.groups.map((group) => el(
        'details',
        {},
        el('summary', {}, `${group.label}: ${formatCount(group.files.length)}`),
        el('ul', {}, group.files.slice(0, 2000).map((file) => el('li', {}, file.rel, file.note ? el('span', {}, ` — ${file.note}`) : null))),
      ))),
    );
    actions.replaceChildren(
      button('report-save', 'Save the report', () => api.saveFolderReport(report).catch((error) => onError(error.message))),
      el('button', { id: 'report-close', class: 'primary', onclick: close }, 'Done'),
    );
  }

  async function scan() {
    working = true;
    showWorking('Looking through your folder.');
    actions.replaceChildren(button('folder-stop', 'Stop', () => api.stopFolderImport()));
    try {
      const result = await api.scanFolder();
      working = false;
      showPlan(result);
    } catch (error) {
      working = false;
      if (error.message !== 'Stopped.') onError(error.message);
      close();
    }
  }

  // Picking up reads the folder again, so it has to be one chosen on this computer. The project's word for where it is isn't enough.
  function offerResume(pending) {
    const ready = pending.here && pending.there;
    heading.textContent = 'An import stopped partway';
    const where = el('span', { class: 'resume-folder' }, pending.root);
    const why = ready
      ? ['It was reading ', where, '.']
      : pending.here
        ? ['It was reading ', where, ', which isn’t there now. Connect it, or choose where it is.']
        : ['The project says it was reading ', where, '. That folder hasn’t been chosen on this computer, so nothing in it has been looked at. To pick up, choose the folder.'];
    const wrong = el('p', { id: 'resume-error', class: 'room-message', role: 'alert', hidden: true });
    body.replaceChildren(el('p', { id: 'resume-note' }, why, ' Nothing already brought in will be repeated.'), wrong);

    const choose = async () => {
      wrong.hidden = true;
      try {
        if (await api.locatePendingFolderImport()) await bringIn(api.resumeFolderImport);
      } catch (error) {
        wrong.textContent = error.message;
        wrong.hidden = false;
      }
    };
    fill(
      actions,
      button('resume-drop', 'Forget it', async () => {
        await api.discardFolderImport();
        close();
      }),
      el('button', { id: 'resume-choose', class: ready ? '' : 'primary', onclick: choose }, 'Choose the folder'),
      ready ? el('button', { id: 'resume-go', class: 'primary', onclick: () => bringIn(api.resumeFolderImport) }, 'Pick up where it stopped') : null,
    );
  }

  const pending = await api.pendingFolderImport();
  if (pending) {
    offerResume(pending);
    dialog.showModal();
    return;
  }
  const folder = chosen ?? await api.chooseFolder();
  if (!folder) {
    dialog.remove();
    return;
  }
  dialog.showModal();
  await scan();
}
