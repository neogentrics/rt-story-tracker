// A small helper for building screens. Text always goes in as text, so a title can never become markup.
// A title that wraps on screen is still one line: anything pasted with line breaks has them made into spaces.
export function oneLine(field) {
  if (!/[\r\n]/.test(field.value)) return;
  const at = field.selectionStart;
  field.value = field.value.replace(/\s*[\r\n]+\s*/g, ' ');
  field.setSelectionRange(at, at);
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'class') node.className = value;
    else if (name === 'dataset') Object.assign(node.dataset, value);
    else if (name.startsWith('on')) node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(name, '');
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value);
  }
  node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined));
  return node;
}

// Like replaceChildren, but a missing child is skipped. replaceChildren would write the word "null".
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
}

const NUMBER = new Intl.NumberFormat();
const SHORT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
// 75,394 as 75K, for where there isn't room.
export const shortCount = (count) => SHORT.format(count);

export function formatCount(count) {
  return NUMBER.format(count);
}

export function words(count) {
  return `${formatCount(count)} ${count === 1 ? 'word' : 'words'}`;
}
