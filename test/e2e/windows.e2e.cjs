'use strict';
// The app at small window sizes and on small screens, including a 1280 by 720 screen with Windows display scaling. At each size nothing
// in the top bar overlaps or is squeezed, every command is on the bar or in More and works from the keyboard, a long heading wraps, and
// in every view and window each control can be reached: on screen, or brought there by scrolling that a person can do. The window never
// opens larger than the screen.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-windows-'));
const HEADING = "Nehemiah's Lost and Found Friend - Manuscript.docx";
// [window in the screen's own units, display scaling]. The last two are a 1280 by 720 screen at 125 and at 150 percent.
const SIZES = [['640x480', 1], ['800x600', 1], ['1000x700', 1], ['1280x720', 1], ['1024x600', 1], ['1024x576', 1.25], ['853x480', 1.5]];
const COMMANDS = ['lookup-button', 'find-button', 'import-button', 'export-button', 'attachments-button', 'history-button', 'goals-button', 'focus-button', 'trash-button', 'security-button', 'apps-button', 'prefs-button'];
const WRITING_ONLY = ['lookup-button', 'find-button', 'history-button', 'goals-button', 'focus-button'];

const launch = async (env, scale = 1) => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(scale !== 1 ? [`--force-device-scale-factor=${scale}`] : [])],
    env: { ...process.env, NMR_LINK_DIR: path.join(work, 'shared'), ...env },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  window.on('dialog', (dialog) => dialog.accept());
  await window.waitForSelector('body[data-state="ready"]');
  return { app, window, errors };
};

