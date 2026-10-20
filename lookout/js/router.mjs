// Lookout · router: hash routes (#/overview …), no server round-trip.

export const ROUTES = Object.freeze([
  { id: 'overview', icon: 'lookout', module: './views/overview.mjs' },
  { id: 'transactions', icon: 'coins', module: './views/transactions.mjs' },
  { id: 'seal', icon: 'seal', module: './views/seal.mjs' },
  { id: 'siege', icon: 'siege', module: './views/siege.mjs' },
  { id: 'watchtower', icon: 'watchtower', module: './views/watchtower.mjs' },
  { id: 'defenses', icon: 'shield', module: './views/defenses.mjs' },
]);

const PATTERN = /^#\/([a-z]+)(?:\/([A-Za-z0-9._-]{1,64}))?$/;

/** @returns {{ route: object, param: string | null } | null} */
export function parseHash(hash = globalThis.location?.hash ?? '') {
  const match = PATTERN.exec(hash);
  if (!match) return null;
  const route = ROUTES.find((r) => r.id === match[1]);
  return route ? { route, param: match[2] ?? null } : null;
}

export function href(id, param) {
  return param ? `#/${id}/${encodeURIComponent(param)}` : `#/${id}`;
}

export function go(id, param) {
  const target = href(id, param);
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}
