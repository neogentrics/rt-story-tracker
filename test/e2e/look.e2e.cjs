'use strict';
// The Look: Solid, Metallic or Glass. It can be chosen in Preferences and in the View menu, it's remembered, it's left off wherever it
// should be, and the real text on it can be read in every theme.
//
// Why this measures for itself: an accessibility checker can't judge text over a gradient or over something frosted. So this hides the
// letters and icons, takes a picture of the window, and for each piece of text looks at the pixels behind where it sits and tests the
// text's real colour against the worst of them (4.5 to 1 for text, 3 to 1 for icons and large text). The way of measuring is RT Markdown
// Reader's (its test/e2e/metallic.e2e.cjs).
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { THEMES } = require('../../src/shared/themes');

const root = path.join(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-look-'));

const launch = async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, RTST_USER_DATA: profile, NMR_LINK_DIR: path.join(profile, 'shared') },
  });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(String(error)));
  await window.waitForSelector('body[data-state="ready"]');
  await window.evaluate(() => {
    // Colours at rest, not the middle of a fade.
    const still = new CSSStyleSheet();
    still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
    document.adoptedStyleSheets = [still];
  });
  return { app, window, errors };
};

const menu = (app, command) => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', name), command);
const frames = (window) => window.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
// The size the page is laid out at, which doesn't depend on how big the test computer's screen is.
const resize = async (window, width, height) => {
  await window.setViewportSize({ width, height });
  await window.waitForFunction((wanted) => window.innerWidth === wanted, width);
  await frames(window);
};
// The View menu's Look items, as they stand.
const viewLook = (app) => app.evaluate(({ Menu }) => {
  const view = Menu.getApplicationMenu().items.find((item) => item.label === 'View');
  return view.submenu.items.find((item) => item.label === 'Look').submenu.items.map((item) => [item.label, item.type, item.checked, item.enabled]);
});
const surface = (window) => window.evaluate(() => document.documentElement.dataset.surface);

