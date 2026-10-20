// Lookout · prefs: per-viewer conveniences only (theme, last view, last job id).
// Browser storage can be missing or throw (private mode, blocked site data),
// so every access is wrapped and the UI works without it. No transaction
// data is ever written to storage.

const PREFIX = 'lookout.';

function area(kind) {
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readPref(key, fallback, allowed = null, kind = 'local') {
  try {
    const value = area(kind)?.getItem(PREFIX + key) ?? null;
    if (value === null) return fallback;
    if (allowed && !allowed.includes(value)) return fallback;
    return value;
  } catch {
    return fallback;
  }
}

export function writePref(key, value, kind = 'local') {
  try {
    const store = area(kind);
    if (!store) return;
    if (value === null || value === undefined) store.removeItem(PREFIX + key);
    else store.setItem(PREFIX + key, String(value));
  } catch {
    /* storage unavailable: the preference simply isn't remembered */
  }
}

/** Keys this page keeps, for the Defenses view's transparency list. */
export function storedEntries() {
  const out = [];
  for (const kind of ['local', 'session']) {
    try {
      const store = area(kind);
      if (!store) continue;
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key?.startsWith(PREFIX)) out.push({ kind, key, value: store.getItem(key) ?? '' });
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}
