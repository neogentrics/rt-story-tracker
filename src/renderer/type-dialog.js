// Making and changing a kind of record: its name, its fields, and how its records are numbered.
import { FIELD_KINDS, KIND_LABELS } from '../shared/records.js';
import { el } from './dom.js';
import { icon } from './icons.js';

const SELF = '@self';

function blankField() {
  return { name: '', kind: 'text' };
}

function numberingDraft(numbering) {
  return numbering ? { prefix: numbering.prefix, digits: numbering.digits, ranges: numbering.ranges.map((range) => ({ ...range })) } : null;
}

export function openTypeDialog({ api, type = null, types, onSaved, onError }) {
  document.getElementById('type-dialog')?.remove();
  const draft = {
    title: type?.title ?? '',
    fields: type ? type.fields.map((field) => ({ ...field, options: [...(field.options ?? [])] })) : [blankField()],
    numbering: numberingDraft(type?.numbering ?? null),
  };

  const fieldList = el('ol', { class: 'field-editor', 'aria-label': 'Fields' });
  const numberBox = el('div', { class: 'numbering-editor' });
  const name = el('input', { id: 'type-name', type: 'text', maxlength: '500', value: draft.title, 'aria-label': 'Name of this kind of record', placeholder: 'Character, Place, Weapon…' });
  name.addEventListener('input', () => {
    draft.title = name.value;
  });

  const move = (at, step) => {
    const to = at + step;
    if (to < 0 || to >= draft.fields.length) return;
    [draft.fields[at], draft.fields[to]] = [draft.fields[to], draft.fields[at]];
    drawFields();
  };

  const drawField = (field, at) => {
    const kind = el('select', { 'aria-label': 'Kind of field' }, FIELD_KINDS.map((item) => el('option', { value: item }, KIND_LABELS[item])));
    kind.value = field.kind;
    kind.addEventListener('change', () => {
      field.kind = kind.value;
      if (field.kind === 'choice') field.options ??= [];
      drawFields();
    });
    const fieldName = el('input', { type: 'text', maxlength: '200', value: field.name, 'aria-label': 'Field name', placeholder: 'Field name' });
    fieldName.addEventListener('input', () => {
      field.name = fieldName.value;
    });
    const extra = [];
    if (field.kind === 'choice') {
      const choices = el('textarea', { rows: '3', 'aria-label': 'Choices, one per line', placeholder: 'One choice per line' });
      choices.value = (field.options ?? []).join('\n');
      choices.addEventListener('input', () => {
        field.options = choices.value.split('\n');
      });
      const many = el('input', { type: 'checkbox' });
      many.checked = Boolean(field.many);
      many.addEventListener('change', () => {
        field.many = many.checked;
      });
      extra.push(el('div', { class: 'field-extra' }, choices, el('label', { class: 'check' }, many, 'Allow more than one')));
    }
    if (field.kind === 'link') {
      const target = el(
        'select',
        { 'aria-label': 'Links to' },
        el('option', { value: '' }, 'Any kind of record'),
        el('option', { value: type ? type.id : SELF }, 'This kind of record'),
        types.filter((other) => other.id !== type?.id).map((other) => el('option', { value: other.id }, other.title)),
      );
      target.value = field.to ?? '';
      target.addEventListener('change', () => {
        if (target.value) field.to = target.value;
        else delete field.to;
      });
      const many = el('input', { type: 'checkbox' });
      many.checked = field.many !== false;
      many.addEventListener('change', () => {
        field.many = many.checked;
      });
      extra.push(el('div', { class: 'field-extra' }, el('label', {}, 'Links to ', target), el('label', { class: 'check' }, many, 'Allow more than one')));
    }
    return el(
      'li',
      { class: 'field-item' },
      el(
        'div',
        { class: 'field-line' },
        fieldName,
        kind,
        el('button', { type: 'button', class: 'row-action shown', title: 'Move up', 'aria-label': 'Move up', disabled: at === 0, onclick: () => move(at, -1) }, '↑'),
        el('button', { type: 'button', class: 'row-action shown', title: 'Move down', 'aria-label': 'Move down', disabled: at === draft.fields.length - 1, onclick: () => move(at, 1) }, '↓'),
        el('button', {
          type: 'button',
          class: 'row-action shown',
          title: 'Remove this field',
          'aria-label': 'Remove this field',
          onclick: () => {
            draft.fields.splice(at, 1);
            drawFields();
          },
        }, icon('close')),
      ),
      ...extra,
    );
  };

  const drawFields = () => {
    fieldList.replaceChildren(...draft.fields.map(drawField));
  };

  const drawNumbering = () => {
    const on = el('input', { type: 'checkbox', id: 'numbering-on' });
    on.checked = Boolean(draft.numbering);
    on.addEventListener('change', () => {
      draft.numbering = on.checked ? { prefix: '', digits: 3, ranges: [] } : null;
      drawNumbering();
    });
    const parts = [el('label', { class: 'check', for: 'numbering-on' }, on, 'Number the records')];
    if (draft.numbering) {
      const numbering = draft.numbering;
      const prefix = el('input', { type: 'text', maxlength: '12', value: numbering.prefix, 'aria-label': 'Prefix', placeholder: 'W-' });
      prefix.addEventListener('input', () => {
        numbering.prefix = prefix.value;
      });
      const digits = el('input', { type: 'number', min: '1', max: '8', value: String(numbering.digits), 'aria-label': 'Digits' });
      digits.addEventListener('input', () => {
        numbering.digits = Number(digits.value) || 3;
      });
      parts.push(
        el('div', { class: 'numbering-line' }, el('label', {}, 'Prefix ', prefix), el('label', {}, 'Digits ', digits)),
        el('p', { class: 'quiet-note' }, 'A new record gets the next free number. Ranges keep each series in its own set of numbers.'),
        ...numbering.ranges.map((range, at) => {
          const rangeName = el('input', { type: 'text', value: range.name, 'aria-label': 'Range name', placeholder: 'Series name' });
          rangeName.addEventListener('input', () => {
            range.name = rangeName.value;
          });
          const from = el('input', { type: 'number', min: '0', value: String(range.from), 'aria-label': 'First number' });
          from.addEventListener('input', () => {
            range.from = Number(from.value);
          });
          const to = el('input', { type: 'number', min: '0', value: String(range.to), 'aria-label': 'Last number' });
          to.addEventListener('input', () => {
            range.to = Number(to.value);
          });
          return el(
            'div',
            { class: 'range-line' },
            rangeName,
            from,
            el('span', {}, 'to'),
            to,
            el('button', {
              type: 'button',
              class: 'row-action shown',
              title: 'Remove this range',
              'aria-label': 'Remove this range',
              onclick: () => {
                numbering.ranges.splice(at, 1);
                drawNumbering();
              },
            }, icon('close')),
          );
        }),
        el('button', {
          type: 'button',
          onclick: () => {
            const last = numbering.ranges.at(-1);
            const from = last ? last.to + 1 : 1;
            numbering.ranges.push({ name: '', from, to: from + 99 });
            drawNumbering();
          },
        }, icon('plus'), 'Add a range'),
      );
    }
    numberBox.replaceChildren(...parts);
  };

  const save = async () => {
    try {
      const fields = draft.fields.filter((field) => field.name.trim() || field.kind !== 'text');
      const numbering = draft.numbering;
      const payload = {
        title: draft.title,
        fields: fields.map((field) => ({ ...field, ...(field.to === SELF ? { to: undefined } : {}), options: field.kind === 'choice' ? field.options : undefined })),
        numbering,
      };
      let saved;
      if (type) {
        saved = await api.saveRecordType({ id: type.id, ...payload });
      } else {
        saved = await api.createRecordType(payload);
        // A link to its own kind can only be named once the kind exists.
        const own = fields.map((field, at) => (field.to === SELF ? saved.fields[at]?.id : null)).filter(Boolean);
        if (own.length) {
          saved = await api.saveRecordType({
            id: saved.id,
            fields: saved.fields.map((field) => (own.includes(field.id) ? { ...field, to: saved.id } : field)),
          });
        }
      }
      dialog.close();
      await onSaved(saved);
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
    }
  };

  const message = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const dialog = el(
    'dialog',
    { id: 'type-dialog', class: 'dialog wide' },
    el('h2', {}, type ? `Edit ${type.title}` : 'A new kind of record'),
    el('label', { class: 'field', for: 'type-name' }, el('span', {}, 'Name'), name),
    el('h3', {}, 'Fields'),
    el('p', { class: 'quiet-note' }, 'Every record also has a name and notes. Removing a field hides what was typed in it.'),
    fieldList,
    el('button', {
      type: 'button',
      id: 'add-field',
      onclick: () => {
        draft.fields.push(blankField());
        drawFields();
        fieldList.lastElementChild.querySelector('input')?.focus();
      },
    }, icon('plus'), 'Add a field'),
    el('h3', {}, 'Numbering'),
    numberBox,
    message,
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      el('button', { id: 'type-save', class: 'primary', type: 'button', onclick: () => save() }, 'Save'),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  drawFields();
  drawNumbering();
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
  return dialog;
}

// The ways to start, as cards, for the empty screen and for the dialog.
export function templateCards({ api, templates, onDone, onError }) {
  return el(
    'ul',
    { class: 'template-list' },
    templates.map((template) =>
      el(
        'li',
        { class: 'template-card', dataset: { template: template.id } },
        el('div', {}, el('strong', {}, template.name), el('p', { class: 'quiet-note' }, template.summary), el('p', { class: 'template-types' }, template.types.join(' · '))),
        el('button', {
          type: 'button',
          class: 'primary use-template',
          onclick: async () => {
            try {
              await onDone(await api.applyRecordTemplate(template.id));
            } catch (error) {
              onError(error.message);
            }
          },
        }, 'Use this'),
      )),
  );
}

// A starting point: a few kinds of record, made for you in one go.
export async function openTemplates({ api, onDone, onError }) {
  document.getElementById('template-dialog')?.remove();
  const templates = await api.recordTemplates();
  const dialog = el(
    'dialog',
    { id: 'template-dialog', class: 'dialog' },
    el('h2', {}, 'Start from a template'),
    el('p', { class: 'quiet-note' }, 'It only makes the kinds of record below. You can change or remove any of them afterwards.'),
    templateCards({
      api,
      templates,
      onError,
      onDone: async (result) => {
        dialog.close();
        await onDone(result);
      },
    }),
    el('div', { class: 'dialog-actions' }, el('button', { type: 'button', onclick: () => dialog.close() }, 'Close')),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