const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
const settle = (window) => window.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// Run in the page: every control under `within` that a person can't get to. A control counts as reachable only if, after scrolling it
// into view, it's on screen, no box that can't be scrolled has had to move to show it, and nothing covers its middle.
function unreachable(within) {
  const top = within ? document.querySelector(within) : document.body;
  if (!top) return [`nothing matches ${within}`];
  const name = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).join('.')}` : ''} "${(node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 30)}"`;
  const found = [];
  const scrollers = [document.scrollingElement, ...document.querySelectorAll('*')].filter((node) => node.scrollTop || node.scrollLeft);
  const before = new Map(scrollers.map((node) => [node, [node.scrollLeft, node.scrollTop]]));
  const controls = [...top.querySelectorAll('button, input:not([type="hidden"]):not([type="file"]), select, textarea, a[href], summary, [contenteditable="true"]')].filter((node) => {
    if (node.closest('[hidden], [inert], .more-menu[hidden]')) return false;
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    // A button that only shows while its row is pointed at or focused takes no room until then.
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && box.width > 0 && box.height > 0;
  });
  for (const node of controls) {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = node.getBoundingClientRect();
    if (box.left < -1 || box.right > window.innerWidth + 1 || box.top < -1 || box.bottom > window.innerHeight + 1) {
      // Something taller than the window, such as the page being written, only has to start on screen.
      if (!(box.height > window.innerHeight * 0.5 && box.left >= -1 && box.right <= window.innerWidth + 1)) found.push(`off screen: ${name(node)}`);
    }
    for (let up = node.parentElement; up; up = up.parentElement) {
      const style = getComputedStyle(up);
      const clipsX = ['hidden', 'clip'].includes(style.overflowX);
      const clipsY = ['hidden', 'clip'].includes(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const room = up.getBoundingClientRect();
      if ((clipsX && (box.left < room.left - 1.5 || box.right > room.right + 1.5)) || (clipsY && (box.top < room.top - 1.5 || box.bottom > room.bottom + 1.5) && box.height <= room.height)) {
        found.push(`cut off by ${name(up)}: ${name(node)}`);
        break;
      }
    }
    // A link that wraps has two boxes, and the middle of the space around both can be other words, so the first one is tried.
    const first = node.getClientRects()[0] ?? box;
    const x = Math.min(Math.max(first.left + first.width / 2, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(first.top + Math.min(first.height / 2, 12), 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    if (hit && !(node === hit || node.contains(hit) || hit.contains(node) || hit.closest('label')?.control === node)) found.push(`covered by ${name(hit)}: ${name(node)}`);
  }
  // The page itself never scrolls sideways.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) found.push('the whole page scrolls sideways');
  for (const node of [document.scrollingElement, ...document.querySelectorAll('*')]) {
    const was = before.get(node) ?? [0, 0];
    if (node.scrollLeft !== was[0]) node.scrollLeft = was[0];
    if (node.scrollTop !== was[1]) node.scrollTop = was[1];
  }
  return [...new Set(found)];
}

// Run in the page: anything that has to be scrolled sideways. Only a records table may, since it has as many columns as it has.
function sideways(within) {
  const top = within ? document.querySelector(within) : document.body;
  return [top, ...top.querySelectorAll('*')]
    .filter((node) => !node.matches('input, textarea, .record-table-wrap, [hidden] *') && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)
    .map((node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${typeof node.className === 'string' ? node.className.trim().split(/\s+/).join('.') : ''}: ${node.scrollWidth} wide in ${node.clientWidth}`);
}

// Run in the page: "null" or "undefined" on show, which is what's written when a part of a screen that isn't there is added as if it were.
function strayWords() {
  const found = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (/^\s*(?:(?:null|undefined|\[object [A-Za-z]+\])\s*)+$/.test(node.textContent) && !node.parentElement.closest('[hidden], .ProseMirror, textarea, script')) found.push(`“${node.textContent}” in ${node.parentElement.id || node.parentElement.className || node.parentElement.tagName}`);
  }
  return found;
}

// Run in the page: what's wrong with the top bar.
function barProblems() {
  const found = [];
  const header = document.querySelector('.room-header');
  const name = (node) => node.id || node.getAttribute('aria-label') || node.className;
  const parts = [...header.querySelectorAll('.bar-side > button, .mode-tabs, .bar-title, .bar-words > span, .bar-right > button, .more-wrap > button')]
    .filter((node) => node.getBoundingClientRect().width > 0 && !node.closest('[hidden]'));
  for (let i = 0; i < parts.length; i += 1) {
    const a = parts[i].getBoundingClientRect();
    if (a.left < -1 || a.right > window.innerWidth + 1) found.push(`outside the window: ${name(parts[i])}`);
    if (parts[i].classList.contains('bar-button') && (a.width < 33 || a.height < 33)) found.push(`squeezed to ${Math.round(a.width)}px: ${name(parts[i])}`);
    if (parts[i].matches('.bar-words > span') && parts[i].scrollWidth > parts[i].clientWidth + 1) found.push(`count cut off: ${name(parts[i])}`);
    for (let j = i + 1; j < parts.length; j += 1) {
      const b = parts[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) found.push(`overlap: ${name(parts[i])} and ${name(parts[j])}`);
    }
  }
  // The title is shortened with an ellipsis, not just cut.
  for (const line of header.querySelectorAll('.bar-title h1, .room-subtitle')) {
    const box = line.getBoundingClientRect();
    const title = header.querySelector('.bar-title').getBoundingClientRect();
    if (box.right > title.right + 1 || box.left < title.left - 1) found.push('the title spills out of its room');
    if (line.scrollWidth > line.clientWidth + 1 && getComputedStyle(line).textOverflow !== 'ellipsis') found.push('the title is cut with no ellipsis');
  }
  if (title().width < 100) found.push(`the title has only ${Math.round(title().width)}px`);
  function title() { return header.querySelector('.bar-title').getBoundingClientRect(); }
  return found;
}

// Which commands are on the bar, and which are in More.
function whereCommands(commands) {
  return Object.fromEntries(commands.map((name) => {
    const button = document.querySelector(`.room-header .${name}`);
    if (!button || getComputedStyle(button).display === 'none') return [name, 'not here'];
    return [name, button.closest('.more-menu') ? 'more' : 'bar'];
  }));
}

// A made-up folder for Find my files, with a question to ask and files of several sections, a document to import and some records.
function sources() {
  const put = (rel, text) => {
    const full = path.join(work, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  };
  for (const name of ['Chapter 1.txt', 'Chapter 2.txt', 'A very long name for a loose page that nobody could place anywhere sensible.txt']) put(`stories/Book_1_The_Long_Road_Home/${name}`, `Words in ${name}.`);
  put('stories/Book_1_The_Long_Road_Home/Art/map of the whole country and all its roads.png', 'picture');
  put('stories/Book_1_The_Long_Road_Home/Audio/a reading.mp3', 'sound');
  return {
    folder: path.join(work, 'stories'),
    document: put('one/An imported document with quite a long name.md', '# One\n\nSome words.\n\n# Two\n\nMore words.\n'),
    records: put('two/people.csv', 'Name,Role,Home\nMarit,Main,The mill\nOlen,Other,The ford\n'),
  };
}

(async () => {
  const made = sources();
  for (const [size, scale] of SIZES) {
    const at = `${size}${scale === 1 ? '' : ` at ${scale * 100}%`}`;
    const { app, window, errors } = await launch({ RTST_USER_DATA: path.join(work, `p-${size}-${scale}`), RTST_WINDOW_SIZE: size }, scale);
    const [width, height] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    const [askedWidth, askedHeight] = size.split('x').map(Number);
    // A test machine's screen can be smaller than the size asked for, and then its system may hold the window to the screen. The app
    // must never be what stops it: the window is the size asked for, or the screen's.
    const screenRoom = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
    assert.ok(width <= askedWidth + 2 && height <= askedHeight + 3 && width >= Math.min(askedWidth, screenRoom.width) - 2 && height >= Math.min(askedHeight, screenRoom.height) - 40, `${at}: the window is ${width}x${height} on a ${screenRoom.width}x${screenRoom.height} screen`);
    const clean = async (what, within) => {
      await settle(window);
      assert.deepEqual(await window.evaluate(unreachable, within), [], `${what} at ${at}`);
      assert.deepEqual(await window.evaluate(sideways, within), [], `${what} at ${at} needs no sideways scrolling`);
      assert.deepEqual(await window.evaluate(strayWords), [], `${what} at ${at} shows no stray “null”`);
    };

    await clean('the empty library', null);
    await window.fill('#new-title', 'My Books');
    await window.click('#start-project');
    await window.waitForSelector('.ProseMirror');
    await window.fill('#chapter-title', HEADING);
    await window.focus('.ProseMirror');
    await window.keyboard.type('Words on the page, enough of them to see how the line wraps in a narrow window.');
    await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });
    await settle(window);

    // The checks have to catch what they're for: a button off the screen, one cut off by a box that can't be scrolled, one with
    // something on top of it, and two things in the top bar on top of each other.
    if (size === SIZES[0][0]) {
      await window.evaluate(() => {
        document.body.insertAdjacentHTML('beforeend', '<div id="probe"><button style="position:fixed;left:-300px;top:10px">off</button><div style="position:fixed;left:10px;top:100px;width:40px;height:30px;overflow:hidden"><button style="margin-left:60px">clipped</button></div><button style="position:fixed;left:200px;top:200px;width:80px;height:30px">under</button><span style="position:fixed;left:200px;top:200px;width:80px;height:30px;background:red"></span></div>');
        const title = document.querySelector('.bar-title');
        title.style.marginRight = '-90px';
      });
      const caught = (await window.evaluate(unreachable, null)).join('\n');
      for (const [kind, word] of [['off screen', 'off'], ['cut off by', 'clipped'], ['covered by', 'under']]) assert.ok(caught.split('\n').some((line) => line.startsWith(kind) && line.includes(`"${word}"`)), `the check sees a control that is ${kind}: ${caught}`);
      assert.ok((await window.evaluate(barProblems)).some((line) => line.startsWith('overlap')), 'and an overlap in the top bar');
      await window.evaluate(() => {
        document.querySelector('#probe').remove();
        document.querySelector('.bar-title').style.marginRight = '';
      });
    }

    // The top bar, the heading and the page.
    assert.deepEqual(await window.evaluate(barProblems), [], `the top bar at ${at}`);
    const heading = await window.$eval('#chapter-title', (node) => ({ across: node.scrollWidth - node.clientWidth, down: node.scrollHeight - node.clientHeight, lines: node.clientHeight / parseFloat(getComputedStyle(node).lineHeight), text: node.value }));
    assert.deepEqual([heading.across <= 1, heading.down <= 2, heading.text], [true, true, HEADING], `the heading is whole at ${at}: ${JSON.stringify(heading)}`);
    if (askedWidth <= 1000) assert.ok(heading.lines >= 1.6, `and it wraps at ${at}`);
    const sheet = await window.locator('.sheet').boundingBox();
    assert.ok(sheet.width >= 320, `the page is ${Math.round(sheet.width)}px wide at ${at}`);
    for (const list of ['#book-list', '#chapter-list']) {
      const box = await window.locator(list).boundingBox();
      assert.ok(box && box.width >= 120 && box.height >= 40, `${list} can be used at ${at}: ${JSON.stringify(box)}`);
    }
    await clean('writing', null);

    // Every command is on the bar or in More, and each one in More has a name.
    const where = await window.evaluate(whereCommands, COMMANDS);
    for (const [command, place] of Object.entries(where)) assert.ok(place === 'bar' || place === 'more', `${command} is ${place} at ${at}`);
    const inMore = COMMANDS.filter((command) => where[command] === 'more');
    assert.equal(await window.locator('.more-button').isVisible(), inMore.length > 0 || await window.locator('.bar-words').isHidden(), `More shows when it's needed at ${at}`);
    if (inMore.length) {
      await window.focus('.more-button');
      await window.keyboard.press('Enter');
      assert.equal(await window.getAttribute('.more-button', 'aria-expanded'), 'true');
      await clean('the More menu', '.more-menu');
      const items = await window.locator('.more-menu [role="menuitem"]:visible').evaluateAll((nodes) => nodes.map((node) => ({ label: node.getAttribute('aria-label'), text: node.textContent.trim() })));
      assert.equal(items.length, inMore.length);
      for (const item of items) assert.ok(item.label && item.text === item.label, `a named item: ${JSON.stringify(item)}`);
      // The arrow keys go round every item, and Escape closes it and gives the focus back.
      const visited = new Set();
      for (let step = 0; step < items.length; step += 1) {
        visited.add(await window.evaluate(() => document.activeElement.getAttribute('aria-label')));
        await window.keyboard.press('ArrowDown');
      }
      assert.equal(visited.size, items.length, `every item by keyboard at ${at}`);
      await window.keyboard.press('Escape');
      assert.equal(await window.locator('.more-menu').isHidden(), true);
      assert.equal(await window.evaluate(() => document.activeElement.classList.contains('more-button')), true);
    }

    // More stays open while the counts in the bar change under it, as they do each time the page saves, and the bar catches up after.
    if (inMore.length) {
      await window.focus('.ProseMirror');
      await window.keyboard.press('End');
      await window.keyboard.type(' and then a few more words');
      await window.focus('.more-button');
      await window.keyboard.press('Enter');
      const chosen = await window.evaluate(() => document.activeElement.getAttribute('aria-label'));
      await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });
      await new Promise((resolve) => { setTimeout(resolve, 600); });
      assert.equal(await window.locator('.more-menu').isHidden(), false, `More is still open after the page saved, at ${at}`);
      assert.equal(await window.evaluate(() => document.activeElement.getAttribute('aria-label')), chosen, 'with the keyboard where it was');
      await window.keyboard.press('Escape');
      await settle(window);
      assert.deepEqual(await window.evaluate(barProblems), [], `and the bar is right again once it closes, at ${at}`);
    }

    // A command works wherever it is, from the keyboard: Preferences.
    const press = async (command) => {
      if ((await window.evaluate(whereCommands, [command]))[command] === 'more') {
        await window.focus('.more-button');
        await window.keyboard.press('Enter');
      }
      await window.focus(`.room-header .${command}`);
      await window.keyboard.press('Enter');
    };
    await press('prefs-button');
    await window.waitForSelector('#preferences[open]');
    for (const section of ['general', 'appearance', 'editing', 'backups', 'lock', 'apps', 'shortcuts']) {
      await window.click(`#prefs-tab-${section}`);
      if (section === 'apps') await window.waitForSelector('#linked-apps .app-row');
      if (section === 'shortcuts') await window.waitForSelector('#shortcuts-page dd[data-shortcut]');
      await clean(`Preferences, ${section}`, '#preferences');
    }
    await window.keyboard.press('Escape');
    await window.waitForSelector('#preferences', { state: 'detached' });

    // The other windows.
    for (const [command, selector] of [['export-button', 'dialog[open]'], ['attachments-button', '#attachments[open]'], ['history-button', 'dialog[open]'], ['trash-button', 'dialog[open]'], ['security-button', 'dialog[open]'], ['apps-button', '#apps-dialog[open]']]) {
      await press(command);
      await window.waitForSelector(selector);
      await clean(command, 'dialog[open]');
      if (command === 'attachments-button') assert.ok((await window.locator('#attachment-list').boundingBox()).height >= 150, `the list of files has room at ${at}`);
      await window.keyboard.press('Escape');
      await window.waitForFunction(() => !document.querySelector('dialog[open]'));
    }
    for (const command of ['details', 'help-center', 'shortcuts', 'about']) {
      await menu(app, command);
      await window.waitForSelector('dialog[open]');
      if (command === 'shortcuts') await window.waitForSelector('#shortcuts-page dd[data-shortcut]');
      await clean(command, 'dialog[open]');
      await window.keyboard.press('Escape');
      await window.waitForFunction(() => !document.querySelector('dialog[open]'));
    }
    await press('find-button');
    await window.waitForSelector('.find-bar:not([hidden])');
    await clean('Find', null);
    await window.keyboard.press('Escape');
    // The page takes the focus back on the next frame. A command pressed before then can lose the focus, and its Enter, to the page.
    await window.waitForFunction(() => document.activeElement?.closest('.ProseMirror'));
    await press('lookup-button');
    await window.waitForSelector('#lookup-panel:not([hidden])');
    await clean('the look-up panel', null);
    const pageWidth = async () => Math.round((await window.locator('.sheet').boundingBox()).width);
    const beside = await pageWidth();
    assert.ok(beside >= 280, `the page can still be read beside the look-up panel at ${at}: it's ${beside}px wide`);
    // A Windows window's frame takes some of the width it's given. Where there's least to spare, that much is taken away here too.
    if (askedWidth <= 640) {
      await window.evaluate(() => { document.body.style.paddingRight = '16px'; });
      await settle(window);
      const framed = await pageWidth();
      assert.ok(framed >= 280, `and with a Windows window's frame taken off, at ${at}: it's ${framed}px wide`);
      await window.evaluate(() => { document.body.style.paddingRight = ''; });
      await settle(window);
    }
    await menu(app, 'lookup');

    // Records.
    await window.click('#mode-records');
    await window.waitForSelector('.records-empty, .record-browser');
    await settle(window);
    assert.deepEqual(await window.evaluate(barProblems), [], `the top bar in Records at ${at}`);
    const inRecords = await window.evaluate(whereCommands, COMMANDS);
    for (const command of COMMANDS) assert.equal(inRecords[command] === 'not here', WRITING_ONLY.includes(command), `${command} in Records at ${at}`);
    await clean('Records, empty', null);
    await window.click('#own-type');
    await window.waitForSelector('#type-dialog[open]');
    await clean('the kind-of-record form', 'dialog[open]');
    await window.fill('#type-name', 'Character');
    await window.click('#type-save');
    await window.waitForSelector('#type-dialog', { state: 'detached' });
    await clean('Records, with a kind', null);
    await window.click('#new-record');
    await window.waitForSelector('.record-page');
    await window.fill('.record-title', 'A very long name for a person who has far too many names to fit on any single line of a window');
    assert.ok(await window.$eval('.record-title', (node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 2), `a long record name wraps at ${at}`);
    await clean('a record', null);

    await window.click('#open-library');
    await window.waitForSelector('.project-row');
    await clean('the library with a project', null);

    // At the smallest sizes, also the screens that begin with choosing a file, and the password and lock screens.
    if (askedWidth <= 1024 && askedHeight <= 576) {
      const choose = (file) => app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }); }, file);
      await choose(made.folder);
      await window.click('#find-files');
      await window.waitForSelector('#plan-tree');
      await clean('the Find my files preview', 'dialog[open]');
      assert.ok((await window.locator('#plan-tree').boundingBox()).height >= 90, `the plan has room at ${at}`);
      await window.click('#plan-go');
      await window.waitForSelector('#report-total', { timeout: 60000 });
      await clean('the Find my files report', 'dialog[open]');
      await window.click('#report-close');
      await window.waitForSelector('.room');
      await choose(made.document);
      await press('import-button');
      await window.waitForSelector('dialog[open]');
      await clean('Import', 'dialog[open]');
      await window.keyboard.press('Escape');
      await window.waitForFunction(() => !document.querySelector('dialog[open]'));
      await window.click('#mode-records');
      await window.waitForSelector('.records-empty, .record-browser');
      await choose(made.records);
      await window.locator('#empty-bring-in, #import-records').first().click();
      await window.waitForSelector('#records-import[open]');
      await clean('bringing records in', '#records-import');
      await window.click('#import-choose-files');
      await window.waitForSelector('#import-summary');
      await clean('bringing records in, with a file chosen', '#records-import');
      await window.keyboard.press('Escape');
      await window.waitForSelector('#records-import', { state: 'detached' });
      await window.click('#mode-write');
      await window.waitForFunction(() => document.querySelector('.room').dataset.mode === 'write');
      await settle(window);

      // A password: both steps, the screen after, the lock screen and its other ways in.
      await press('security-button');
      await window.waitForSelector('#new-password');
      await clean('setting a password', 'dialog[open]');
      await window.fill('#new-password', 'seven silver spoons');
      await window.fill('#new-password-again', 'seven silver spoons');
      await window.click('#security-next');
      await window.waitForSelector('#recovery-key');
      await clean('the recovery key', 'dialog[open]');
      await window.check('#recovery-saved');
      await window.click('#recovery-continue');
      await window.waitForSelector('#security-done', { timeout: 60000 });
      await clean('the password is set', 'dialog[open]');
      await window.click('#security-done');
      await menu(app, 'lock');
      await window.waitForSelector('#lock-screen');
      await clean('the lock screen', null);
      await window.click('#lock-forgot');
      await clean('forgot your password', null);
      if (process.env.RTST_SHOTS) await window.screenshot({ path: path.join(process.env.RTST_SHOTS, `w-lock-${size}.png`) });
    }
    if (process.env.RTST_SHOTS) await window.screenshot({ path: path.join(process.env.RTST_SHOTS, `w-library-${size}.png`) });
    assert.deepEqual(errors, [], at);
    await app.close();
    console.log(`  ${at}: fine, ${inMore.length} commands in More`);
  }

  // The window never opens larger than the screen: here the test says how much room the screen has.
  for (const area of ['1024x560', '853x440', '800x560', '600x380']) {
    const { app } = await launch({ RTST_USER_DATA: path.join(work, `screen-${area}`), RTST_WORK_AREA: area, RTST_WINDOW_SIZE: '' });
    const [roomWide, roomHigh] = area.split('x').map(Number);
    const sizes = await app.evaluate(({ BrowserWindow }) => {
      const one = BrowserWindow.getAllWindows()[0];
      return { size: one.getSize(), smallest: one.getMinimumSize() };
    });
    assert.ok(sizes.size[0] <= roomWide && sizes.size[1] <= roomHigh, `on a ${area} screen the window opened ${sizes.size.join('x')}`);
    assert.ok(sizes.smallest[0] <= roomWide && sizes.smallest[1] <= roomHigh, `and its smallest, ${sizes.smallest.join('x')}, fits`);
    await app.close();
  }
  console.log(`windows e2e passed (${SIZES.length} sizes)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
