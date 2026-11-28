// The app's own menu, for a right-click or the Menu key. It opens where it's asked, kept inside the window and scrolling if the window is
// short. The arrow keys, Home and End move through it, Escape closes it, and the focus goes back to what it was opened on. An item can
// lead to a second list, such as the books a chapter could move to, which takes the menu's place with a way back.
import { el } from './dom.js';

let open = null;

export function closeMenu({ restore = false } = {}) {
  if (!open) return;
  const { menu, returnTo, stop } = open;
  open = null;
  stop.abort();
  menu.remove();
  if (restore && returnTo?.isConnected) returnTo.focus();
}

// `items` are { label, run, disabled } or { label, items } for a second list, or 'separator'. An item that's one of a set of choices
// has `checked`, and may have a `swatch`, the colour it stands for. `label` names the menu itself. `at` is where its corner goes, and
// `returnTo` is what gets the focus back.
export function openMenu({ items, at, label, returnTo = document.activeElement }) {
  closeMenu();
  const menu = el('div', { class: 'popup-menu', role: 'menu', 'aria-label': label, tabindex: '-1' });
  const stop = new AbortController();
  open = { menu, returnTo, stop };
  const buttons = () => [...menu.querySelectorAll('[role^="menuitem"]:not([aria-disabled="true"])')];

  const place = () => {
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4))}px`;
  };

  const draw = (list, back = null) => {
    const rows = list.map((item) => {
      if (item === 'separator') return el('div', { role: 'separator', class: 'popup-line' });
      const choice = item.checked !== undefined;
      const swatch = item.swatch ? el('span', { class: 'popup-swatch', 'aria-hidden': 'true' }) : null;
      if (swatch) swatch.style.backgroundColor = item.swatch;
      const button = el('button', {
        type: 'button',
        role: choice ? 'menuitemradio' : 'menuitem',
        'aria-checked': choice ? String(item.checked) : null,
        tabindex: '-1',
        'aria-disabled': item.disabled ? 'true' : null,
        'aria-haspopup': item.items ? 'true' : null,
        onclick: () => {
          if (item.disabled) return;
          if (item.items) {
            draw(item.items, { list, from: item.label });
            return;
          }
          // Closed first, with the focus back where it was, so a window the action opens gives the focus back there.
          closeMenu({ restore: true });
          item.run();
        },
      }, el('span', { class: 'popup-words' }, swatch, item.label), item.items ? el('span', { 'aria-hidden': 'true' }, '▸') : null,
      item.checked ? el('span', { 'aria-hidden': 'true' }, '✓') : null);
      return button;
    });
    if (back) {
      rows.unshift(
        el('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: 'popup-back', onclick: () => draw(back.list) }, el('span', {}, '‹ Back')),
        el('div', { role: 'separator', class: 'popup-line' }),
      );
    }
    menu.replaceChildren(...rows);
    menu.back = back ? () => {
      draw(back.list);
      buttons().find((button) => button.textContent.startsWith(back.from))?.focus();
    } : null;
    place();
    buttons()[back ? 1 : 0]?.focus();
  };

  menu.addEventListener('keydown', (event) => {
    // The menu has the keyboard while it's open, so nothing underneath acts on the same press.
    event.stopPropagation();
    const list = buttons();
    const now = list.indexOf(document.activeElement);
    const to = { ArrowDown: now + 1, ArrowUp: now - 1, Home: 0, End: list.length - 1 }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restore: true });
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeMenu({ restore: true });
    } else if (event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup')) {
      event.preventDefault();
      document.activeElement.click();
    } else if (event.key === 'ArrowLeft' && menu.back) {
      event.preventDefault();
      menu.back();
    }
  });
  menu.addEventListener('contextmenu', (event) => event.preventDefault());

  const { signal } = stop;
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  }, { capture: true, signal });
  window.addEventListener('blur', () => closeMenu(), { signal });
  window.addEventListener('resize', () => closeMenu(), { signal });

  document.body.append(menu);
  draw(items);
}
