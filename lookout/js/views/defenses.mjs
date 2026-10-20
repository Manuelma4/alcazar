// Lookout · Defenses: the security posture, partly reported by Gatehouse
// (/api/posture, /api/health) and partly checked live by this page.

import { h, mount } from '../dom.mjs';
import { icon } from '../icons.mjs';
import { t } from '../strings.mjs';
import { store } from '../store.mjs';
import { api } from '../api.mjs';
import { loadPosture } from '../actions.mjs';
import { storedEntries } from '../prefs.mjs';
import { formatBytes, formatInt, formatMs } from '../format.mjs';
import { button, card, chip, dataTable, errorBanner, viewHeader } from '../ui.mjs';

export function parseCsp(header) {
  const out = new Map();
  for (const part of String(header ?? '').split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    if (!out.has(name)) out.set(name, tokens.slice(1));
  }
  return out;
}

/** Live checks the page can do by itself. */
export function evaluateCsp(csp) {
  const script = csp.get('script-src') ?? csp.get('default-src') ?? [];
  const style = csp.get('style-src') ?? csp.get('default-src') ?? [];
  const unsafe = (list) => list.some((v) => ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", '*', 'data:', 'http:', 'https:'].includes(v.toLowerCase()));
  return {
    present: csp.size > 0,
    defaultNone: (csp.get('default-src') ?? []).join(' ') === "'none'",
    noInline: script.length > 0 && !unsafe(script) && !unsafe(style),
    trustedTypes: (csp.get('require-trusted-types-for') ?? []).includes("'script'"),
    noPolicies: (csp.get('trusted-types') ?? []).join(' ') === "'none'",
    noFraming: (csp.get('frame-ancestors') ?? []).join(' ') === "'none'",
  };
}

const SANDBOX_KEYS = ['shell', 'minimalEnv', 'secretsOnStdin', 'timeoutMs', 'maxOutputBytes', 'rlimits', 'permissionModel'];

function flagInfo(flag) {
  if (t.has(`flag.${flag}`)) return t(`flag.${flag}`);
  const base = flag.split('=')[0];
  if (t.has(`flag.${base}`)) return t(`flag.${base}`);
  if (/^-W/.test(flag)) return flag.startsWith('-Wl') ? t('flag.-Wl') : t('flag.generic.warning');
  if (/^-D_FORTIFY_SOURCE/.test(flag)) return t('flag.-D_FORTIFY_SOURCE');
  const fam = Object.keys({ '-finit-real': 1, '-finit-integer': 1, '-finit-logical': 1, '-fcheck': 1, '-fec': 1, '-ffpe-trap': 1 }).find((k) => flag.startsWith(k));
  return fam ? t(`flag.${fam}`) : '';
}

/** "-A '-fstack-protector-strong -D_FORTIFY_SOURCE=2'" style pairs → one item each. */
function splitFlags(flags) {
  const out = [];
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if ((flag === '-A' || flag === '-Q') && flags[i + 1]) {
      out.push({ flag: `${flag} ${flags[i + 1]}`, info: t(`flag.${flag}`), nested: flags[i + 1].split(/\s+/).filter(Boolean) });
      i += 1;
    } else {
      out.push({ flag, info: flagInfo(flag) });
    }
  }
  return out;
}

export function render() {
  const cleanups = [];
  const top = h('div', { class: 'grid grid-2-1 def-top' });
  const liveSlot = h('div');
  const postureSlot = h('div', { class: 'stack', css: { '--stack-gap': '20px' } });
  const el = h('div', { class: 'view view-defenses' },
    viewHeader({ eyebrow: t('def.eyebrow'), title: t('def.title'), lead: t('def.lead') }),
    top, liveSlot, postureSlot);

  let pageHeaders = null;
  const drawTop = () => {
    const posture = store.get('posture');
    const deps = posture && !posture.error ? posture.dependencies : null;
    mount(top, depsCard(deps), selftestCard(store.get('health')));
  };
  const drawPosture = () => {
    const posture = store.get('posture');
    if (!posture) {
      mount(postureSlot, h('p', { class: 'status-line is-busy' }, icon('spinner', { size: 16 }), t('health.checking')));
      return;
    }
    if (posture.error) {
      mount(postureSlot, errorBanner(posture.error, { title: t('def.unavailable') }));
      return;
    }
    mount(postureSlot, headersCard(posture.headers, pageHeaders), h('div', { class: 'grid grid-2' }, sandboxCard(posture.sandbox), buildCard(posture.build)));
  };
  cleanups.push(store.on('posture', () => { drawTop(); drawPosture(); }));
  cleanups.push(store.on('health', drawTop));
  drawTop();
  drawPosture();
  if (!store.get('posture') || store.get('posture').error) loadPosture();

  mount(liveSlot, card({ title: t('def.live.title'), sub: t('def.live.sub'), body: h('p', { class: 'status-line is-busy' }, icon('spinner', { size: 16 }), t('health.checking')) }));
  api.pageHeaders().then((res) => {
    pageHeaders = res.headers;
    mount(liveSlot, liveCard(res.headers));
    drawPosture();
  }).catch(() => {
    mount(liveSlot, liveCard({}));
  });

  return { el, cleanup: () => cleanups.forEach((fn) => fn()) };
}

