// dom.js — minimal DOM helpers (no framework, no dependencies)

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null) continue;
    node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function formatNumber(value, options = {}) {
  if (value == null || value === '') return '';
  return new Intl.NumberFormat('en-US', options).format(Number(value));
}

export function formatCurrency(value) {
  return formatNumber(value, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso) {
  if (!iso) return '';
  const s = String(iso);
  // Plain YYYY-MM-DD: assemble the label by hand so no Date object (and no
  // local timezone) is ever involved — no off-by-one day for UTC-minus users.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const month = MONTH_SHORT[Number(m[2]) - 1];
    if (month) return `${month} ${m[3]}, ${m[1]}`;
  }
  // Anything else is returned as-is: a safe fallback, never a timezone guess.
  return s;
}
