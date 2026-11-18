// The Records side of a project: the kinds of record on the left, and on the right either the records of one kind or one
// record. Following a link pushes onto a short trail, so Back always goes where the author came from.
import { el, fill } from './dom.js';
import { icon } from './icons.js';
import { RecordBrowser } from './record-browser.js';
import { RecordPage } from './record-page.js';
import { openRecordsImport } from './records-import-dialog.js';
import { openTypeDialog, openTemplates, templateCards } from './type-dialog.js';

const lastTypeKey = (projectId) => `lastRecordType:${projectId}`;

export class RecordsView {
  constructor(root, { api, remember, projectId, onError, onInfo, onOpenChapter }) {
    this.api = api;
    this.remember = remember;
    this.projectId = projectId;
    this.onError = onError;
    this.onInfo = onInfo;
    this.onOpenChapter = onOpenChapter;
    this.types = [];
    this.typeId = null;
    this.trail = [];
    this.page = null;
    this.browser = null;

    this.typeList = el('ul', { id: 'type-list', class: 'rows', 'aria-label': 'Kinds of record' });
    this.nav = el('div', { class: 'records-nav', hidden: true });
    this.pane = el('div', { class: 'records-pane' });
    root.append(
      el(
        'aside',
        { class: 'column types-column', 'aria-label': 'Kinds of record' },
        el('h2', {}, 'Kinds of record'),
        this.typeList,
        el(
          'div',
          { class: 'column-actions' },
          el('button', { id: 'add-type', class: 'primary', onclick: () => this.newType() }, icon('plus'), 'Kind'),
          el('button', { id: 'show-templates', onclick: () => this.templates() }, 'Templates'),
          el('button', { id: 'bring-in', title: 'Bring in records from files', onclick: () => this.bringIn(null) }, icon('import')),
        ),
      ),
      el('section', { class: 'records-main', 'aria-label': 'Records' }, this.nav, this.pane),
    );
  }

  async show() {
    await this.loadTypes();
    if (!this.types.length) {
      await this.showEmpty();
      return;
    }
    // Writing may have changed what links here, so an open record is read again.
    if (this.page?.id) {
      await this.openRecord(this.page.id, { push: false });
      return;
    }
    const remembered = this.remember.get(lastTypeKey(this.projectId));
    const wanted = this.types.find((type) => type.id === (this.typeId ?? remembered)) ?? this.types[0];
    await this.openType(wanted.id);
  }

  async loadTypes() {
    this.types = (await this.api.recordsOverview()).types;
    this.renderTypes();
  }

  renderTypes() {
    this.typeList.replaceChildren(
      ...this.types.map((type) =>
        el(
          'li',
          { class: `row${type.id === this.typeId ? ' selected' : ''}`, dataset: { id: type.id } },
          el(
            'button',
            { class: 'row-main', 'aria-current': String(type.id === this.typeId), onclick: () => this.openType(type.id) },
            icon('page'),
            el('span', { class: 'row-title' }, type.title),
            el('span', { class: 'row-words' }, String(type.count)),
          ),
          el(
            'span',
            { class: 'row-actions' },
            el('button', { class: 'row-action', title: 'Edit this kind', 'aria-label': `Edit ${type.title}`, onclick: () => this.editType(type) }, icon('pencil')),
            el('button', { class: 'row-action', title: 'Move to Trash', 'aria-label': `Move ${type.title} to Trash`, onclick: () => this.trashType(type) }, icon('trash')),
          ),
        )),
    );
  }

  async showEmpty() {
    this.typeId = null;
    this.nav.hidden = true;
    this.page?.destroy();
    this.page = null;
    const templates = await this.api.recordTemplates();
    this.pane.replaceChildren(
      el(
        'div',
        { class: 'records-empty' },
        icon('page'),
        el('h2', {}, 'Keep the story bible here'),
        el('p', {}, 'Records hold everything about the people, places and things in your books, and link to each other. Start from a template, or make your own kind of record.'),
        templateCards({ api: this.api, templates, onError: this.onError, onDone: (result) => this.afterTemplate(result) }),
        el('div', { class: 'empty-actions' }, el('button', { id: 'own-type', onclick: () => this.newType() }, icon('plus'), 'Make my own kind of record'), el('button', { id: 'empty-bring-in', onclick: () => this.bringIn(null) }, icon('import'), 'Bring in files')),
      ),
    );
  }

  async flush() {
    await this.page?.flush();
  }

  // Leaving: whatever was being typed is saved first.
  async leave() {
    await this.flush();
  }

  async openType(id) {
    await this.flush();
    this.typeId = id;
    this.trail = [];
    this.page?.destroy();
    this.page = null;
    this.remember.set(lastTypeKey(this.projectId), id);
    this.nav.hidden = true;
    this.browser = new RecordBrowser(this.pane, {
      api: this.api,
      onError: this.onError,
      onOpenRecord: (recordId) => this.openRecord(recordId),
      onNewRecord: (type) => this.newRecord(type),
      onEditType: (type) => this.editType(type),
      onImport: (type) => this.bringIn(type),
    });
    this.renderTypes();
    await this.browser.show(id);
  }

