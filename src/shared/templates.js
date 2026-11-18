'use strict';
// Ways to start. A template is only a set of record types, made for you in one go. Nothing here is built into the app:
// once they're made they're ordinary types, and every field, choice and number can be changed or removed.
// `to` in a link field names another type in the same template by its key.

const STATUS = { name: 'Status', kind: 'choice', options: ['Draft', 'Frozen'] };

const TEMPLATES = [
  {
    id: 'novel',
    name: 'A single novel',
    summary: 'Characters and places, with a few fields to start. The plainest way to begin.',
    types: [
      {
        key: 'character',
        name: 'Character',
        fields: [
          { name: 'Role', kind: 'choice', options: ['Main', 'Supporting', 'Minor'] },
          { name: 'Age', kind: 'number' },
          { name: 'Appearance', kind: 'longtext' },
          { name: 'Wants', kind: 'longtext' },
          { name: 'Friends and family', kind: 'link', to: 'character' },
        ],
      },
      {
        key: 'place',
        name: 'Place',
        fields: [
          { name: 'Kind', kind: 'choice', options: ['City', 'Town', 'Building', 'Region', 'Other'] },
          { name: 'Part of', kind: 'link', to: 'place', many: false },
          { name: 'Description', kind: 'longtext' },
        ],
      },
    ],
  },
  {
    id: 'series',
    name: 'A series',
    summary: 'Characters, places, objects and groups that carry from book to book, with where each first appears.',
    types: [
      {
        key: 'character',
        name: 'Character',
        fields: [
          { name: 'Role', kind: 'choice', options: ['Main', 'Supporting', 'Minor'] },
          { name: 'First appears', kind: 'text' },
          { name: 'Books', kind: 'choice', many: true, options: [] },
          { name: 'Group', kind: 'link', to: 'group', many: false },
          { name: 'Appearance', kind: 'longtext' },
        ],
      },
      {
        key: 'place',
        name: 'Place',
        fields: [
          { name: 'Kind', kind: 'choice', options: ['City', 'Town', 'Building', 'Region', 'Other'] },
          { name: 'Part of', kind: 'link', to: 'place', many: false },
          { name: 'Ruled by', kind: 'link', to: 'group', many: false },
          { name: 'Description', kind: 'longtext' },
        ],
      },
      {
        key: 'object',
        name: 'Object',
        fields: [
          { name: 'Kind', kind: 'text' },
          { name: 'Owner', kind: 'link', to: 'character', many: false },
          { name: 'Found at', kind: 'link', to: 'place', many: false },
          { name: 'Description', kind: 'longtext' },
        ],
      },
      {
        key: 'group',
        name: 'Group',
        fields: [
          { name: 'Kind', kind: 'choice', options: ['Family', 'Order', 'Company', 'Army', 'Other'] },
          { name: 'Leader', kind: 'link', to: 'character', many: false },
          { name: 'Description', kind: 'longtext' },
        ],
      },
    ],
  },
  {
    id: 'universe',
    name: 'A shared universe',
    summary: 'Many series in one world. Numbered records, with a Draft or Frozen status, and room for number ranges per series.',
    types: [
      {
        key: 'character',
        name: 'Character',
        numbering: { prefix: 'C-', digits: 4 },
        fields: [
          STATUS,
          { name: 'Series', kind: 'choice', many: true, options: [] },
          { name: 'Home', kind: 'link', to: 'place', many: false },
          { name: 'Allies', kind: 'link', to: 'character' },
          { name: 'Summary', kind: 'longtext' },
        ],
      },
      {
        key: 'weapon',
        name: 'Weapon',
        numbering: { prefix: 'W-', digits: 3 },
        fields: [
          STATUS,
          { name: 'Made of', kind: 'link', to: 'material' },
          { name: 'Wielded by', kind: 'link', to: 'character' },
          { name: 'Summary', kind: 'longtext' },
        ],
      },
      {
        key: 'material',
        name: 'Material',
        numbering: { prefix: 'M-', digits: 3 },
        fields: [STATUS, { name: 'Found at', kind: 'link', to: 'place' }, { name: 'Summary', kind: 'longtext' }],
      },
      {
        key: 'place',
        name: 'Place',
        numbering: { prefix: 'P-', digits: 3 },
        fields: [
          STATUS,
          { name: 'Kind', kind: 'choice', options: ['Planet', 'Region', 'City', 'Building', 'Other'] },
          { name: 'Part of', kind: 'link', to: 'place', many: false },
          { name: 'Ruled by', kind: 'link', to: 'character', many: false },
          { name: 'Summary', kind: 'longtext' },
        ],
      },
    ],
  },
];

module.exports = { TEMPLATES };
