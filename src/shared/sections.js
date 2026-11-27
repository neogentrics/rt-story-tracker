'use strict';
// The sections a book's files are sorted into, in the order they're shown. Plain data, so the app and the window use the same words.
const SECTIONS = [
  { id: 'cover', label: 'Covers' },
  { id: 'art', label: 'Art' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'notes', label: 'Notes' },
  { id: 'finished', label: 'Finished copies' },
  { id: 'other', label: 'Other files' },
];
const SECTION_IDS = new Set(SECTIONS.map((section) => section.id));
const sectionLabel = (id) => (SECTIONS.find((section) => section.id === id) ?? SECTIONS.at(-1)).label;

module.exports = { SECTIONS, SECTION_IDS, sectionLabel };