// ---------- zero dependencies ----------
function depsCard(deps) {
  const n = (v) => (Number.isFinite(v) ? formatInt(v) : '\u{2014}');
  return h('section', { class: 'card deps-card is-accent', 'aria-labelledby': 'deps-title' },
    h('p', { class: 'eyebrow' }, icon('package', { size: 14 }), t('def.deps.title')),
    h('h2', { class: 'sr-only', id: 'deps-title' }, t('def.deps.title')),
    h('div', { class: 'deps-figures' },
      h('div', { class: 'deps-figure' }, h('span', { class: 'deps-num' }, n(deps?.runtime)), h('span', { class: 'deps-label' }, t('def.deps.runtime'))),
      h('div', { class: 'deps-figure' }, h('span', { class: 'deps-num' }, n(deps?.dev)), h('span', { class: 'deps-label' }, t('def.deps.dev')))),
    h('p', { class: 'text-2' }, t('def.deps.body')),
    inventoryTable());
}

/** What this tab actually loaded, from the Resource Timing API. */
function inventoryTable() {
  const groups = { document: [], script: [], style: [], image: [], data: [] };
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) groups.document.push(nav);
  for (const r of performance.getEntriesByType('resource')) {
    let path = '';
    try {
      path = new URL(r.name).pathname;
    } catch {
      continue;
    }
    if (path.startsWith('/api/')) groups.data.push(r);
    else if (/\.m?js$/.test(path)) groups.script.push(r);
    else if (/\.css$/.test(path)) groups.style.push(r);
    else if (/\.(svg|png|ico|webmanifest)$/.test(path)) groups.image.push(r);
    else if (path === '/' || path.endsWith('.html')) groups.document.push(r);
  }
  const rows = Object.entries(groups).filter(([, list]) => list.length).map(([kind, list]) => ({
    kind,
    count: list.length,
    bytes: list.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0),
  }));
  return h('div', { class: 'inventory' },
    h('p', { class: 'section-title' }, t('def.inventory.title')),
    h('dl', { class: 'inventory-list' }, rows.map((r) => h('div', null,
      h('dt', null, t(`def.inventory.${r.kind}`)),
      h('dd', null, h('span', { class: 'strong' }, formatInt(r.count)), h('span', { class: 'muted mono small' }, ` \u{00B7} ${formatBytes(r.bytes)}`))))),
    h('p', { class: 'tiny muted' }, t('def.inventory.note')));
}

// ---------- self-test ----------
function selftestCard(health) {
  if (!health) return card({ title: t('def.selftest.title'), body: h('p', { class: 'status-line is-busy' }, icon('spinner', { size: 16 }), t('health.checking')) });
  return card({
    title: t('def.selftest.title'),
    sub: t('def.selftest.sub'),
    actions: chip(health.selftest.status === 'pass' ? t('common.pass') : t('common.fail'), { tone: health.selftest.status === 'pass' ? 'ok' : 'danger', dot: true }),
    body: h('ul', { class: 'check-list' }, health.selftest.checks.map((c) => checkItem(c.status === 'pass', t.has(`selftest.${c.name}`) ? t(`selftest.${c.name}`) : c.name, c.detail ?? h('span', { class: 'mono' }, c.name)))),
  });
}

function checkItem(ok, title, detail, tone) {
  const state = tone ?? (ok ? 'ok' : 'bad');
  return h('li', { class: ['check', `is-${state}`] },
    h('span', { class: 'check-icon', 'aria-hidden': 'true' }, icon(state === 'ok' ? 'check' : state === 'warn' ? 'alert' : 'x', { size: 14 })),
    h('span', { class: 'check-text' },
      h('span', { class: 'check-title' }, title, h('span', { class: 'sr-only' }, ` \u{2014} ${state === 'ok' ? t('common.pass') : t('common.fail')}`)),
      detail ? h('span', { class: 'check-detail' }, detail) : null));
}