/** Measures every control matching `groups` ({ name: selector }) that's in sight. Says which fall short, and how many it looked at. */
async function measure(window, groups) {
  const counts = await window.evaluate((wanted) => {
    document.querySelectorAll('[data-m]').forEach((node) => node.removeAttribute('data-m'));
    const found = {};
    let number = 0;
    for (const [name, selector] of Object.entries(wanted)) {
      found[name] = 0;
      for (const node of document.querySelectorAll(selector)) {
        const box = node.getBoundingClientRect();
        // What's greyed out because it can't be used isn't held to the contrast rules.
        if (node.disabled || node.closest('[aria-disabled="true"], :disabled, [hidden]')) continue;
        if (box.width < 6 || box.height < 6 || box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) continue;
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        // Something scrolled past the edge of its box isn't painted, and a measurement would land on whatever is behind it.
        let clipped = false;
        for (let up = node.parentElement; up && up !== document.documentElement; up = up.parentElement) {
          if (getComputedStyle(up).overflowY === 'visible') continue;
          const room = up.getBoundingClientRect();
          const top = room.top + up.clientTop;
          const left = room.left + up.clientLeft;
          if (box.top < top - 0.5 || box.bottom > top + up.clientHeight + 0.5 || box.left < left - 0.5 || box.right > left + up.clientWidth + 0.5) clipped = true;
        }
        // Nor is something with a window or a menu over it.
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (clipped || !hit || !(node === hit || node.contains(hit) || hit.contains(node))) continue;
        node.setAttribute('data-m', `${name}|${number}`);
        number += 1;
        found[name] += 1;
      }
    }
    // Only the letters and icons are hidden. Changing the text colour itself would also change the tints that are made from it.
    const hide = new CSSStyleSheet();
    hide.replaceSync('*, *::before, *::after { -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important; } select { color: transparent !important; } svg, svg * { stroke: transparent !important; fill: transparent !important; } ::placeholder { color: transparent !important; } .apps-dot { visibility: hidden !important; }');
    window.hideSheet = hide;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hide];
    return found;
  }, groups);
  await frames(window);
  const shot = (await window.screenshot()).toString('base64');
  const failures = await window.evaluate(async (picture) => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== window.hideSheet);
    const bytes = Uint8Array.from(atob(picture), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const pixels = canvas.getContext('2d', { willReadFrequently: true });
    pixels.drawImage(bitmap, 0, 0);
    const scale = bitmap.width / window.innerWidth;
    const one = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    const rgba = (css) => {
      one.clearRect(0, 0, 1, 1);
      one.fillStyle = css;
      one.fillRect(0, 0, 1, 1);
      const data = one.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2], data[3] / 255];
    };
    const light = (rgb) => {
      const [r, g, b] = rgb.map((value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
    const short = [];
    for (const node of document.querySelectorAll('[data-m]')) {
      const [name] = node.getAttribute('data-m').split('|');
      const style = getComputedStyle(node);
      const field = node.matches('select, input, textarea');
      const words = field || node.textContent.trim().length > 0;
      // The colour that's really painted: an icon by its stroke and words by their colour, through every level of fading above.
      const pictureOnly = !words && node.querySelector('svg');
      const typed = field && !node.matches('select') && !node.value;
      const colour = rgba(pictureOnly ? getComputedStyle(pictureOnly).stroke : typed ? getComputedStyle(node, '::placeholder').color : style.color);
      let alpha = colour[3];
      for (let up = node; up; up = up.parentElement) alpha *= Number(getComputedStyle(up).opacity);
      const size = parseFloat(style.fontSize);
      const need = pictureOnly || size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      const boxes = [];
      if (pictureOnly) boxes.push(pictureOnly.getBoundingClientRect());
      else if (field) {
        // A box's words sit on one line inside it: in its middle, or at the top of a tall one. Its rim holds no words.
        const outer = node.getBoundingClientRect();
        const line = Math.min(size * 1.25, outer.height - 6);
        const top = node.matches('textarea') ? outer.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) : outer.top + (outer.height - line) / 2;
        boxes.push(new DOMRect(outer.left + 6, top, Math.max(1, outer.width - 12), line));
      }
      else {
        const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let text = walk.nextNode(); text; text = walk.nextNode()) {
          if (!text.textContent.trim() || text.parentElement.closest('select, option, [hidden]')) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          const clip = text.parentElement.getBoundingClientRect();
          // Words cut short with an ellipsis only show as far as their box.
          for (const rect of range.getClientRects()) boxes.push(new DOMRect(rect.left, rect.top, Math.max(0, Math.min(rect.right, clip.right) - rect.left), rect.height));
        }
        if (!boxes.length) boxes.push(node.getBoundingClientRect());
      }
      let worst = Infinity;
      let behind = null;
      for (const box of boxes) {
        if (box.width < 1) continue;
        const x = Math.max(0, Math.round(box.left * scale));
        const y = Math.max(0, Math.round(box.top * scale));
        const w = Math.max(1, Math.round(box.width * scale));
        const h = Math.max(1, Math.round(box.height * scale));
        const data = pixels.getImageData(x, y, w, h).data;
        for (let at = 0; at < data.length; at += 4 * Math.max(1, Math.floor(data.length / 4 / 600))) {
          const ground = [data[at], data[at + 1], data[at + 2]];
          const shown = [0, 1, 2].map((k) => alpha * colour[k] + (1 - alpha) * ground[k]);
          const found = ratio(shown, ground);
          if (found < worst) {
            worst = found;
            behind = ground;
          }
        }
      }
      if (worst < need) short.push({ name, who: `${node.id ? `#${node.id}` : String(node.className).split(' ')[0] || node.tagName.toLowerCase()} “${(node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 20)}”`, worst: Number(worst.toFixed(2)), need, colour: style.color, behind: behind.join(',') });
    }
    return short;
  }, shot);
  return { failures, counts };
}

