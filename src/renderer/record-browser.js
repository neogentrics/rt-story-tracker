// The records of one kind, as a table or as cards, with filters, a sort and saved views. A view is only a way of looking:
// it never changes a record, and it's kept with the kind, so it comes back next time.
import { BUILT_IN, FILTER_TESTS, NEEDS_VALUE, TEST_LABELS, applyView, fieldsFor, matches, showValue } from '../shared/records.js';
import { el, fill } from './dom.js';
import { icon } from './icons.js';
import { openRecordPicker } from './record-picker.js';

const DEFAULT_COLUMNS = 5;
const CARD_FIELDS = 4;

const plainDraft = () => ({ mode: 'table', filters: [], sort: { field: '@name', direction: 'up' }, columns: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (value) => JSON.parse(JSON.stringify(value));

export class RecordBrowser {
  constructor(root, { api, onOpenRecord, onNewRecord, onEditType, onImport, onError }) {
    this.api = api;
    this.onOpenRecord = onOpenRecord;
    this.onNewRecord = onNewRecord;
    this.onEditType = onEditType;
    this.onImport = onImport;
    this.onError = onError;
    this.data = null;
    this.viewId = null;
    this.draft = plainDraft();
    this.search = '';
    this.filtersOpen = false;
    this.names = {};
    this.root = el('div', { class: 'record-browser' });
    root.replaceChildren(this.root);
  }

  get type() {
    return this.data.type;
  }

  titleOf = (id) => {
    const target = this.data?.targets[id];
    if (target) return target.trashed ? `${target.title} (in the Trash)` : target.title;
    return this.names[id] ?? '';
  };

  async show(typeId, { keepView = false } = {}) {
    const previous = this.data?.type.id;
    this.data = await this.api.listRecords(typeId);
    if (!keepView || previous !== typeId) {
      this.viewId = null;
      this.draft = plainDraft();
      this.search = '';
      this.filtersOpen = false;
    }
    this.render();
  }

  async refresh() {
    if (this.data) await this.show(this.data.type.id, { keepView: true });
  }

  savedView() {
    return this.type.views.find((view) => view.id === this.viewId) ?? null;
  }

  // What the draft is compared with, to know if it has changed.
  baseline() {
    const view = this.savedView();
    return view ? { mode: view.mode, filters: view.filters, sort: view.sort, columns: view.columns } : plainDraft();
  }

  chooseView(id) {
    this.viewId = id;
    const view = this.savedView();
    this.draft = view ? copy({ mode: view.mode, filters: view.filters, sort: view.sort, columns: view.columns }) : plainDraft();
    this.render();
  }

  visibleColumns() {
    const wanted = this.draft.columns.map((id) => this.type.fields.find((field) => field.id === id)).filter(Boolean);
    if (wanted.length) return wanted;
    return this.type.fields.filter((field) => field.kind !== 'longtext').slice(0, DEFAULT_COLUMNS);
  }

  shown() {
    const found = applyView(this.draft, [...this.data.records], this.type, this.titleOf);
    return found.filter((record) => matches(this.search, record, this.type, this.titleOf));
  }

  render() {
    const { type } = this.data;
    const records = this.shown();
    this.count = el('span', { class: 'browser-count', role: 'status' }, this.countText(records));
    fill(
      this.root,
      el(
        'header',
        { class: 'browser-head' },
        el('h2', {}, type.title),
        this.count,
        el(
          'div',
          { class: 'browser-actions' },
          this.onImport ? el('button', { id: 'import-records', onclick: () => this.onImport(type) }, icon('import'), 'Bring in') : null,
          el('button', { id: 'edit-type', onclick: () => this.onEditType(type) }, icon('pencil'), 'Edit type'),
          el('button', { id: 'new-record', class: 'primary', onclick: () => this.onNewRecord(type) }, icon('plus'), `New ${type.title.toLowerCase()}`),
        ),
      ),
      this.viewTabs(),
      this.controls(),
      this.filtersOpen ? this.filterPanel() : null,
      this.draft.mode === 'cards' ? this.cards(records) : this.table(records),
    );
  }

  countText(records) {
    const total = this.data.records.length;
    return records.length === total ? `${total} ${total === 1 ? 'record' : 'records'}` : `${records.length} of ${total}`;
  }

  // Redraws only the records, so typing in the search box keeps the cursor where it is.
  drawRecords() {
    const records = this.shown();
    this.count.textContent = this.countText(records);
    const next = this.draft.mode === 'cards' ? this.cards(records) : this.table(records);
    this.root.querySelector('.record-table-wrap, .record-cards, .browser-empty')?.replaceWith(next);
  }

  viewTabs() {
    const dirty = !same(this.draft, this.baseline());
    const saved = this.savedView();
    const tab = (view) =>
      el(
        'button',
        { class: `view-tab${view.id === this.viewId ? ' active' : ''}`, 'aria-pressed': String(view.id === this.viewId), onclick: () => this.chooseView(view.id) },
        view.name,
      );
    const name = el('input', { type: 'text', class: 'view-name', placeholder: 'Name this view', maxlength: '200', 'aria-label': 'Name for the new view', hidden: true });
    const saveNew = el('button', { class: 'view-save-new', onclick: () => {
      if (name.hidden) {
        name.hidden = false;
        name.focus();
      } else {
        this.saveView(name.value, null);
      }
    } }, icon('plus'), 'Save as a view');
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.saveView(name.value, null);
      if (event.key === 'Escape') name.hidden = true;
    });
    return el(
      'div',
      { class: 'view-tabs', role: 'toolbar', 'aria-label': 'Views' },
      el('button', { class: `view-tab${this.viewId === null ? ' active' : ''}`, 'aria-pressed': String(this.viewId === null), onclick: () => this.chooseView(null) }, 'All'),
      this.type.views.map(tab),
      el('span', { class: 'view-spacer' }),
      dirty && saved ? el('button', { class: 'view-save', onclick: () => this.saveView(saved.name, saved.id) }, `Save changes to “${saved.name}”`) : null,
      dirty && saved ? el('button', { class: 'view-revert', onclick: () => this.chooseView(this.viewId) }, 'Undo changes') : null,
      dirty || !this.viewId ? name : null,
      dirty || !this.viewId ? saveNew : null,
      saved && !dirty ? el('button', { class: 'view-delete', onclick: () => this.deleteView(saved) }, icon('trash'), 'Delete this view') : null,
    );
  }

  controls() {
    const fields = fieldsFor(this.type);
    const sortField = el('select', { 'aria-label': 'Sort by' }, fields.filter((field) => field.id !== '@number' || this.type.numbering).map((field) => el('option', { value: field.id }, field.name)));
    sortField.value = this.draft.sort.field;
    sortField.addEventListener('change', () => this.setDraft({ sort: { ...this.draft.sort, field: sortField.value } }));
    const direction = el(
      'button',
      {
        class: 'sort-direction',
        title: this.draft.sort.direction === 'up' ? 'Smallest first' : 'Largest first',
        'aria-label': this.draft.sort.direction === 'up' ? 'Smallest first. Change to largest first.' : 'Largest first. Change to smallest first.',
        onclick: () => this.setDraft({ sort: { ...this.draft.sort, direction: this.draft.sort.direction === 'up' ? 'down' : 'up' } }),
      },
      this.draft.sort.direction === 'up' ? '↑' : '↓',
    );
    const search = el('input', { type: 'search', class: 'browser-search', placeholder: 'Search these records…', 'aria-label': 'Search these records', value: this.search });
    search.addEventListener('input', () => {
      this.search = search.value;
      this.drawRecords();
    });
    const columns = el(
      'details',
      { class: 'column-picker' },
      el('summary', {}, 'Columns'),
      el(
        'div',
        { class: 'column-menu' },
        this.type.fields.map((field) => {
          const box = el('input', { type: 'checkbox' });
          box.checked = this.visibleColumns().includes(field);
          box.addEventListener('change', () => {
            const current = this.visibleColumns().map((item) => item.id);
            const next = box.checked ? [...current, field.id] : current.filter((id) => id !== field.id);
            this.setDraft({ columns: this.type.fields.map((item) => item.id).filter((id) => next.includes(id)) }, { keepOpen: true });
          });
          return el('label', { class: 'check' }, box, field.name);
        }),
      ),
    );
    const mode = (name, label) =>
      el('button', { class: `mode-button${this.draft.mode === name ? ' active' : ''}`, 'aria-pressed': String(this.draft.mode === name), onclick: () => this.setDraft({ mode: name }) }, label);
    return el(
      'div',
      { class: 'browser-controls' },
      search,
      el('button', { class: `filter-toggle${this.draft.filters.length ? ' active' : ''}`, 'aria-expanded': String(this.filtersOpen), onclick: () => {
        this.filtersOpen = !this.filtersOpen;
        this.render();
      } }, 'Filter', this.draft.filters.length ? el('span', { class: 'badge' }, String(this.draft.filters.length)) : null),
      el('label', { class: 'sort-box' }, 'Sort ', sortField),
      direction,
      this.draft.mode === 'table' ? columns : null,
      el('span', { class: 'view-spacer' }),
      el('div', { class: 'mode-toggle', role: 'group', 'aria-label': 'Show as' }, mode('table', 'Table'), mode('cards', 'Cards')),
    );
  }

  setDraft(changes) {
    this.draft = { ...this.draft, ...changes };
    this.render();
  }

  // Filters

  filterPanel() {
    const fields = fieldsFor(this.type).filter((field) => field.id !== '@number' || this.type.numbering);
    const rows = this.draft.filters.map((filter, at) => this.filterRow(filter, at, fields));
    return el(
      'div',
      { class: 'filter-panel', role: 'group', 'aria-label': 'Filters' },
      rows.length ? rows : el('p', { class: 'quiet-note' }, 'No filters. Every record is shown.'),
      el('button', {
        class: 'add-filter',
        onclick: () => {
          const first = fields[0];
          this.setDraft({ filters: [...this.draft.filters, { field: first.id, test: FILTER_TESTS[first.kind][0], value: '' }] });
        },
      }, icon('plus'), 'Add a filter'),
    );
  }

  filterRow(filter, at, fields) {
    const field = fields.find((item) => item.id === filter.field) ?? fields[0];
    const update = (changes, redraw = true) => {
      const filters = this.draft.filters.map((item, place) => (place === at ? { ...item, ...changes } : item));
      if (redraw) this.setDraft({ filters });
      else {
        this.draft = { ...this.draft, filters };
        this.drawRecords();
        this.refreshTabsOnly();
      }
    };
    const fieldPick = el('select', { 'aria-label': 'Field' }, fields.map((item) => el('option', { value: item.id }, item.name)));
    fieldPick.value = field.id;
    fieldPick.addEventListener('change', () => {
      const next = fields.find((item) => item.id === fieldPick.value);
      update({ field: next.id, test: FILTER_TESTS[next.kind][0], value: '' });
    });
    const testPick = el('select', { 'aria-label': 'Test' }, FILTER_TESTS[field.kind].map((test) => el('option', { value: test }, TEST_LABELS[test])));
    testPick.value = filter.test;
    testPick.addEventListener('change', () => update({ test: testPick.value }));
    return el(
      'div',
      { class: 'filter-row' },
      fieldPick,
      testPick,
      NEEDS_VALUE.has(filter.test) ? this.valueControl(field, filter, update) : null,
      el('button', { class: 'row-action shown', title: 'Remove this filter', 'aria-label': 'Remove this filter', onclick: () => this.setDraft({ filters: this.draft.filters.filter((_, place) => place !== at) }) }, icon('close')),
    );
  }

  valueControl(field, filter, update) {
    if (field.kind === 'choice') {
      const select = el('select', { 'aria-label': 'Value' }, el('option', { value: '' }, '—'), (field.options ?? []).map((option) => el('option', { value: option }, option)));
      select.value = filter.value ?? '';
      select.addEventListener('change', () => update({ value: select.value }, false));
      return select;
    }
    if (field.kind === 'link') {
      const button = el('button', { class: 'filter-record' }, filter.value ? this.nameFor(filter.value) : 'Choose a record…');
      button.addEventListener('click', () =>
        openRecordPicker({
          api: this.api,
          anchor: button,
          typeId: field.to ?? null,
          onError: this.onError,
          onPick: (entry) => {
            this.names[entry.id] = entry.title;
            update({ value: entry.id });
          },
        }));
      return button;
    }
    const input = el('input', { type: field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text', 'aria-label': 'Value', value: filter.value ?? '' });
    input.addEventListener('input', () => update({ value: input.value }, false));
    return input;
  }

  nameFor(id) {
    const known = this.titleOf(id);
    if (known) return known;
    this.api.getRecord(id).then(({ record }) => {
      this.names[id] = record.title;
      if (this.filtersOpen) this.render();
    }).catch(() => {});
    return 'A record';
  }

  // The tabs say whether the draft has changed, which typing a filter value can change without a full redraw.
  refreshTabsOnly() {
    this.root.querySelector('.view-tabs')?.replaceWith(this.viewTabs());
  }

  async saveView(name, id) {
    try {
      const trimmed = name.trim();
      if (!trimmed) {
        this.onError('Give the view a name first.');
        return;
      }
      const view = { ...copy(this.draft), name: trimmed, ...(id ? { id } : {}) };
      const views = id ? this.type.views.map((item) => (item.id === id ? view : item)) : [...this.type.views, view];
      const saved = await this.api.saveRecordType({ id: this.type.id, views });
      this.data.type = saved;
      this.viewId = id ?? saved.views.at(-1).id;
      this.chooseView(this.viewId);
    } catch (error) {
      this.onError(error.message);
    }
  }

  async deleteView(view) {
    try {
      this.data.type = await this.api.saveRecordType({ id: this.type.id, views: this.type.views.filter((item) => item.id !== view.id) });
      this.chooseView(null);
    } catch (error) {
      this.onError(error.message);
    }
  }

  // Records

  empty() {
    const none = this.data.records.length === 0;
    return el(
      'div',
      { class: 'browser-empty' },
      el('p', {}, none ? `No ${this.type.title.toLowerCase()} records yet.` : 'Nothing matches.'),
      none ? el('button', { class: 'primary', onclick: () => this.onNewRecord(this.type) }, icon('plus'), `New ${this.type.title.toLowerCase()}`) : null,
    );
  }

  cell(field, record) {
    const raw = field.id === '@name' ? record.title : field.id === '@number' ? record.label : field.id === '@updated' ? record.updatedAt?.slice(0, 10) : record.values[field.id];
    if (field.kind === 'link' && Array.isArray(raw)) {
      return raw.map((id) => el('span', { class: 'chip small' }, this.titleOf(id) || '…'));
    }
    return field.id === '@number' ? raw : showValue(field, raw, this.titleOf);
  }

  table(records) {
    if (!records.length) return this.empty();
    const columns = this.visibleColumns();
    const heads = [
      ...(this.type.numbering ? [BUILT_IN[1]] : []),
      BUILT_IN[0],
      ...columns,
    ];
    const head = (field) => {
      const sorted = this.draft.sort.field === field.id;
      return el(
        'th',
        { scope: 'col', 'aria-sort': sorted ? (this.draft.sort.direction === 'up' ? 'ascending' : 'descending') : 'none' },
        el(
          'button',
          {
            class: 'sort-head',
            onclick: () => this.setDraft({ sort: { field: field.id, direction: sorted && this.draft.sort.direction === 'up' ? 'down' : 'up' } }),
          },
          field.name,
          sorted ? (this.draft.sort.direction === 'up' ? ' ↑' : ' ↓') : '',
        ),
      );
    };
    return el(
      'div',
      { class: 'record-table-wrap' },
      el(
        'table',
        { class: 'record-table' },
        el('thead', {}, el('tr', {}, heads.map(head))),
        el(
          'tbody',
          {},
          records.map((record) =>
            el(
              'tr',
              { class: 'record-row', tabindex: '0', dataset: { id: record.id }, onclick: () => this.onOpenRecord(record.id), onkeydown: (event) => {
                if (event.key === 'Enter') this.onOpenRecord(record.id);
              } },
              heads.map((field) => el('td', { class: field.id === '@name' ? 'name-cell' : '' }, this.cell(field, record))),
            )),
        ),
      ),
    );
  }

  cards(records) {
    if (!records.length) return this.empty();
    const shown = this.visibleColumns().filter((field) => field.kind !== 'longtext').slice(0, CARD_FIELDS);
    return el(
      'div',
      { class: 'record-cards' },
      records.map((record) =>
        el(
          'button',
          { class: 'record-card', dataset: { id: record.id }, onclick: () => this.onOpenRecord(record.id) },
          el('span', { class: 'card-title' }, record.title || 'Untitled'),
          record.label ? el('span', { class: 'card-number' }, record.label) : null,
          el(
            'dl',
            {},
            shown.flatMap((field) => {
              const text = showValue(field, record.values[field.id], this.titleOf);
              return text ? [el('dt', {}, field.name), el('dd', {}, text)] : [];
            }),
          ),
        )),
    );
  }
}
