// Lookout · dom: the only way the dashboard builds DOM.
//
// Elements are created with createElement / createElementNS and every piece of
// data becomes a Text node. Nothing here ever parses markup, so there is no
// innerHTML-style sink to feed — which is also what the page's Trusted Types
// policy (`require-trusted-types-for 'script'; trusted-types 'none'`) demands.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that can execute or embed foreign documents: never created. */
const BANNED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'foreignobject', 'base', 'meta', 'link', 'style']);

/** Attribute names that would turn data into code or inline style. */
const BANNED_ATTR = /^(on|style$|srcdoc$|formaction$|xmlns)/i;

/** Properties that may be set through `props` (never innerHTML & co). */
const SAFE_PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'open', 'multiple', 'readOnly', 'spellcheck', 'defaultValue', 'tabIndex', 'hidden']);

const URL_ATTRS = new Set(['href', 'src', 'action', 'xlink:href', 'poster']);

/** Allow http(s), mailto, blob, fragment and same-origin relative URLs only. */
export function safeUrl(value) {
  const text = String(value).trim();
  if (text.startsWith('#') || text.startsWith('/') || text.startsWith('./')) return text;
  try {
    const url = new URL(text, globalThis.location?.href ?? 'http://localhost/');
    if (['http:', 'https:', 'mailto:', 'blob:'].includes(url.protocol)) return text;
  } catch {
    /* fall through */
  }
  return '#';
}

function applyAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    switch (key) {
      case 'class':
      case 'className':
        el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
        break;
      case 'dataset':
        for (const [name, v] of Object.entries(value)) if (v !== undefined && v !== null) el.dataset[name] = String(v);
        break;
      case 'on':
        for (const [type, handler] of Object.entries(value)) if (handler) el.addEventListener(type, handler);
        break;
      case 'props':
        for (const [name, v] of Object.entries(value)) {
          if (!SAFE_PROPS.has(name)) throw new Error(`dom: property "${name}" is not allowed`);
          el[name] = v;
        }
        break;
      case 'css':
        // CSSOM custom properties / declarations: allowed by CSP (no style attribute parsing).
        for (const [name, v] of Object.entries(value)) if (v !== undefined && v !== null) el.style.setProperty(name, String(v));
        break;
      case 'ref':
        value(el);
        break;
      default: {
        if (BANNED_ATTR.test(key)) throw new Error(`dom: attribute "${key}" is not allowed`);
        const text = value === true ? '' : String(value);
        el.setAttribute(key, URL_ATTRS.has(key) ? safeUrl(text) : text);
      }
    }
  }
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(document.createTextNode(String(child)));
  }
}

function isAttrs(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Node);
}

function build(create, tag, attrs, children) {
  if (BANNED_TAGS.has(String(tag).toLowerCase())) throw new Error(`dom: <${tag}> is not allowed`);
  const el = create(tag);
  if (isAttrs(attrs)) applyAttrs(el, attrs);
  else if (attrs !== undefined) children.unshift(attrs);
  appendChildren(el, children);
  return el;
}

/** HTML element: h('button', { class: 'btn', on: { click } }, 'Label'). */
export function h(tag, attrs, ...children) {
  return build((t) => document.createElement(t), tag, attrs, children);
}

/** SVG element: svg('path', { d: 'M0 0 L1 1' }). Presentation attributes only. */
export function svg(tag, attrs, ...children) {
  return build((t) => document.createElementNS(SVG_NS, t), tag, attrs, children);
}

/** A text node (explicit form, for clarity at call sites). */
export function text(value) {
  return document.createTextNode(String(value ?? ''));
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  appendChildren(f, children);
  return f;
}

/** Replace all children of `el`. */
export function mount(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

let uid = 0;
/** A document-unique id for aria-* relationships. */
export function id(prefix = 'lk') {
  uid += 1;
  return `${prefix}-${uid}`;
}

/** Debounce for input / resize handlers. */
export function debounce(fn, ms = 150) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
