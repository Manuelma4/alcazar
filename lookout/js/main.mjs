// Lookout · main: builds the shell (sidebar / rail / bottom bar, top bar,
// footer), applies the theme, and routes between views.

import { h, mount } from './dom.mjs';
import { icon, logoMark } from './icons.mjs';
import { t } from './strings.mjs';
import { ROUTES, parseHash, href } from './router.mjs';
import { store } from './store.mjs';
import { readPref, writePref } from './prefs.mjs';
import { initLive, announce } from './live.mjs';
import { loadHealth, restoreJob } from './actions.mjs';
import { formatCountdown, shortHash, formatInt } from './format.mjs';
import { segmented, iconButton } from './ui.mjs';

const THEMES = ['system', 'dark', 'light'];
const THEME_ICONS = { system: 'monitor', dark: 'moon', light: 'sun' };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let theme = readPref('theme', 'system', THEMES);

function applyTheme(mode) {
  theme = mode;
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  const dark = mode === 'dark' || (mode === 'system' && darkQuery.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A0F1E' : '#F6F1E7');
  document.querySelectorAll('[data-theme-option]').forEach((input) => {
    input.checked = input.value === mode;
  });
  const cycle = document.querySelector('.theme-cycle');
  if (cycle) {
    cycle.replaceChildren(icon(THEME_ICONS[mode], { size: 16 }));
    const label = t('theme.cycle', { mode: t(`theme.${mode}`) });
    cycle.setAttribute('aria-label', label);
    cycle.setAttribute('title', label);
  }
}

function setTheme(mode) {
  writePref('theme', mode === 'system' ? null : mode);
  applyTheme(mode);
}

// ---------- shell ----------
const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');
const main = document.getElementById('main');
const foot = document.getElementById('site-foot');

const navLinks = new Map();
const crumbView = h('strong', null, '');
const healthMini = h('span', { class: 'health-mini' });
const jobSlot = h('div', { class: 'job-slot', css: { 'min-width': '0' } });

function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': t('nav.label') },
    h('ul', null, ROUTES.map((route) => {
      const link = h('a', { class: 'nav-link', href: href(route.id), dataset: { route: route.id } },
        h('span', { class: 'nav-icon' }, icon(route.icon, { size: 20 })),
        h('span', { class: 'nav-text' },
          h('span', { class: 'nav-name' }, t(`nav.${route.id}`)),
          h('span', { class: 'nav-sub' }, t(`nav.${route.id}.sub`))),
        h('span', { class: 'nav-short', 'aria-hidden': 'true' }, t(`nav.${route.id}.short`)));
      navLinks.set(route.id, link);
      return h('li', null, link);
    })));

  const themeControl = segmented({
    name: 'theme',
    legend: t('theme.legend'),
    iconOnly: true,
    value: theme,
    options: THEMES.map((mode) => ({ value: mode, label: t(`theme.${mode}`), icon: THEME_ICONS[mode] })),
    onChange: setTheme,
  });
  themeControl.querySelectorAll('input').forEach((input) => input.setAttribute('data-theme-option', ''));

  mount(sidebar,
    h('a', { class: 'brand', href: href('overview'), 'aria-label': t('brand.home') },
      logoMark({ size: 40 }),
      h('span', { class: 'brand-text' },
        h('span', { class: 'brand-name' }, t('brand.name')),
        h('span', { class: 'brand-sub' }, t('brand.product')))),
    h('div', { class: 'sidebar-rule', 'aria-hidden': 'true' }),
    nav,
    h('div', { class: 'sidebar-foot' },
      healthMini,
      themeControl,
      h('p', { class: 'foot-meta' }, t('foot.meta'))));

  const cycle = iconButton({
    label: t('theme.cycle', { mode: t(`theme.${theme}`) }),
    icon: THEME_ICONS[theme],
    onClick: () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]),
  });
  cycle.classList.add('theme-cycle');

  mount(topbar,
    h('a', { class: 'topbar-brand', href: href('overview'), 'aria-label': t('brand.home') },
      logoMark({ size: 30 }),
      h('span', { class: 'brand-name' }, t('brand.name'))),
    h('p', { class: 'crumbs' }, h('span', null, t('brand.name')), h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'), crumbView),
    h('span', { class: 'spacer' }),
    jobSlot,
    cycle);

  mount(foot,
    h('span', null, t('foot.left')),
    h('span', null, t('foot.csp')),
    h('span', null, t('foot.deps')));
}