// Each place the finish shows, with the text on it. `needs` are the groups that have to be found there, or the test is looking at nothing.
const LIBRARY = { 'library bar': '.library-bar-name', 'library bar button': '.library-bar .bar-primary', 'library heading': '.home-card .brand', 'library text': '.home-card .lead, .project-title, .project-note', 'library links': '.home-links button', 'library field': '#new-title', 'library main button': '#start-project' };
const ROOM = {
  'title': '.room-header .bar-title h1, .room-subtitle',
  'counts': '.bar-words > span',
  'bar buttons': '.room-header .bar-right > .bar-button, .bar-side > button',
  'view switch': '.room-header .mode-tab',
  'list headings': '.column-head h2',
  'fold tools': '.fold-tool',
  'rows': '.row-title',
  'row counts': '.row-words',
  'list buttons': '.column-actions button',
  'filter': '#chapter-filter',
  'formatting': '.toolbar .tool',
  'footer': '.page-footer > *',
};
const FIND = { 'find fields': '.find-bar input:not([type="checkbox"]), .find-bar select', 'find buttons': '.find-bar button', 'find words': '.find-bar label, .find-count', 'comment heading': '.comments h2', 'comment parts': '.comment-quote, .comment-text, .comment-remove' };
const MENU = { 'menu items': '.popup-menu [role="menuitem"] span:first-child' };
const PREFS = { 'preferences title': '#prefs-title', 'preferences sections': '.prefs-nav button', 'preferences labels': '.prefs-pane:not([hidden]) .field > span', 'preferences notes': '.prefs-pane:not([hidden]) .quiet-note', 'preferences boxes': '.prefs-pane:not([hidden]) select', 'preferences foot': '.prefs-foot button' };
const MORE = { 'more items': '.more-menu [role="menuitem"] .bar-label' };

