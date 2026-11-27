// A record beside the page, so a name can be checked without leaving the chapter. It's the same page the Records side
// uses, so what's changed here is saved the same way.
import { el } from './dom.js';
import { icon } from './icons.js';
import { RecordPage } from './record-page.js';

const DELAY_MS = 150;

export class LookupPanel {
  constructor(parent, { api, onError, onOpenChapter }) {
    this.api = api;
    this.onError = onError;
    this.onOpenChapter = onOpenChapter;
    this.timer = null;

    this.input = el('input', { type: 'search', class: 'lookup-search', placeholder: 'Look up a record…', 'aria-label': 'Look up a record' });
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), DELAY_MS);
    });
    this.results = el('ul', { class: 'lookup-results', 'aria-label': 'Matching records' });
    this.body = el('div', { class: 'lookup-body' });
    this.root = el(
      'aside',
      { class: 'pane lookup-pane', id: 'lookup-panel', 'aria-label': 'Look up a record', hidden: true },
      el(
        'div',
        { class: 'lookup-head' },
        this.input,
        el('button', { class: 'row-action shown', title: 'Close', 'aria-label': 'Close the look-up panel', onclick: () => this.close() }, icon('close')),
      ),
      this.results,
      this.body,
    );
    parent.append(this.root);
    this.page = null;
  }

  get isOpen() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
  }

  async toggle() {
    if (this.isOpen) await this.close();
    else {
      this.show();
      this.input.focus();
      await this.search();
    }
  }

  async close() {
    await this.page?.flush().catch((error) => this.onError(error.message));
    this.page?.destroy();
    this.page = null;
    this.body.replaceChildren();
    this.root.hidden = true;
  }

  async flush() {
    await this.page?.flush();
  }

  async search() {
    try {
      const found = await this.api.findRecords({ query: this.input.value });
      this.results.replaceChildren(
        ...(found.length
          ? found.map((entry) =>
              el(
                'li',
                {},
                el(
                  'button',
                  { class: 'lookup-result', onclick: () => this.open(entry.id) },
                  el('span', { class: 'picker-title' }, entry.title),
                  el('span', { class: 'picker-note' }, [entry.label, entry.typeTitle].filter(Boolean).join(' · ')),
                ),
              ))
          : [el('li', { class: 'picker-empty' }, this.input.value ? 'Nothing matches.' : 'No records yet. Make some under Records.')]),
      );
    } catch (error) {
      this.onError(error.message);
    }
  }

  // Shows one record. The list of matches steps aside once there's one to read.
  async open(id) {
    try {
      this.show();
      if (!this.page) {
        this.page = new RecordPage(this.body, {
          api: this.api,
          compact: true,
          onError: this.onError,
          onOpenRecord: (next) => this.open(next),
          onOpenChapter: (chapterId) => this.onOpenChapter(chapterId),
          onTrashed: () => this.afterTrash(),
        });
      }
      // The record's body has to be showing while it's drawn, or its long text boxes are measured at nothing.
      this.root.classList.add('has-record');
      await this.page.open(id);
    } catch (error) {
      this.onError(error.message);
    }
  }

  async afterTrash() {
    this.page?.destroy();
    this.page = null;
    this.body.replaceChildren();
    this.root.classList.remove('has-record');
    await this.search();
  }
}
