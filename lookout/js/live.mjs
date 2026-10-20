// Lookout · live: screen-reader announcements and toasts.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';

let announcer = null;
let toasts = null;

export function initLive({ announcerEl, toastsEl }) {
  announcer = announcerEl;
  toasts = toastsEl;
}

/** Polite announcement through the global live region. */
export function announce(message) {
  if (!announcer) return;
  // Clear first so repeating the same sentence is still announced.
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = String(message);
  }, 40);
}

/** A short visual confirmation (also announced through the toast live region). */
export function toast(message, { tone = 'ok', ms = 3200 } = {}) {
  if (!toasts) return;
  const el = h('div', { class: ['toast', `tone-${tone}`] },
    icon(tone === 'danger' ? 'alert' : tone === 'info' ? 'info' : 'check-circle', { size: 18 }),
    h('span', null, String(message)));
  toasts.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }, ms);
}