function renderHealthMini() {
  const health = store.get('health');
  const error = store.get('healthError');
  let tone = 'tone-muted';
  let label = t('health.checking');
  if (error) {
    tone = 'tone-danger';
    label = t('health.unreachable');
  } else if (health) {
    const ok = health.status === 'ok' && health.selftest.status === 'pass';
    tone = ok ? 'tone-ok' : 'tone-warn';
    label = ok ? t('health.ok', { version: health.version }) : t('health.degraded');
  }
  mount(healthMini,
    h('span', { class: ['dot', tone], 'aria-hidden': 'true' }),
    h('span', { class: 'health-mini-text' }, label));
  healthMini.setAttribute('title', label);
}

let ttlTimer = 0;
function renderJobChip() {
  clearInterval(ttlTimer);
  const job = store.get('job');
  if (!job) {
    mount(jobSlot, h('a', { class: 'job-chip is-empty', href: href('transactions') },
      icon('coins', { size: 16 }), h('span', null, t('job.none'))));
    return;
  }
  const ttl = h('span', { class: 'job-ttl' });
  const tick = () => {
    const left = Date.parse(job.expiresAt) - Date.now();
    if (Number.isFinite(left) && left <= 0) {
      clearInterval(ttlTimer);
      ttl.textContent = t('job.expired');
      return;
    }
    ttl.textContent = Number.isFinite(left) ? t('job.ttl', { time: formatCountdown(left) }) : '';
  };
  tick();
  ttlTimer = setInterval(tick, 1000);
  mount(jobSlot, h('a', {
    class: 'job-chip',
    href: href('transactions'),
    title: t('job.title', { id: job.job }),
  },
  h('span', { class: ['dot', job.ledger.verification.stale ? 'tone-warn' : job.ledger.verification.valid ? 'tone-ok' : 'tone-danger'], 'aria-hidden': 'true' }),
  h('span', { class: 'sr-only' }, t('job.sr')),
  h('span', { class: 'hash' }, shortHash(job.job, 6, 4)),
  h('span', { class: 'job-count' }, t('job.count', { n: formatInt(job.summary.received) })),
  ttl));
}

// ---------- routing ----------
let current = null;
let navToken = 0;
let firstRender = true;

async function navigate() {
  // In-page anchors (#main for the skip link) are not routes.
  if (current && /^#[A-Za-z][\w-]*$/.test(location.hash) && document.getElementById(location.hash.slice(1))) return;
  const parsed = parseHash();
  if (!parsed) {
    const last = readPref('view', 'overview', ROUTES.map((r) => r.id));
    history.replaceState(null, '', href(last));
    return navigate();
  }
  const { route, param } = parsed;
  const token = ++navToken;
  for (const [id, link] of navLinks) {
    if (id === route.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const name = t(`nav.${route.id}`);
  crumbView.textContent = name;
  document.title = t('doc.title', { view: name });
  writePref('view', route.id);

  let mod;
  try {
    mod = await import(route.module);
  } catch (error) {
    if (token !== navToken) return;
    console.error(error);
    current?.cleanup?.();
    current = null;
    mount(main, h('p', { class: 'lead' }, t('error.viewLoad')));
    return;
  }
  if (token !== navToken) return;
  // A drawer left open would keep the new view inert: close it first.
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  try {
    current?.cleanup?.();
  } catch (error) {
    console.error(error);
  }
  current = null;
  const view = mod.render({ param });
  current = view;
  mount(main, view.el);
  if (!firstRender) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    main.querySelector('#view-title')?.focus({ preventScroll: true });
    announce(t('nav.announce', { view: name }));
  }
  firstRender = false;
}

// ---------- boot ----------
document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: 'start' });
});
initLive({ announcerEl: document.getElementById('announcer'), toastsEl: document.getElementById('toasts') });
buildShell();
applyTheme(theme);
darkQuery.addEventListener('change', () => applyTheme(theme));
store.on(['health', 'healthError'], renderHealthMini);
store.on('job', renderJobChip);
renderHealthMini();
renderJobChip();
window.addEventListener('hashchange', navigate);
navigate();
loadHealth();
restoreJob();
