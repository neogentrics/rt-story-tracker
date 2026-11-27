// One record, as a page: its name and number, its fields, its notes, and everything that links to it. It saves by
// itself, the same way a chapter does. The same page is used beside the writing, so a record can be looked at without
// leaving the chapter.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Saver } from '../shared/saver.js';
import { readNumber } from '../shared/records.js';
import { toDocument } from '../shared/text.js';
import { el, fill, oneLine } from './dom.js';
import { icon } from './icons.js';
import { MentionMark, mentionSuggestions } from './mentions.js';
import { openRecordPicker } from './record-picker.js';
import { openFreeze, openPrintRecords } from './record-versions.js';

const STATE = { unsaved: 'Editing', saving: 'Saving…', saved: 'Saved', failed: 'Couldn’t save. Trying again…' };

export class RecordPage {
  constructor(root, { api, onError, onOpenRecord, onOpenChapter, onOpenVersion, onSaved, onTrashed, compact = false }) {
    this.api = api;
    this.onError = onError;
    this.onOpenRecord = onOpenRecord;
    this.onOpenChapter = onOpenChapter;
    this.onOpenVersion = onOpenVersion;
    this.onSaved = onSaved;
    this.onTrashed = onTrashed;
    this.compact = compact;
    this.data = null;
    this.editor = null;
    this.printEditor = null;
    this.notesTouched = false;
    this.printTouched = false;
    this.confirmedLock = false;

    this.saver = new Saver({
      read: () => this.snapshot(),
      write: (input) => this.write(input),
      onState: (state, error) => this.showState(state, error),
    });
    this.root = el('div', { class: `record-page${compact ? ' compact' : ''}` });
    root.replaceChildren(this.root);
  }

  get id() {
    return this.data?.record.id ?? null;
  }

  snapshot() {
    return {
      id: this.data.record.id,
      title: this.title,
      number: this.number,
      values: structuredClone(this.values),
      ...(this.notesTouched ? { notes: JSON.stringify(this.editor.getJSON()) } : {}),
      ...(this.printTouched ? { printNotes: JSON.stringify(this.printEditor.getJSON()) } : {}),
      // Only once the author has said yes to changing a record that's under canon lock.
      ...(this.data.record.locked && this.confirmedLock ? { confirmLocked: true } : {}),
    };
  }

  async write(input) {
    try {
      const saved = await this.api.saveRecord(input);
      if (input.notes !== undefined && this.snapshotNotesStillCurrent(input.notes)) this.notesTouched = false;
      if (input.printNotes !== undefined && JSON.stringify(this.printEditor.getJSON()) === input.printNotes) this.printTouched = false;
      Object.assign(this.data.record, { updatedAt: saved.updatedAt, number: saved.number, label: saved.label });
      this.onSaved?.(saved);
    } catch (error) {
      // Canon lock, and a number someone else has, are the author's to settle. Trying again would only say the same thing every few seconds.
      if (/^Canon lock/.test(error.message)) {
        this.onError(error.message);
        this.confirmedLock = false;
        this.applyLock();
        return;
      }
      if (!/already used/.test(error.message)) throw error;
      this.onError(error.message);
      this.number = this.data.record.number;
      this.numberInput.value = this.data.record.label;
    }
  }

  snapshotNotesStillCurrent(saved) {
    return JSON.stringify(this.editor.getJSON()) === saved;
  }

  showState(state, error) {
    if (!this.stateLabel) return;
    this.stateLabel.textContent = STATE[state];
    this.stateLabel.dataset.state = state;
    if (state === 'failed') this.onError(error.message);
  }

  async open(id, { fresh = false } = {}) {
    await this.flush();
    this.data = await this.api.getRecord(id);
    const { record } = this.data;
    this.title = record.title;
    this.number = record.number;
    this.values = structuredClone(record.values);
    this.notesTouched = false;
    this.printTouched = false;
    this.confirmedLock = false;
    this.render();
    if (fresh) {
      this.titleInput.focus();
      this.titleInput.select();
    }
  }

  async flush() {
    if (this.data) await this.saver.flush();
  }

  destroy() {
    this.editor?.destroy();
    this.printEditor?.destroy();
    this.printEditor = null;
    this.editor = null;
    this.data = null;
    this.root.replaceChildren();
  }