// ---------- live checks ----------
function liveCard(headers) {
  const csp = parseCsp(headers['content-security-policy']);
  const ev = evaluateCsp(csp);
  const resources = performance.getEntriesByType('resource');
  const foreign = resources.filter((r) => {
    try {
      return new URL(r.name).origin !== location.origin;
    } catch {
      return false;
    }
  });
  const stored = storedEntries();
  const ttApi = typeof globalThis.trustedTypes?.createPolicy === 'function';
  const checks = h('ul', { class: 'check-list is-grid' },
    checkItem(ev.present, t('def.check.csp'), ev.present ? t('def.check.csp.ok', { n: csp.size }) : t('def.check.csp.missing')),
    checkItem(ev.trustedTypes && ev.noPolicies, t('def.check.tt'), ev.trustedTypes ? t('def.check.tt.ok') : t('def.check.tt.missing')),
    checkItem(ev.noInline && ev.defaultNone, t('def.check.inline'), ev.noInline ? t('def.check.inline.ok') : t('def.check.inline.bad')),
    checkItem(ev.noFraming && window.top === window.self, t('def.check.frame'), ev.noFraming && window.top === window.self ? t('def.check.frame.ok') : t('def.check.frame.bad')),
    checkItem(globalThis.crossOriginIsolated === true, t('def.check.isolated'), globalThis.crossOriginIsolated ? t('def.check.isolated.ok') : t('def.check.isolated.bad')),
    checkItem(globalThis.isSecureContext === true, t('def.check.secure'), globalThis.isSecureContext ? t('def.check.secure.ok') : t('def.check.secure.bad')),
    checkItem(foreign.length === 0, t('def.check.thirdparty'), foreign.length === 0 ? t('def.check.thirdparty.ok', { n: resources.length }) : t('def.check.thirdparty.bad', { n: foreign.length })),
    checkItem(headers['x-content-type-options'] === 'nosniff', t('def.check.sniff'), t('def.check.sniff.ok')),
    checkItem(Boolean(headers['referrer-policy']), t('def.check.referrer'), h('span', { class: 'mono' }, headers['referrer-policy'] ?? '\u{2014}')),
    checkItem(true, t('def.check.storage'), stored.length ? t('def.check.storage.ok', { keys: stored.map((s) => s.key).join(', ') }) : t('def.check.storage.none')),
    checkItem(ttApi, t('def.check.tt.api'), ttApi ? h('span', { class: 'mono' }, 'window.trustedTypes') : t('common.no'), ttApi ? 'ok' : 'warn'));

  const directives = csp.size
    ? dataTable({
      caption: t('def.directives.title'),
      columns: [
        { key: 'name', label: t('col.name'), render: (r) => h('span', { class: 'mono strong nowrap' }, r.name) },
        { key: 'value', label: t('col.value'), render: (r) => h('span', { class: 'mono' }, r.value) },
        { key: 'info', label: '', render: (r) => h('span', { class: 'small text-2' }, r.info) },
      ],
      rows: [...csp].map(([name, value]) => ({ name, value: value.join(' '), info: t.has(`dir.${name}`) ? t(`dir.${name}`) : '' })),
      stack: true,
    })
    : null;

  return card({
    title: t('def.live.title'),
    sub: t('def.live.sub'),
    className: 'live-card',
    body: [
      checks,
      directives ? h('h3', { class: 'section-title', css: { margin: '20px 0 10px' } }, t('def.directives.title')) : null,
      directives,
      probeBlock(),
    ],
  });
}

/**
 * Opt-in: ask the browser for a Trusted Types policy. With
 * `trusted-types 'none'` it must refuse — which proves the DOM sinks are
 * closed for good. (It also logs one CSP violation, by design.)
 */