(async () => {
  let { app, window, errors } = await launch();
  await resize(window, 1200, 800);

  const set = async (changes) => {
    await window.evaluate((wanted) => window.storyTracker.saveSettings(wanted), changes);
    await menu(app, 'settings-changed');
    await window.waitForFunction(async () => {
      const saved = await window.storyTracker.settings();
      return saved.theme === 'system' || document.documentElement.dataset.theme === saved.theme;
    });
    await frames(window);
  };

  const bad = [];
  const seen = {};
  const check = async (where, groups, optional = []) => {
    const { failures, counts } = await measure(window, groups);
    for (const [name, count] of Object.entries(counts)) if (!optional.includes(name)) assert.ok(count > 0, `nothing to measure for “${name}” (${groups[name]}) ${where}`);
    for (const name of Object.keys(counts)) seen[name] = (seen[name] ?? 0) + counts[name];
    bad.push(...failures.map((one) => ({ where, ...one })));
    return failures;
  };

  // Which looks each theme is measured with: all three, except Aero, which is only ever Glass, and High Contrast, only ever Solid.
  const combos = Object.entries(THEMES).flatMap(([id, theme]) => (theme.flat ? [[id, 'solid']] : theme.glass ? [[id, 'glass']] : [[id, 'solid'], [id, 'metallic'], [id, 'glass']]));
  const only = process.env.RTST_LOOKS?.split(',');
  if (only) combos.splice(0, combos.length, ...combos.filter(([id, look]) => only.includes(`${id}:${look}`) || only.includes(look) || only.includes(id)));

  // The library, before there's a project.
  for (const [theme, look] of combos) {
    await set({ theme, surface: look });
    assert.equal(await surface(window), look);
    await check(`in the library, ${theme} ${look}`, LIBRARY, ['library text']);
  }
  await set({ theme: 'system', surface: 'solid' });

  // A book with a series, a part, comments and something to find.
  await window.fill('#new-title', 'The Lighthouse Keeper');
  await window.click('#start-project');
  await window.waitForSelector('.ProseMirror');
  await window.click('.ProseMirror');
  await window.keyboard.type('The keeper climbed the stairs every night.');
  await window.click('#add-series');
  await window.fill('.rename', 'A Series');
  await window.keyboard.press('Enter');
  await window.click('#add-part');
  await window.fill('.rename', 'Part One');
  await window.keyboard.press('Enter');
  await window.click('.ProseMirror');
  await window.keyboard.press('ControlOrMeta+a');
  await window.click('.tool.add-comment');
  await window.fill('.comment-box', 'Look at this again.');
  await window.click('.comment-save');
  await window.waitForSelector('.comment-card');
  await window.waitForSelector('.save-state[data-state="saved"]', { timeout: 15000 });

  // The choice: Preferences has it under Theme, and the View menu has it too. Each follows the other.
  await menu(app, 'preferences');
  await window.waitForSelector('#preferences[open]');
  await window.click('#prefs-tab-appearance');
  assert.deepEqual(await window.$$eval('#prefs-pane-appearance select, #prefs-pane-appearance input', (nodes) => nodes.slice(0, 2).map((node) => node.id)), ['pref-theme', 'pref-surface']);
  assert.deepEqual(await window.$$eval('#pref-surface option', (options) => options.map((option) => [option.value, option.textContent])), [['solid', 'Solid'], ['metallic', 'Metallic'], ['glass', 'Glass']]);
  assert.deepEqual(await window.$$eval('#pref-theme option', (options) => options.slice(1, 3).map((option) => option.textContent)), ['Paper', 'Night']);
  await window.selectOption('#pref-surface', 'metallic');
  await window.waitForFunction(() => document.documentElement.dataset.surface === 'metallic');
  assert.equal(await window.evaluate(() => window.storyTracker.settings().then((saved) => saved.surface)), 'metallic');
  assert.deepEqual(await viewLook(app), [['Solid', 'radio', false, true], ['Metallic', 'radio', true, true], ['Glass', 'radio', false, true]]);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('look-glass').click());
  await window.waitForFunction(() => document.documentElement.dataset.surface === 'glass' && document.querySelector('#pref-surface').value === 'glass');
  // Aero and High Contrast are drawn one way only. The box says so, and the choice comes back with another theme.
  for (const [theme, shown] of [['aero', 'glass'], ['contrast', 'solid']]) {
    await window.selectOption('#pref-surface', 'metallic').catch(() => null);
    await window.selectOption('#pref-theme', theme);
    await window.waitForFunction((wanted) => document.documentElement.dataset.surface === wanted, shown);
    assert.deepEqual([await window.inputValue('#pref-surface'), await window.isDisabled('#pref-surface')], [shown, true]);
    assert.match(await window.textContent('#pref-look-note'), /is always/);
    assert.deepEqual((await viewLook(app)).map((item) => [item[2], item[3]]), ['solid', 'metallic', 'glass'].map((id) => [id === shown, id === shown]), `${theme} in the View menu`);
    await window.selectOption('#pref-theme', 'light');
    await window.waitForFunction(() => document.documentElement.dataset.surface === 'metallic');
    assert.equal(await window.isDisabled('#pref-surface'), false);
  }
  await window.click('#pref-close');
  await window.waitForSelector('#preferences', { state: 'detached' });

  // It's remembered.
  await app.close();
  ({ app, window, errors } = await launch());
  await resize(window, 1200, 800);
  await window.waitForSelector('.ProseMirror');
  assert.equal(await surface(window), 'metallic');
  assert.equal((await viewLook(app))[1][2], true);

  // Where a look is left off, everything is drawn just as Solid draws it.
  const PARTS = ['body', '.room-header', '.column', '.toolbar', '.page-footer', '.sheet', '#add-chapter', '#add-book', '#chapter-filter', '.room-header .bar-button', '.mode-tabs', '.comments'];
  const drawn = () => window.evaluate((parts) => parts.map((selector) => {
    const style = getComputedStyle(document.querySelector(selector));
    return `${selector}: ${style.backgroundImage} | ${style.backgroundColor} | ${style.boxShadow} | ${style.backdropFilter}`;
  }), PARTS);
  const cdp = await window.context().newCDPSession(window);
  const media = (features, kind = '') => cdp.send('Emulation.setEmulatedMedia', { media: kind, features: Object.entries(features).map(([name, value]) => ({ name, value })) });
  const NORMAL = { 'prefers-contrast': 'no-preference', 'prefers-reduced-transparency': 'no-preference', 'forced-colors': 'none' };
  await media(NORMAL);
  await set({ theme: 'light', surface: 'solid' });
  const plain = await drawn();
  for (const look of ['metallic', 'glass']) {
    await set({ theme: 'light', surface: look });
    assert.notDeepEqual(await drawn(), plain, `${look} is on to start with`);
  }
  const OFF = [
    ['forced colours', { ...NORMAL, 'forced-colors': 'active' }, '', ['metallic', 'glass']],
    ['a request for more contrast', { ...NORMAL, 'prefers-contrast': 'more' }, '', ['metallic', 'glass']],
    ['printing', NORMAL, 'print', ['metallic', 'glass']],
    ['a request for less transparency', { ...NORMAL, 'prefers-reduced-transparency': 'reduce' }, '', ['glass']],
  ];
  for (const [what, features, kind, looks] of OFF) {
    for (const look of looks) {
      await media(features, kind);
      await set({ theme: 'light', surface: 'solid' });
      const without = await drawn();
      await set({ theme: 'light', surface: look });
      assert.deepEqual(await drawn(), without, `${look} is off for ${what}`);
    }
  }
  await media(NORMAL);
  await set({ theme: 'contrast', surface: 'solid' });
  const flat = await drawn();
  for (const look of ['metallic', 'glass']) {
    await set({ theme: 'contrast', surface: look });
    assert.deepEqual(await drawn(), flat, `${look} is off for High Contrast`);
  }
  // The page being written stays flat under Metallic.
  await set({ theme: 'light', surface: 'metallic' });
  const flatOnPage = () => window.$$eval('.sheet, .sheet *', (nodes) => nodes.map((node) => `${node.className || node.tagName}: ${getComputedStyle(node).backgroundImage} | ${getComputedStyle(node).boxShadow} | ${getComputedStyle(node).borderTopColor}`));
  const metal = await flatOnPage();
  await set({ theme: 'light', surface: 'solid' });
  assert.deepEqual(metal, await flatOnPage(), 'the page, its title and its words are drawn as in Solid');

  // The measuring has to catch what it's for: a highlight far too bright for a dark theme, and frosting that lets too much through.
  await set({ theme: 'dark', surface: 'metallic' });
  await window.evaluate(() => {
    const worse = new CSSStyleSheet();
    worse.replaceSync(':root:root:root:root[data-surface="metallic"] * { --m-top: #fff; --m-top-2: #fff; --m-low: #fff; --m-band: #fff; }');
    window.worse = worse;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, worse];
  });
  assert.ok((await measure(window, { rows: '.row-title', title: '.bar-title h1' })).failures.length > 0, 'white layers over a dark theme must show as unreadable');
  await window.evaluate(() => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== window.worse); });
  await set({ theme: 'dark', surface: 'glass' });
  await window.evaluate(() => {
    const worse = new CSSStyleSheet();
    worse.replaceSync('html[data-surface="glass"] .column.column { background: #fff !important; }');
    window.worse = worse;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, worse];
  });
  assert.ok((await measure(window, { rows: '.row-title' })).failures.length > 0, 'light panels under light text must show as unreadable');
  await window.evaluate(() => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== window.worse); });

  // Every theme, with each look it can have.
  for (const [theme, look] of combos) {
    const at = `${theme} ${look}`;
    await set({ theme, surface: look });
    await window.mouse.move(600, 600);
    await check(`in the writing room, ${at}`, ROOM, ['row counts']);
    if (process.env.RTST_SHOTS) await window.screenshot({ path: path.join(process.env.RTST_SHOTS, `look-${theme}-${look}.png`) });

    await menu(app, 'find');
    await window.waitForSelector('.find-bar:not([hidden])');
    await window.fill('.find-query', 'keeper');
    await check(`with find and the comments, ${at}`, FIND, ['find words']);
    await window.keyboard.press('Escape');
    await window.waitForFunction(() => document.activeElement?.closest('.ProseMirror'));

    await window.locator('#chapter-list .row-main').first().click({ button: 'right' });
    await window.waitForSelector('.popup-menu');
    await window.mouse.move(900, 700);
    await check(`with a menu open, ${at}`, MENU);
    await window.keyboard.press('Escape');

    await menu(app, 'preferences');
    await window.waitForSelector('#preferences[open]');
    await window.click('#prefs-tab-appearance');
    await window.mouse.move(5, 5);
    await check(`in Preferences, ${at}`, PREFS, ['preferences boxes', 'preferences notes']);
    if (process.env.RTST_SHOTS) await window.screenshot({ path: path.join(process.env.RTST_SHOTS, `prefs-${theme}-${look}.png`) });
    await window.keyboard.press('Escape');
    await window.waitForSelector('#preferences', { state: 'detached' });
  }

  // The More menu, which a narrow window has.
  await resize(window, 700, 600);
  for (const [theme, look] of combos) {
    await set({ theme, surface: look });
    await window.click('.more-button');
    await window.mouse.move(5, 590);
    await check(`in More, ${theme} ${look}`, MORE);
    await window.keyboard.press('Escape');
  }

  if (!only) for (const [name, count] of Object.entries(seen)) assert.ok(count > 0, `“${name}” was never measured`);
  const report = bad.map((one) => `${one.where}: ${one.name} ${one.who} ${one.worst} of ${one.need} (text ${one.colour} on ${one.behind})`);
  assert.deepEqual(report, [], `text that can't be read well:\n  ${report.join('\n  ')}`);
  assert.deepEqual(errors, []);
  await app.close();
  console.log(`look e2e passed (${combos.length} theme and look pairs)`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