  render() {
    const { type, record } = this.data;
    this.editor?.destroy();
    this.printEditor?.destroy();
    this.printEditor = null;
    // A text area, so a long name wraps. It still holds one line of text.
    this.titleInput = el('textarea', {
      class: 'record-title',
      rows: '1',
      maxlength: '500',
      'aria-label': 'Name',
      oninput: () => {
        oneLine(this.titleInput);
        this.title = this.titleInput.value;
        this.saver.touch();
      },
      onkeydown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.root.querySelector('.record-fields :is(input, select, textarea)')?.focus();
        }
      },
    });
    this.titleInput.value = record.title;
    this.stateLabel = el('span', { class: 'save-state', role: 'status', dataset: { state: 'saved' } }, STATE.saved);
    const head = el(
      'header',
      { class: 'record-head' },
      el('span', { class: 'type-chip' }, type.title),
      this.titleInput,
      type.numbering ? this.numberControl(type) : null,
      this.lockControl(),
      this.stateLabel,
      el('button', { class: 'row-action print-record', title: 'Print this record', 'aria-label': `Print ${record.title}`, onclick: () => this.print() }, icon('print')),
      el('button', { class: 'row-action', title: 'Move to Trash', 'aria-label': `Move ${record.title} to Trash`, onclick: () => this.trash() }, icon('trash')),
    );
    this.fieldsBox = el('div', { class: 'record-fields' }, type.fields.map((field) => this.fieldRow(field)));
    this.notesHost = el('div', { class: 'record-notes-host' });
    this.printHost = el('div', { class: 'record-notes-host print-notes-host' });
    this.lockBanner = el('div', { class: 'lock-banner', role: 'status', hidden: true });
    this.backlinksBox = el('section', { class: 'record-backlinks', 'aria-label': 'Linked from' });
    this.root.replaceChildren(
      head,
      this.lockBanner,
      this.versionStrip(),
      el(
        'div',
        { class: 'record-body' },
        type.fields.length ? this.fieldsBox : el('p', { class: 'quiet-note' }, 'This kind of record has no fields yet. Add some with Edit type.'),
        type.versioning
          ? [
              el('section', { class: 'record-notes' }, el('h3', {}, 'Notes for print'), el('p', { class: 'quiet-note' }, 'These can be printed and exported.'), this.printHost),
              el('section', { class: 'record-notes author-notes' }, el('h3', {}, 'Author-only notes'), el('p', { class: 'quiet-note' }, 'Never printed, exported or shown to another app.'), this.notesHost),
            ]
          : el('section', { class: 'record-notes' }, el('h3', {}, 'Notes'), this.notesHost),
        this.backlinksBox,
      ),
    );
    this.buildNotes();
    this.renderBacklinks();
    this.applyLock();
  }

  // Versions: the frozen ones, and the one being edited, which is the next.
  versionStrip() {
    const { type, versions, revision } = this.data;
    if (!type.versioning || this.compact) return null;
    return el(
      'div',
      { class: 'version-strip', role: 'group', 'aria-label': 'Versions' },
      versions.map((version) =>
        el('button', { class: 'version-chip frozen', dataset: { version: version.id }, onclick: () => this.onOpenVersion?.(version.id) }, `Revision ${version.number}`, el('small', {}, ` · ${version.bookTitle} · frozen`))),
      el('span', { class: 'version-chip current' }, `Revision ${revision}`, el('small', {}, ' · draft, being edited')),
      this.data.corrections.length ? el('span', { class: 'quiet-note correction-count' }, `${this.data.corrections.length} ${this.data.corrections.length === 1 ? 'correction' : 'corrections'} waiting for this revision`) : null,
      el('button', { id: 'freeze-record', class: 'freeze-button', onclick: () => this.freeze() }, icon('lock'), 'Freeze…'),
    );
  }

  async freeze() {
    try {
      await this.flush();
      const { record, revision } = this.data;
      await openFreeze({
        api: this.api,
        record: { ...record, title: this.title },
        revision,
        covered: this.data.versions.map((version) => version.bookId),
        onError: this.onError,
        onDone: async () => {
          await this.open(record.id);
        },
      });
    } catch (error) {
      this.onError(error.message);
    }
  }

  print() {
    return this.flush().then(() => openPrintRecords({ api: this.api, type: this.data.type, ids: [this.data.record.id], onError: this.onError })).catch((error) => this.onError(error.message));
  }

  // Canon lock: a locked record can be read, and changes only after the author has said yes.
  lockControl() {
    const box = el('input', { type: 'checkbox', id: 'canon-lock' });
    box.checked = this.data.record.locked;
    box.addEventListener('change', async () => {
      const wanted = box.checked;
      try {
        if (!wanted && !this.confirmedLock && !window.confirm(`“${this.title}” is under canon lock. Take the lock off?`)) {
          box.checked = true;
          return;
        }
        await this.flush();
        const saved = await this.api.saveRecord({ id: this.data.record.id, locked: wanted, ...(this.data.record.locked ? { confirmLocked: true } : {}) });
        this.data.record.locked = saved.locked;
        this.confirmedLock = false;
        this.applyLock();
      } catch (error) {
        box.checked = !wanted;
        this.onError(error.message);
      }
    });
    return el('label', { class: 'check canon-lock', title: 'A locked record asks before it changes' }, box, 'Canon lock');
  }

  // While it's locked the page can't be typed in. “Edit anyway” asks once, and then it can until the page is closed.
  applyLock() {
    const locked = this.data.record.locked && !this.confirmedLock;
    this.root.classList.toggle('canon-locked', locked);
    for (const node of this.root.querySelectorAll('.record-title, .record-number, .next-number, .range-pick, .record-fields :is(input, select, textarea, button)')) node.disabled = locked;
    this.editor?.setEditable(!locked);
    this.printEditor?.setEditable(!locked);
    this.lockBanner.hidden = !this.data.record.locked;
    if (!this.data.record.locked) return;
    fill(
      this.lockBanner,
      icon('lock'),
      el('span', {}, locked ? `“${this.title}” is under canon lock. It’s settled, so it asks before it changes.` : 'You’ve chosen to change a locked record. It stays locked.'),
      locked ? el('button', { id: 'edit-anyway', onclick: () => {
        if (!window.confirm(`“${this.title}” is under canon lock. Change it anyway?`)) return;
        this.confirmedLock = true;
        this.applyLock();
      } }, 'Edit anyway') : null,
    );
  }

  numberControl(type) {
    const { numbering } = type;
    this.numberInput = el('input', {
      class: 'record-number',
      type: 'text',
      'aria-label': 'Number',
      placeholder: `${numbering.prefix}${'0'.repeat(Math.max(numbering.digits - 1, 0))}1`,
      value: this.data.record.label,
      onchange: () => this.typedNumber(),
    });
    const range = numbering.ranges.length
      ? el('select', { class: 'range-pick', 'aria-label': 'Number range' }, el('option', { value: '' }, 'Any range'), numbering.ranges.map((item) => el('option', { value: item.id }, `${item.name} (${item.from}–${item.to})`)))
      : null;
    this.rangePick = range;
    return el(
      'div',
      { class: 'record-number-box' },
      this.numberInput,
      range,
      el('button', { type: 'button', class: 'next-number', title: 'Give this the next free number', onclick: () => this.nextNumber() }, 'Next free'),
    );
  }

  typedNumber() {
    const typed = this.numberInput.value.trim();
    const number = readNumber(this.data.type.numbering, typed);
    if (typed && number === null) {
      this.onError(`“${typed}” isn’t a number here. Numbers look like ${this.data.type.numbering.prefix}001.`);
      this.numberInput.value = this.data.record.label;
      return;
    }
    this.number = number;
    this.saver.touch();
  }

  async nextNumber() {
    try {
      const { number, label } = await this.api.nextRecordNumber({ typeId: this.data.type.id, rangeId: this.rangePick?.value || null });
      if (number === null) {
        this.onError('That range is full.');
        return;
      }
      this.number = number;
      this.numberInput.value = label;
      this.saver.touch();
    } catch (error) {
      this.onError(error.message);
    }
  }

  changed() {
    this.saver.touch();
  }

  fieldRow(field) {
    const id = `field-${field.id}`;
    const control = this.control(field, id);
    const plain = field.kind === 'yesno' || field.kind === 'link' || (field.kind === 'choice' && field.many);
    const first = plain ? el('span', { class: 'field-label' }, field.name) : el('label', { for: id }, field.name);
    // In a kind that keeps versions, a field that isn't for print says so, since it will never be printed or exported.
    if (this.data.type.versioning && (field.audience ?? 'author') === 'author') first.append(el('small', { class: 'author-tag' }, ' author only'));
    return el('div', { class: `record-field kind-${field.kind}`, dataset: { field: field.id } }, first, control);
  }

  control(field, id) {
    const value = this.values[field.id];
    const set = (next) => {
      if (next === undefined || next === '' || (Array.isArray(next) && !next.length)) delete this.values[field.id];
      else this.values[field.id] = next;
      this.changed();
    };
    switch (field.kind) {
      case 'longtext': {
        const area = el('textarea', { id, rows: '3', class: 'grow' });
        area.value = value ?? '';
        const fit = () => {
          if (!area.scrollHeight) return;
          area.style.height = 'auto';
          area.style.height = `${Math.min(area.scrollHeight + 2, 480)}px`;
        };
        area.addEventListener('input', () => {
          set(area.value);
          fit();
        });
        queueMicrotask(fit);
        return area;
      }
      case 'number': {
        const input = el('input', { id, type: 'number', step: 'any' });
        input.value = value ?? '';
        input.addEventListener('input', () => set(input.value === '' ? undefined : Number(input.value)));
        return input;
      }
      case 'date': {
        const input = el('input', { id, type: 'date' });
        input.value = value ?? '';
        input.addEventListener('input', () => set(input.value));
        return input;
      }
      case 'yesno': {
        const box = el('input', { id, type: 'checkbox' });
        box.checked = value === true;
        box.addEventListener('change', () => set(box.checked ? true : undefined));
        return el('label', { class: 'check', for: id }, box, 'Yes');
      }
      case 'choice':
        return field.many ? this.manyChoices(field, set) : this.oneChoice(field, id, set);
      case 'link':
        return this.linkControl(field, set);
      default: {
        const input = el('input', { id, type: 'text', maxlength: '2000' });
        input.value = value ?? '';
        input.addEventListener('input', () => set(input.value));
        return input;
      }
    }
  }

  oneChoice(field, id, set) {
    const current = this.values[field.id];
    const known = field.options.includes(current) || current === undefined ? field.options : [...field.options, current];
    const select = el('select', { id }, el('option', { value: '' }, '—'), known.map((option) => el('option', { value: option }, option)));
    select.value = current ?? '';
    select.addEventListener('change', () => set(select.value || undefined));
    return select;
  }

  manyChoices(field, set) {
    const current = this.values[field.id] ?? [];
    const options = [...field.options, ...current.filter((item) => !field.options.includes(item))];
    if (!options.length) return el('span', { class: 'quiet-note' }, 'No choices yet. Add some with Edit type.');
    const boxes = options.map((option) => {
      const box = el('input', { type: 'checkbox' });
      box.checked = current.includes(option);
      box.addEventListener('change', () => set(boxes.filter((item) => item.box.checked).map((item) => item.option)));
      return { option, box };
    });
    return el('div', { class: 'choice-list' }, boxes.map(({ option, box }) => el('label', { class: 'check' }, box, option)));
  }

  linkControl(field, set) {
    const wrap = el('div', { class: 'link-list' });
    const draw = () => {
      const ids = this.values[field.id] ?? [];
      const chips = ids.map((id) => {
        const target = this.data.targets[id];
        return el(
          'span',
          { class: `chip${target?.trashed ? ' trashed' : ''}`, dataset: { id } },
          el('button', { type: 'button', class: 'chip-open', title: 'Open', onclick: () => this.follow(id) }, target?.title ?? 'Unknown', target?.trashed ? el('small', {}, ' (in the Trash)') : null),
          el('button', {
            type: 'button',
            class: 'chip-remove',
            title: 'Remove this link',
            'aria-label': `Remove link to ${target?.title ?? 'record'}`,
            onclick: () => {
              set(ids.filter((other) => other !== id));
              draw();
            },
          }, icon('close')),
        );
      });
      const toType = field.to ? this.data.knownTypes?.find((type) => type.id === field.to) : null;
      const add = el('button', { type: 'button', class: 'chip-add', onclick: () => this.pick(field, add, set, draw) }, icon('plus'), ids.length && !field.many ? 'Change' : 'Link');
      add.dataset.to = toType?.title ?? '';
      wrap.replaceChildren(...chips, add);
    };
    draw();
    return wrap;
  }

  async pick(field, anchor, set, draw) {
    const types = this.data.knownTypes ?? (this.data.knownTypes = (await this.api.recordsOverview()).types);
    const target = field.to ? types.find((type) => type.id === field.to) : null;
    openRecordPicker({
      api: this.api,
      anchor,
      typeId: target?.id ?? null,
      typeTitle: target?.title ?? '',
      exclude: [this.data.record.id, ...(this.values[field.id] ?? [])],
      onError: this.onError,
      onPick: async (entry) => {
        this.data.targets[entry.id] = { title: entry.title, typeId: entry.typeId, typeTitle: entry.typeTitle, trashed: false };
        const current = this.values[field.id] ?? [];
        set(field.many ? [...current, entry.id] : [entry.id]);
        draw();
      },
    });
  }

  follow(id) {
    this.onOpenRecord(id);
  }

  buildNotes() {
    const versioning = this.data.type.versioning;
    this.editor = new Editor({
      element: this.notesHost,
      injectCSS: false,
      extensions: [
        StarterKit.configure({ code: false, codeBlock: false, link: false, heading: { levels: [2, 3] } }),
        MentionMark.configure({ onOpen: (id) => this.onOpenRecord(id) }),
        mentionSuggestions({ api: this.api, onError: this.onError, selfId: () => this.id }),
      ],
      content: toDocument(this.data.notes),
      editorProps: { attributes: { class: 'record-notes-text', role: 'textbox', 'aria-multiline': 'true', 'aria-label': versioning ? 'Author-only notes' : 'Notes', spellcheck: 'true' } },
      onUpdate: () => {
        this.notesTouched = true;
        this.saver.touch();
      },
    });
    if (!versioning) return;
    this.printEditor = new Editor({
      element: this.printHost,
      injectCSS: false,
      extensions: [StarterKit.configure({ code: false, codeBlock: false, link: false, heading: { levels: [2, 3] } })],
      content: toDocument(this.data.printNotes),
      editorProps: { attributes: { class: 'record-notes-text', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Notes for print', spellcheck: 'true' } },
      onUpdate: () => {
        this.printTouched = true;
        this.saver.touch();
      },
    });
  }

  renderBacklinks() {
    const { backlinks } = this.data;
    if (!backlinks.length) {
      this.backlinksBox.replaceChildren(el('h3', {}, 'Linked from'), el('p', { class: 'quiet-note' }, 'Nothing links here yet. A link from another record, or an @ in a chapter, shows up here.'));
      return;
    }
    const records = backlinks.filter((item) => item.kind === 'record');
    const chapters = backlinks.filter((item) => item.kind === 'chapter');
    const row = (item) =>
      el(
        'li',
        {},
        el(
          'button',
          { class: 'backlink', onclick: () => (item.kind === 'record' ? this.onOpenRecord(item.id) : this.onOpenChapter?.(item.id)) },
          el('span', { class: 'backlink-title' }, item.title || 'Untitled'),
          el('span', { class: 'backlink-note' }, item.kind === 'record' ? [item.context, item.via].filter(Boolean).join(' · ') : item.context),
        ),
      );
    fill(
      this.backlinksBox,
      el('h3', {}, 'Linked from'),
      records.length ? el('ul', { class: 'backlink-list', 'aria-label': 'Records that link here' }, records.map(row)) : null,
      chapters.length ? el('h4', {}, 'Mentioned in chapters') : null,
      chapters.length ? el('ul', { class: 'backlink-list', 'aria-label': 'Chapters that mention this' }, chapters.map(row)) : null,
    );
  }

  async trash() {
    try {
      await this.flush();
      const { record } = this.data;
      await this.api.trashItem(record.id);
      this.onTrashed?.(record);
    } catch (error) {
      this.onError(error.message);
    }
  }
}
