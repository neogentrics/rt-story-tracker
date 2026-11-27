'use strict';
// Accessibility, checked here and not by eye (docs/app-suite.md, "Look and feel in every app"): each main screen and dialog is opened,
// every control on it must have a name a screen reader can read, and the main flows must work from the keyboard alone.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-a11y-'));

// Run in the page: every control that's on show, and the ones with no name. A name is an aria-label, an aria-labelledby that leads to
// words, a label, a title, or words inside it (or a picture with an alt). A placeholder is not a name.
function audit() {
  const shown = (node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && !node.closest('[hidden], [inert]');
  };
  const words = (node) => (node ? (node.innerText ?? node.textContent ?? '').trim() : '');
  const named = (node) => {
    if ((node.getAttribute('aria-label') ?? '').trim()) return true;
    const by = node.getAttribute('aria-labelledby');
    if (by && by.split(/\s+/).some((id) => words(document.getElementById(id)))) return true;
    if (node.labels && [...node.labels].some((label) => words(label))) return true;
    if ((node.getAttribute('title') ?? '').trim()) return true;
    if (words(node)) return true;
    return [...node.querySelectorAll('img[alt]')].some((image) => image.alt.trim());
  };
  const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="checkbox"], [role="textbox"], [contenteditable="true"]';
  const describe = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className && typeof node.className === 'string' ? `.${node.className.trim().split(/\s+/).join('.')}` : ''}`;
  const all = [...document.querySelectorAll(selector)].filter(shown);
  return { count: all.length, unnamed: all.filter((node) => !named(node)).map(describe) };
}

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: path.join(work, 'profile'), NMR_LINK_DIR: path.join(work, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  window.on('dialog', (dialog) => dialog.accept());
  const menu = (command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
  let screens = 0;
  let controls = 0;
  const check = async (name) => {
    const { count, unnamed } = await window.evaluate(audit);
    screens += 1;
    controls += count;
    assert.ok(count > 0, `${name}: there is something to check`);
    assert.deepEqual(unnamed, [], `${name}: every control has a name`);
  };
  const focused = () => window.evaluate(() => {
    const node = document.activeElement;
    return node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${node.className ?? ''}` : '';
  });
  // Tab until the focus is on the thing, as a person would, and say where it went if it never gets there.
  const tabTo = async (selector, { max = 90 } = {}) => {
    const trail = [];
    for (let at = 0; at < max; at += 1) {
      if (await window.evaluate((wanted) => Boolean(document.activeElement?.matches(wanted)), selector)) return trail;
      trail.push(await focused());
      await window.keyboard.press('Tab');
    }
    assert.fail(`Tab never reached ${selector}. It went through: ${trail.slice(0, 25).join(', ')}`);
    return trail;
  };

  // The check itself has to catch what it's for: a button with no name, an input with only a placeholder, and a picture-only link.
  await window.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="probe"><button id="p1"></button><input id="p2" placeholder="only a placeholder"><a id="p3" href="#"><img alt="" src="icon.png"></a><button id="p4" aria-label="named"></button></div>');
  });
  const probe = await window.evaluate(audit);
  assert.deepEqual(probe.unnamed.filter((name) => /#p\d/.test(name)).map((name) => name.split('.')[0]), ['button#p1', 'input#p2', 'a#p3']);
  await window.evaluate(() => document.getElementById('probe').remove());

  // The library, with nothing in it: from the keyboard alone a person types a name and starts a project.
  await window.waitForSelector('#new-title');
  await check('the library');
  await window.focus('body');
  await tabTo('#new-title');
  await window.keyboard.type('Keyboard Test');
  await window.keyboard.press('Enter');
  await window.waitForSelector('.ProseMirror');
  await check('the writing room');

  // The toolbar is reached by Tab, and Enter or Space does what the click does.
  await window.evaluate(() => document.activeElement?.blur());
  await tabTo('.prefs-button');
  await window.keyboard.press('Enter');
  await window.waitForSelector('#preferences[open]');
  assert.ok(await window.evaluate(() => document.querySelector('#preferences').contains(document.activeElement)), 'focus moved into the dialog');
  // Every section, reached with the arrow keys alone.
  for (const section of ['General', 'Appearance', 'Editing', 'Backups', 'Password lock', 'Linked Apps', 'Shortcuts']) {
    await window.waitForFunction((wanted) => document.activeElement?.textContent === wanted, section);
    if (section === 'Linked Apps') await window.waitForSelector('#linked-apps .app-row');
    if (section === 'Shortcuts') await window.waitForSelector('#shortcuts-page dd[data-shortcut]');
    await check(`Preferences, ${section}`);
    if (section !== 'Shortcuts') await window.keyboard.press('ArrowDown');
  }
  await window.keyboard.press('Escape');
  await window.waitForSelector('#preferences', { state: 'detached' });
  assert.equal(await window.evaluate(() => document.activeElement?.classList.contains('prefs-button')), true, 'and comes back to where it was');

  await tabTo('.apps-button');
  await window.keyboard.press('Space');
  await window.waitForSelector('#apps-dialog[open]');
  await check('the Apps panel');
  await window.keyboard.press('Escape');
  await window.waitForSelector('#apps-dialog', { state: 'detached' });

  // Writing: a new chapter by keyboard, then the editor can be reached and typed in.
  await window.evaluate(() => document.activeElement?.blur());
  await tabTo('#add-chapter');
  await window.keyboard.press('Enter');
  await window.waitForFunction(() => document.querySelectorAll('#chapter-list .row').length >= 2);
  await window.focus('.ProseMirror');
  await window.keyboard.type('Typed from the keyboard.');
  await window.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('Typed from the keyboard.'));
  await check('a chapter being written');
  const rows = await window.locator('#chapter-list .row').count();
  assert.ok(rows >= 2);
  await window.evaluate(() => document.activeElement?.blur());
  await tabTo('#chapter-list .row-main, #chapter-list .row button');

  // The modes switch from the keyboard.
  await window.evaluate(() => document.activeElement?.blur());
  await tabTo('#mode-records');
  await window.keyboard.press('Space');
  await window.waitForSelector('.records-empty, .record-browser');
  await check('Records, empty');
  assert.equal(await window.getAttribute('#mode-records', 'aria-pressed'), 'true');

  // A kind of record and a record, with their forms.
  await window.click('#own-type');
  await window.waitForSelector('#type-dialog[open]');
  await check('the kind-of-record form');
  await window.fill('#type-name', 'Character');
  await window.click('#type-save');
  await window.waitForSelector('#type-dialog', { state: 'detached' });
  await window.click('#new-record');
  await window.waitForSelector('.record-page');
  await window.fill('.record-title', 'Someone');
  await check('a record');
  await window.click('#mode-write');

  // Every dialog the menus open, each named throughout, and each closed with Escape.
  for (const [command, selector, name] of [
    ['trash', '#trash-dialog, dialog[open]', 'the Trash'],
    ['export-book', 'dialog[open]', 'Export'],
    ['attachments', 'dialog[open]', 'Attachments'],
    ['details', 'dialog[open]', 'Book Details'],
    ['history', 'dialog[open]', 'Earlier versions'],
    ['security', 'dialog[open]', 'Password and Lock'],
    ['help-center', '#help-dialog[open]', 'the Help Center'],
    ['shortcuts', '#help-dialog[open]', 'Keyboard Shortcuts'],
    ['about', '#about-dialog[open]', 'About'],
  ]) {
    await menu(command);
    await window.waitForSelector(selector, { timeout: 15000 }).catch((error) => { throw new Error(`${name} (${command}) didn’t open: ${error.message}`); });
    if (command === 'shortcuts') await window.waitForSelector('#shortcuts-page dd[data-shortcut]');
    await check(name);
    await window.keyboard.press('Escape');
    await window.waitForFunction(() => !document.querySelector('dialog[open]'));
  }
  await menu('lookup');
  await window.waitForSelector('#lookup-panel:not([hidden])');
  await check('the look-up panel');
  await menu('lookup');
  await menu('find');
  await window.waitForSelector('.find-bar:not([hidden]), [role="search"]');
  await check('Find');
  await window.keyboard.press('Escape');

  // The library again, with a project in it.
  await window.click('#open-library');
  await window.waitForSelector('.project-row');
  await check('the library, with a project');
  await window.focus('body');
  await tabTo('.project-open');
  await window.keyboard.press('Enter');
  await window.waitForSelector('.ProseMirror');
  assert.deepEqual(errors, []);
  await app.close();
  console.log(`accessibility e2e passed (${screens} screens, ${controls} controls)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
