'use strict';
// How the end-to-end tests judge whether words can be read. An accessibility checker can't judge text over a gradient or over
// something frosted. So this hides the letters and icons, takes a picture of the window, and for each piece of text looks at the pixels
// behind where it sits and tests the text's real colour against the worst of them (4.5 to 1 for text, 3 to 1 for icons and large
// text). The way of measuring is RT Markdown Reader's (its test/e2e/metallic.e2e.cjs).
const frames = (window) => window.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// What's measured is kept in a list rather than marked on the page. An editor draws its text again when something in it is marked, which
// would take the mark away and leave nothing to measure.

/**
 * Measures every control matching `groups` ({ name: selector }) that's in sight. Says which fall short, and how many it looked at.
 * `inset` leaves that many pixels off each edge of a line of words, for words with a background of their own: it ends on a part of a
 * pixel, and the pixel outside it holds no letters.
 */
async function measure(window, groups, { inset = 0 } = {}) {
  const counts = await window.evaluate((wanted) => {
    window.measured = [];
    const found = {};
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
        window.measured.push({ name, node });
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
  const failures = await window.evaluate(async ([picture, edge]) => {
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
    for (const { name, node } of window.measured) {
      // A node that left the page between the two steps would be measured as nothing, and pass.
      if (!node.isConnected) {
        short.push({ name, who: 'a node that was redrawn before it could be measured' });
        continue;
      }
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
          for (const rect of range.getClientRects()) boxes.push(new DOMRect(rect.left + edge, rect.top + edge, Math.max(0, Math.min(rect.right, clip.right) - rect.left - 2 * edge), rect.height - 2 * edge));
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
  }, [shot, inset]);
  return { failures, counts };
}

module.exports = { frames, measure };
