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

/**
 * A short visual confirmation. The toast area is not a live region: the
 * message is announced once through the announcer, unless `silent` says the
 * action that produced it already announced it.
 */
export function toast(message, { tone = 'ok', ms = 3200, silent = false } = {}) {
  if (!silent) announce(message);
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
