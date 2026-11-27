'use strict';
// A set of records as a PDF. Each record starts a new page, headed by its label, such as “Record 0100 · Revision 2”. The pages
// are the printable part only: the caller hands over what printable() made, and nothing here can reach anything else.
const { PDFDocument } = require('pdf-lib');
const { recordsHtml } = require('./printable');
const { render } = require('./pdf');

async function recordsPdf(pages, title) {
  const document = await PDFDocument.load(await render(recordsHtml(pages, title), false));
  document.setTitle(title);
  document.setProducer('RT Story Tracker');
  document.setCreator('RT Story Tracker');
  return Buffer.from(await document.save());
}

module.exports = { recordsPdf };