  async newRecord(type) {
    try {
      const record = await this.api.createRecord({ typeId: type.id, title: 'Untitled' });
      await this.loadTypes();
      await this.openRecord(record.id, { fresh: true });
    } catch (error) {
      this.onError(error.message);
    }
  }

  // `push` is false when going Back, so the trail only ever grows by links that were followed.
  async openRecord(id, { fresh = false, push = true } = {}) {
    try {
      await this.flush();
      if (this.page?.id && push) this.trail.push({ record: this.page.id });
      else if (!this.page?.id && this.browser && push) this.trail.push({ type: this.typeId });
      this.browser = null;
      const host = el('div', { class: 'record-host' });
      this.pane.replaceChildren(host);
      this.page?.destroy();
      this.page = new RecordPage(host, {
        api: this.api,
        compact: false,
        onError: this.onError,
        onOpenRecord: (next) => this.openRecord(next),
        onOpenChapter: (chapterId) => this.onOpenChapter(chapterId),
        onTrashed: (record) => this.recordTrashed(record),
      });
      await this.page.open(id, { fresh });
      this.typeId = this.page.data.type.id;
      this.renderTypes();
      this.renderNav();
    } catch (error) {
      this.onError(error.message);
    }
  }

  renderNav() {
    const previous = this.trail.at(-1);
    const where = previous?.record ? 'Back' : `All ${this.page.data.type.title.toLowerCase()} records`;
    this.nav.hidden = false;
    fill(
      this.nav,
      el('button', { id: 'records-back', class: 'back-button', onclick: () => this.back() }, '←', ` ${where}`),
      this.trail.length > 1 ? el('button', { id: 'records-all', onclick: () => this.openType(this.typeId) }, `All ${this.page.data.type.title.toLowerCase()} records`) : null,
    );
  }

  async back() {
    const previous = this.trail.pop();
    if (previous?.record) await this.openRecord(previous.record, { push: false });
    else await this.openType(previous?.type ?? this.typeId);
  }

  async recordTrashed(record) {
    await this.loadTypes();
    await this.openType(record.typeId);
    this.onInfo(`“${record.title}” is in the Trash.`, {
      label: 'Undo',
      run: async () => {
        try {
          await this.api.restoreItem(record.id);
          await this.loadTypes();
          await this.openRecord(record.id);
        } catch (error) {
          this.onError(error.message);
        }
      },
    });
  }

  // Dialogs

  newType() {
    return openTypeDialog({
      api: this.api,
      types: this.types,
      onError: this.onError,
      onSaved: async (type) => {
        await this.loadTypes();
        await this.openType(type.id);
      },
    });
  }

  editType(type) {
    return openTypeDialog({
      api: this.api,
      type,
      types: this.types,
      onError: this.onError,
      onSaved: async (saved) => {
        await this.loadTypes();
        if (this.page?.id) await this.openRecord(this.page.id, { push: false });
        else await this.openType(saved.id);
      },
    });
  }

  async trashType(type) {
    try {
      await this.flush();
      await this.api.trashItem(type.id);
      await this.loadTypes();
      if (this.types.length) await this.openType(this.types.find((other) => other.id !== type.id)?.id ?? this.types[0].id);
      else await this.showEmpty();
      this.onInfo(`“${type.title}” and its ${type.count} ${type.count === 1 ? 'record are' : 'records are'} in the Trash.`, {
        label: 'Undo',
        run: async () => {
          try {
            await this.api.restoreItem(type.id);
            await this.loadTypes();
            await this.openType(type.id);
          } catch (error) {
            this.onError(error.message);
          }
        },
      });
    } catch (error) {
      this.onError(error.message);
    }
  }

  // From spreadsheets or Markdown files, into a kind of record that's there or one made from the files.
  bringIn(type) {
    openRecordsImport({
      api: this.api,
      types: this.types,
      type: type ?? this.types.find((item) => item.id === this.typeId) ?? null,
      onError: this.onError,
      onDone: async (result) => {
        await this.loadTypes();
        if (this.browser && result.typeId === this.typeId) await this.browser.refresh();
        else await this.openType(result.typeId);
      },
    });
  }

  templates() {
    return openTemplates({ api: this.api, onError: this.onError, onDone: (result) => this.afterTemplate(result) });
  }

  async afterTemplate(result) {
    await this.loadTypes();
    const first = this.types.find((type) => result.made.includes(type.title)) ?? this.types[0];
    if (first) await this.openType(first.id);
    const skipped = result.skipped.length ? ` ${result.skipped.join(', ')} ${result.skipped.length === 1 ? 'was' : 'were'} already there, so left alone.` : '';
    this.onInfo(`Made ${result.made.length} ${result.made.length === 1 ? 'kind' : 'kinds'} of record.${skipped}`);
  }

  // After something outside changed the records, such as a restore from the Trash or an import.
  async refresh() {
    await this.loadTypes();
    if (this.browser) await this.browser.refresh();
    else if (!this.types.length) await this.showEmpty();
  }

  destroy() {
    this.page?.destroy();
  }
}
