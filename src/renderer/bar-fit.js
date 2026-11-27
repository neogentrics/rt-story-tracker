// Makes a top bar fit its width. As it gets narrower, in this order: the title is shortened with an ellipsis, the word counts are
// shortened, the buttons used least move into a More menu, the counts go (the menu shows them), the rest of the buttons follow, and last
// the Library button keeps only its picture. A button is moved, not copied, so it does the same thing wherever it is.
import { el } from './dom.js';
import { icon } from './icons.js';

// The title gets at least this much before anything else gives way.
const TITLE_ROOM = 140;

// `tools` are the buttons in the order they're shown. `leaving` is their classes in the order they move out, least used first, and
// `core` is how many at the end of that order stay until the word counts have gone. `showWords` shows the counts "long", "short" or
// "none", and returns them in words for the menu.
export function createBarFit({ header, title, bar, tools, leaving, core, showWords }) {
  const menu = el('div', { class: 'more-menu', role: 'menu', 'aria-label': 'More', hidden: true });
  const counts = el('p', { class: 'more-words', role: 'presentation', hidden: true });
  const more = el('button', { type: 'button', class: 'bar-button more-button', title: 'More', 'aria-label': 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
  const wrap = el('div', { class: 'more-wrap', hidden: true }, more, menu);
  bar.append(wrap);
  menu.append(counts);

  const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter((node) => node.offsetParent !== null);

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  }

  function outside(event) {
    if (!wrap.contains(event.target)) close();
  }

  function open(at = 0) {
    for (const button of menu.querySelectorAll('[role="menuitem"]')) button.querySelector('.bar-label').textContent = button.getAttribute('aria-label');
    if (!counts.hidden) counts.textContent = showWords('none');
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    items().at(at)?.focus();
  }

  more.addEventListener('click', () => (menu.hidden ? open() : close()));
  more.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(event.key === 'ArrowDown' ? 0 : -1);
    }
  });
  menu.addEventListener('keydown', (event) => {
    const list = items();
    const at = list.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      more.focus();
    } else if (event.key === 'Tab') {
      close();
      more.focus();
    }
  });
  // The menu closes before the button does its job, with the focus on More, so a window the button opens gives the focus back there.
  menu.addEventListener('click', (event) => {
    if (!event.target.closest('[role="menuitem"]')) return;
    close();
    more.focus();
  }, true);

  function inBar(button) {
    button.removeAttribute('role');
    button.classList.remove('in-menu');
    button.querySelector('.bar-label')?.remove();
    bar.insertBefore(button, wrap);
  }

  const moved = new Set();
  function intoMenu(button) {
    moved.add(button);
    button.setAttribute('role', 'menuitem');
    button.classList.add('in-menu');
    button.append(el('span', { class: 'bar-label' }, button.getAttribute('aria-label')));
    // In the menu they keep the order they have in the bar.
    for (const one of tools) if (moved.has(one)) menu.append(one);
    wrap.hidden = false;
  }

  const tooNarrow = () => header.scrollWidth > header.clientWidth + 1 || title.clientWidth < TITLE_ROOM;
  const leaveOrder = leaving.map((name) => tools.find((button) => button.classList.contains(name))).filter(Boolean);

  function fit() {
    if (!header.isConnected || header.clientWidth === 0) return;
    const hadFocus = document.activeElement;
    close();
    moved.clear();
    tools.forEach(inBar);
    wrap.hidden = true;
    counts.hidden = true;
    header.classList.remove('compact');
    showWords('long');
    // Buttons that aren't used in this view take no room, and don't need a place in the menu.
    const queue = leaveOrder.filter((button) => getComputedStyle(button).display !== 'none');
    if (tooNarrow()) showWords('short');
    while (tooNarrow() && queue.length > core) intoMenu(queue.shift());
    if (tooNarrow()) {
      counts.textContent = showWords('none');
      counts.hidden = false;
      wrap.hidden = false;
    }
    while (tooNarrow() && queue.length) intoMenu(queue.shift());
    if (tooNarrow()) header.classList.add('compact');
    if (hadFocus instanceof HTMLElement && tools.includes(hadFocus)) (hadFocus.classList.contains('in-menu') ? more : hadFocus).focus();
  }

  let waiting = 0;
  const soon = () => {
    if (waiting) return;
    waiting = requestAnimationFrame(() => {
      waiting = 0;
      fit();
    });
  };
  let width = 0;
  const watch = new ResizeObserver(([entry]) => {
    if (Math.round(entry.contentRect.width) === width) return;
    width = Math.round(entry.contentRect.width);
    fit();
  });
  watch.observe(header);
  document.fonts?.ready.then(soon);

  return {
    fit: soon,
    close,
    destroy: () => {
      close();
      watch.disconnect();
      cancelAnimationFrame(waiting);
    },
  };
}