function probeBlock() {
  const result = h('p', { class: 'small', 'aria-live': 'polite' });
  const run = button({
    label: t('def.probe.run'),
    icon: 'target',
    size: 'sm',
    onClick: () => {
      let refused = false;
      try {
        globalThis.trustedTypes?.createPolicy(`lookout-probe-${Date.now()}`, {});
      } catch {
        refused = true;
      }
      if (!globalThis.trustedTypes) refused = false;
      mount(result,
        chip(refused ? t('def.probe.blocked') : t('def.probe.allowed'), { tone: refused ? 'ok' : 'danger', icon: refused ? 'shield' : 'alert' }),
        ' ',
        h('span', { class: 'text-2' }, refused ? t('def.probe.refused') : t('def.probe.notRefused')));
    },
  });
  return h('div', { class: 'probe' },
    h('div', { class: 'stack', css: { '--stack-gap': '4px' } },
      h('p', { class: 'strong' }, t('def.probe.title')),
      h('p', { class: 'small text-2' }, t('def.probe.body'))),
    h('div', { class: 'row' }, run, result));
}

// ---------- headers ----------
function headersCard(headers, live) {
  const rows = Object.entries(headers).map(([name, value]) => ({ name, value, info: t.has(`hdr.${name}`) ? t(`hdr.${name}`) : '', live: live ? live[name] === value : null }));
  return card({
    title: t('def.headers.title'),
    sub: t('def.headers.sub'),
    className: 'layer-gatehouse',
    body: dataTable({
      caption: t('def.headers.title'),
      columns: [
        { key: 'name', label: t('col.name'), render: (r) => h('span', { class: 'mono strong' }, r.name) },
        { key: 'value', label: t('col.value'), render: (r) => h('span', { class: 'mono small break' }, r.value) },
        { key: 'info', label: '', render: (r) => h('span', { class: 'small text-2' }, r.info) },
        {
          key: 'live',
          label: t('def.headers.live'),
          render: (r) => (r.live === null ? '\u{2014}' : r.live
            ? h('span', { class: 'ink-ok', title: t('def.headers.match') }, icon('check', { size: 16, label: t('def.headers.match') }))
            : h('span', { class: 'ink-warn', title: t('def.headers.differ') }, icon('alert', { size: 16, label: t('def.headers.differ') }))),
        },
      ],
      rows,
      stack: true,
    }),
  });
}

// ---------- sandbox ----------
function sandboxCard(sandbox) {
  const keys = [...SANDBOX_KEYS.filter((k) => k in sandbox), ...Object.keys(sandbox).filter((k) => !SANDBOX_KEYS.includes(k))];
  return card({
    title: t('def.sandbox.title'),
    sub: t('def.sandbox.sub'),
    className: 'layer-cobol',
    body: h('ul', { class: 'check-list' }, keys.map((key) => {
      const value = sandbox[key];
      const title = t.has(`sandbox.${key}`) ? t(`sandbox.${key}`) : key;
      const desc = t.has(`sandbox.${key}.desc`) ? t(`sandbox.${key}.desc`) : '';
      if (key === 'shell') return checkItem(value === false, title, desc);
      if (typeof value === 'boolean') {
        const unavailable = !value && (key === 'rlimits');
        return checkItem(value, title, [desc, ' ', h('strong', null, value ? t('sandbox.enabled') : unavailable ? t('sandbox.unavailable') : t('sandbox.disabled'))], value ? 'ok' : 'warn');
      }
      if (typeof value === 'number') {
        const shown = key.endsWith('Ms') ? formatMs(value) : key.endsWith('Bytes') ? formatBytes(value) : formatInt(value);
        return checkItem(true, title, [desc, ' ', h('strong', { class: 'mono' }, shown)]);
      }
      return checkItem(true, title, h('span', { class: 'mono' }, String(value)));
    })),
  });
}

// ---------- compiler hardening ----------
function buildCard(build) {
  const block = (lang, info) => h('section', { class: 'build-block' },
    h('h3', { class: 'build-title' }, icon(lang === 'cobol' ? 'rampart' : 'observatory', { size: 16 }), h('span', null, info.compiler || '\u{2014}')),
    h('ul', { class: 'flag-list' }, splitFlags(info.flags).map((f) => h('li', null,
      h('code', { class: 'flag' }, f.flag),
      f.info ? h('span', { class: 'flag-info' }, f.info) : null,
      f.nested ? h('span', { class: 'flag-nested' }, f.nested.map((n) => h('span', null, h('code', { class: 'flag is-small' }, n), flagInfo(n) ? ` ${flagInfo(n)}` : ''))) : null))));
  return card({
    title: t('def.build.title'),
    sub: t('def.build.sub'),
    className: 'layer-fortran',
    body: h('div', { class: 'stack', css: { '--stack-gap': '18px' } }, block('cobol', build.cobol), block('fortran', build.fortran)),
  });
}
