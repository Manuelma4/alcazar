// Lookout · Seal: the HMAC-chained audit ledger. Walk the chain, tamper with
// it the way an insider would (demo mode), and watch the verifiers find it.
//
// Entries are addressed by their SEQ everywhere in the UI; Gatehouse's tamper
// endpoint takes a line position, which actions.tamperLedger derives.

import { h, mount, svg } from '../dom.mjs';
import { icon } from '../icons.mjs';
import { t } from '../strings.mjs';
import { store } from '../store.mjs';
import { href } from '../router.mjs';
import { runDemo, tamperLedger, verifyLedger } from '../actions.mjs';
import { chainStates } from '../ledgerstate.mjs';
import { formatInt, formatMoney, formatMs, formatTimestamp, shortHash } from '../format.mjs';
import { ACCEPTED_LAYOUT, LEDGER_LAYOUT, LEDGER_MAC_INPUT, REJECTED_LAYOUT, diffRanges } from '../records.mjs';
import { recordView } from '../recordview.mjs';
import {
  banner, button, card, chip, copyButton, emptyState, errorBanner, preserveFocus, segmented, setBusy, statusLine, viewHeader,
} from '../ui.mjs';
import { announce, toast } from '../live.mjs';

const WINDOW = 40;
const VERIFIERS = ['cobol-fortran', 'node-openssl', 'anchor'];
const MODES = ['amount', 'record', 'delete', 'truncate'];
const MODE_ICONS = { amount: 'pen', record: 'file', delete: 'minus-circle', truncate: 'scissors' };
/** The layout of the file a tamper rewrote. */
const FILE_LAYOUTS = {
  'LEDGER.DAT': [LEDGER_LAYOUT, '|'],
  'ACCEPTED.DAT': [ACCEPTED_LAYOUT, ''],
  'REJECTED.DAT': [REJECTED_LAYOUT, ''],
};

/** Per-view state that survives navigation. */
const ui = { selectedSeq: null, start: 0, entry: null, mode: 'amount', job: null, notice: null };

export { chainStates };

export function render({ param } = {}) {
  const cleanups = [];
  const body = h('div', { class: 'stack', css: { '--stack-gap': '20px' } });
  const el = h('div', { class: 'view view-seal' },
    viewHeader({ eyebrow: t('seal.eyebrow'), title: t('seal.title'), lead: t('seal.lead') }),
    body);

  const paramSeq = param && /^\d{1,7}$/.test(param) ? Number(param) : null;
  if (paramSeq) ui.selectedSeq = paramSeq;

  const demoAction = async (btn) => {
    setBusy(btn, true);
    ui.selectedSeq = null;
    const job = await runDemo();
    setBusy(btn, false);
    ui.notice = job ? null : { error: store.get('batchError') };
    schedule();
  };

  const draw = () => {
    const job = store.get('job');
    if (!job) {
      const demo = button({ label: t('common.runDemo'), icon: 'play', variant: 'primary', focusKey: 'seal-demo', onClick: () => demoAction(demo) });
      if (store.get('batchBusy')) setBusy(demo, true);
      preserveFocus(body, () => mount(body,
        ui.notice?.error ? noticeBanner() : null,
        card({ body: emptyState({ icon: 'seal', title: t('seal.none.title'), body: t('seal.none.body'), action: demo }) })));
      return;
    }
    if (ui.job !== job.job) {
      if (ui.job !== null) ui.selectedSeq = null;
      ui.job = job.job;
      ui.start = 0;
      ui.entry = null;
      if (paramSeq && ui.selectedSeq === null) ui.selectedSeq = paramSeq;
    }
    preserveFocus(body, () => mount(body, ...sections(job, demoAction)));
  };

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      draw();
    });
  }
  cleanups.push(store.on(['job', 'verificationStale', 'lastTamper', 'health', 'ledgerBusy', 'batchBusy', 'sealSelection'], schedule));
  draw();
  return { el, cleanup: () => cleanups.forEach((fn) => fn()) };
}

function sections(job, demoAction) {
  const stale = store.get('verificationStale') || job.ledger.verification.stale === true;
  const { states, ghosts, breakIndex } = chainStates(job, stale);
  const entries = job.ledger.entries;
  let selIndex = ui.selectedSeq === null ? -1 : entries.findIndex((e) => e.seq === ui.selectedSeq);
  if (selIndex < 0) selIndex = breakIndex !== null && breakIndex < entries.length ? breakIndex : 0;
  ui.selectedSeq = entries[selIndex]?.seq ?? null;
  if (selIndex < ui.start || selIndex >= ui.start + WINDOW) ui.start = Math.max(0, Math.min(Math.max(0, entries.length - WINDOW), selIndex - 4));

  const out = [];
  if (ui.notice?.error && !ui.notice.refresh) out.push(noticeBanner());
  out.push(h('div', { class: 'grid grid-2-1 seal-top' }, chainCard(job, stale), tamperCard(job, demoAction)));
  const lastTamper = store.get('lastTamper');
  if (lastTamper) out.push(diffCard(lastTamper));
  out.push(mapCard(job, states, ghosts, breakIndex, selIndex));
  if (entries.length) out.push(entriesCard(job, states, ghosts, selIndex));
  if (entries[selIndex]) out.push(inspectorCard(entries[selIndex], states[selIndex], lastTamper));
  return out;
}

/**
 * The error banner of the current notice, built once: every redraw re-inserts
 * the same node, and only its first insertion is an alert, so a screen
 * reader hears the failure once, not on every tile click.
 */
function noticeBanner() {
  if (!ui.notice.banner) {
    ui.notice.banner = errorBanner(ui.notice.error);
  } else {
    ui.notice.banner.removeAttribute('role');
  }
  return ui.notice.banner;
}

// ---------- chain summary + verifiers ----------
function chainCard(job, stale) {
  const v = job.ledger.verification;
  const busy = store.get('ledgerBusy');
  const verifyBtn = button({ label: t('seal.verify'), icon: 'shield', variant: stale ? 'primary' : 'secondary', focusKey: 'seal-verify', onClick: onVerify });
  if (busy) setBusy(verifyBtn, true, t('seal.verifying'));
  async function onVerify() {
    try {
      const result = await verifyLedger();
      if (!result) return;
      ui.notice = null;
      toast(result.valid
        ? t('seal.announce.valid', { entries: formatInt(result.entries), n: result.verifiedBy.length })
        : t('seal.announce.broken', { reason: result.reason ?? '', seq: result.brokenAt ?? '' }), { tone: result.valid ? 'ok' : 'danger', silent: true });
    } catch (error) {
      ui.notice = { error };
      store.emit('sealSelection');
    }
  }

  let verdict;
  if (stale) {
    verdict = banner({ tone: 'warn', icon: 'alert', title: t('seal.status.stale') });
  } else if (v.valid) {
    verdict = banner({ tone: 'ok', icon: 'seal', title: t('seal.status.valid'), body: t('seal.status.validBody', { entries: formatInt(v.entries), n: v.verifiedBy.length, ms: formatMs(v.ms) }) });
  } else if (v.reason === null) {
    // Gatehouse could not complete a verification: no verdict, no "valid".
    verdict = banner({ tone: 'warn', icon: 'alert', title: t('seal.status.unverified'), body: t('seal.status.unverifiedBody') });
  } else {
    verdict = banner({
      tone: 'danger',
      icon: 'link-broken',
      title: t('seal.status.broken', { seq: v.brokenAt ?? '?' }),
      body: [h('span', { class: 'mono strong' }, v.reason ?? ''), ' \u{2014} ', t.has(`reason.${v.reason}`) ? t(`reason.${v.reason}`) : ''],
    });
  }

  const verifiers = h('ul', { class: 'verifiers', 'aria-label': t('seal.verifiers.title') }, VERIFIERS.map((name) => {
    const reported = !stale && v.verifiedBy.includes(name);
    const tone = stale || !reported ? 'muted' : v.valid ? 'ok' : 'danger';
    const verdictKey = stale ? 'seal.verifier.pending' : !reported ? 'seal.verifier.silent' : v.valid ? 'seal.verifier.agrees' : 'seal.verifier.detected';
    return h('li', { class: ['verifier', `is-${tone}`] },
      h('span', { class: 'verifier-icon', 'aria-hidden': 'true' }, icon(stale ? 'clock' : reported ? (v.valid ? 'check' : 'link-broken') : 'minus-circle', { size: 15 })),
      h('span', { class: 'verifier-text' },
        h('span', { class: 'verifier-name' }, t(`verifier.${name}`)),
        h('span', { class: 'verifier-desc' }, t(`verifier.${name}.desc`))),
      h('span', { class: 'verifier-verdict' }, t(verdictKey)));
  }));

  return card({
    title: t('seal.summary.title'),
    actions: verifyBtn,
    className: 'layer-seal',
    body: [
      verdict,
      h('dl', { class: 'kv seal-kv' },
        h('dt', null, t('seal.algorithm')), h('dd', null, chip(job.ledger.algorithm || 'HMAC-SHA256', { mono: true, tone: 'gold', className: 'square' })),
        h('dt', null, t('seal.entries')), h('dd', { class: 'strong' }, formatInt(job.ledger.entries.length)),
        h('dt', null, t('seal.genesis')), h('dd', null, hashLine(job.ledger.genesis, t('seal.genesis')), h('span', { class: 'tiny muted mono' }, t('seal.genesisHint'))),
        h('dt', null, t('seal.head')), h('dd', null, hashLine(job.ledger.head, t('seal.head'))),
        h('dt', null, t('seal.job')), h('dd', null, h('a', { class: 'mono small', href: href('transactions') }, job.job))),
      h('h3', { class: 'section-title' }, t('seal.verifiers.title')),
      h('p', { class: 'small muted' }, t('seal.verifiers.sub')),
      verifiers,
    ],
  });
}

function hashLine(hex, what) {
  return h('span', { class: 'hash-line' }, h('span', { class: 'hash', title: hex }, shortHash(hex, 10, 10)), copyButton(hex, { what }));
}

// ---------- tamper console ----------
function tamperCard(job, demoAction) {
  const health = store.get('health');
  const demo = health?.demo === true;
  const busy = store.get('ledgerBusy');
  const entries = job.ledger.entries;
  const fresh = button({ label: t('seal.fresh'), icon: 'refresh', variant: 'ghost', size: 'sm', focusKey: 'seal-fresh', onClick: () => demoAction(fresh) });
  if (store.get('batchBusy')) setBusy(fresh, true);
  if (!entries.length) {
    return card({ title: t('seal.tamper.title'), actions: fresh, body: emptyState({ icon: 'seal', title: t('seal.tamper.emptyLedger') }) });
  }
  if (ui.entry === null || !entries.some((e) => String(e.seq) === String(ui.entry))) ui.entry = String(ui.selectedSeq ?? entries[0].seq);
  const status = statusLine();
  const inputId = 'seal-entry';
  const entryInput = h('input', {
    id: inputId,
    class: 'input mono',
    type: 'number',
    min: 1,
    step: 1,
    inputmode: 'numeric',
    'aria-describedby': `${inputId}-hint`,
    props: { value: ui.entry, disabled: !demo },
    on: { input: (e) => { ui.entry = e.target.value; } },
  });
  const goBtn = button({ label: t('seal.tamper.go'), icon: 'pen', variant: 'danger', disabled: !demo, focusKey: 'seal-tamper', onClick: onTamper });
  if (busy) setBusy(goBtn, true, t('seal.tamper.busy'));
  async function onTamper() {
    const seq = Number(ui.entry);
    if (!Number.isInteger(seq) || !entries.some((e) => e.seq === seq)) {
      entryInput.setAttribute('aria-invalid', 'true');
      status.set('error', t('seal.tamper.invalid'));
      return;
    }
    entryInput.removeAttribute('aria-invalid');
    try {
      const result = await tamperLedger(seq, ui.mode);
      if (result?.missing) {
        status.set('error', t('seal.tamper.invalid'));
        return;
      }
      if (!result) return;
      ui.selectedSeq = seq;
      toast(t('seal.tamper.done', { seq, mode: t(`seal.mode.${ui.mode}`).toLowerCase() }), { silent: true });
      ui.notice = result.refreshError ? { error: result.refreshError, refresh: true } : null;
      store.emit('sealSelection');
    } catch (error) {
      ui.notice = { error };
      store.emit('sealSelection');
    }
  }
  const desc = h('p', { class: 'small text-2', id: 'tamper-desc' }, t(`seal.mode.${ui.mode}.desc`));
  const modes = segmented({
    name: 'tamper-mode',
    legend: t('seal.tamper.mode'),
    describedBy: 'tamper-desc',
    value: ui.mode,
    options: MODES.map((m) => ({ value: m, label: t(`seal.mode.${m}`), icon: MODE_ICONS[m] })),
    onChange: (m) => {
      ui.mode = m;
      desc.textContent = t(`seal.mode.${m}.desc`);
    },
    className: 'tamper-modes',
  });
  if (!demo) modes.disabled = true;

  return card({
    title: t('seal.tamper.title'),
    sub: t('seal.tamper.sub'),
    actions: fresh,
    className: 'tamper-card',
    body: [
      demo ? null : banner({ tone: 'warn', icon: 'lock', title: t('seal.tamper.disabled') }),
      ui.notice?.refresh ? banner({ tone: 'warn', icon: 'alert', title: t('seal.tamper.refreshFailed') }) : null,
      h('div', { class: 'field' },
        h('label', { class: 'label', for: inputId }, t('seal.tamper.entry')),
        entryInput,
        h('p', { class: 'hint', id: `${inputId}-hint` }, t('seal.tamper.entryHint'))),
      h('div', { class: 'field' }, modes, desc),
      h('div', { class: 'row' }, goBtn),
      status.el,
    ],
  });
}

// ---------- diff of the last tamper ----------
function diffCard(last) {
  const ranges = last.before && last.after ? diffRanges(last.before, last.after) : [];
  const seq = last.entrySeq ?? last.seq;
  const file = FILE_LAYOUTS[last.file] ? last.file : 'LEDGER.DAT';
  const [layout, separator] = FILE_LAYOUTS[file];
  return card({
    title: t('seal.diff.title'),
    sub: `${t(`seal.mode.${last.mode}`)} \u{00B7} ${t('seal.tamper.entry')} ${seq} \u{00B7} ${file}`,
    className: 'diff-card',
    body: h('div', { class: 'grid grid-2' },
      h('div', { class: 'stack' },
        h('p', { class: 'eyebrow' }, t('seal.diff.before')),
        last.before ? recordView(last.before, layout, { separator, changed: ranges, caption: `${file} \u{00B7} ${t('seal.diff.before')}` }) : null),
      h('div', { class: 'stack' },
        h('p', { class: 'eyebrow ink-danger' }, t('seal.diff.after')),
        last.after
          ? recordView(last.after, layout, { separator, changed: ranges, caption: `${file} \u{00B7} ${t('seal.diff.after')}` })
          : banner({ tone: 'danger', icon: MODE_ICONS[last.mode] ?? 'minus-circle', title: t('seal.diff.removed') }))),
  });
}

// ---------- ledger map ----------
function mapCard(job, states, ghosts, breakIndex, selIndex) {
  const entries = job.ledger.entries;
  const host = h('div', { class: 'ledger-map' });
  const cells = [];
  entries.forEach((e, i) => {
    ghosts.filter((g) => g.at === i).forEach((g) => cells.push({ kind: 'missing', ghost: g }));
    cells.push({ kind: states[i], type: e.type, index: i });
  });
  ghosts.filter((g) => g.at >= entries.length).forEach((g) => cells.push({ kind: 'missing', ghost: g }));

  const drawMap = () => {
    const width = Math.max(200, host.clientWidth || 800);
    const cell = 8;
    const gap = 2;
    const cols = Math.max(10, Math.floor((width + gap) / (cell + gap)));
    const rows = Math.max(1, Math.ceil(cells.length / cols));
    const svgEl = svg('svg', {
      viewBox: `0 0 ${cols * (cell + gap)} ${rows * (cell + gap)}`,
      width: '100%',
      class: 'ledger-map-svg',
      role: 'img',
      'aria-label': mapSummary(job, states, breakIndex),
    });
    cells.forEach((c, k) => {
      const x = (k % cols) * (cell + gap);
      const y = Math.floor(k / cols) * (cell + gap);
      const cls = ['lm-cell', `is-${c.kind}`, c.type === 'R' && 'is-r', c.index === selIndex && 'is-selected',
        c.index !== undefined && c.index >= ui.start && c.index < ui.start + WINDOW && 'in-window'].filter(Boolean).join(' ');
      const rect = svg('rect', { x, y, width: cell, height: cell, rx: 2, class: cls });
      if (c.index !== undefined) {
        rect.addEventListener('click', () => select(entries[c.index].seq));
        rect.append(svg('title', null, `#${String(entries[c.index].seq).padStart(6, '0')} ${entries[c.index].id}`));
      }
      svgEl.append(rect);
    });
    mount(host, svgEl);
  };
  requestAnimationFrame(drawMap);

  const legend = h('ul', { class: 'lm-legend' },
    h('li', null, h('span', { class: 'lm-key is-verified' }), t('seal.legend.accepted')),
    h('li', null, h('span', { class: 'lm-key is-verified is-r' }), t('seal.legend.rejected')),
    h('li', null, h('span', { class: 'lm-key is-broken' }), t('seal.legend.broken')),
    h('li', null, h('span', { class: 'lm-key is-unverifiable' }), t('seal.legend.unverifiable')));
  const target = breakIndex !== null && entries.length ? entries[Math.min(breakIndex, entries.length - 1)] : null;
  const jump = target
    ? button({ label: t('seal.jump.broken'), icon: 'link-broken', size: 'sm', variant: 'danger', focusKey: 'seal-jump', onClick: () => select(target.seq) })
    : null;
  return card({ title: t('seal.chain.title'), sub: t('seal.map.hint'), actions: jump, className: 'map-card', body: [host, legend] });
}

/** What the map shows, in words: its cells are a mouse shortcut only. */
function mapSummary(job, states, breakIndex) {
  const total = formatInt(job.ledger.entries.length);
  if (breakIndex !== null) {
    const entry = job.ledger.entries[Math.min(breakIndex, job.ledger.entries.length - 1)];
    return t('seal.map.summary.broken', { total, seq: entry?.seq ?? breakIndex + 1 });
  }
  return states.every((s) => s === 'verified') ? t('seal.map.summary.ok', { total }) : t('seal.map.summary.unknown', { total });
}

function select(seq) {
  ui.selectedSeq = seq;
  store.emit('sealSelection');
  requestAnimationFrame(() => {
    document.querySelector(`[data-focus-key="tile-${seq}"]`)?.focus({ preventScroll: true });
  });
}

// ---------- the chain of tiles ----------
function entriesCard(job, states, ghosts, selIndex) {
  const entries = job.ledger.entries;
  const end = Math.min(entries.length, ui.start + WINDOW);
  const items = [];
  const link = (state) => h('li', { class: ['chain-link', `is-${state}`], 'aria-hidden': 'true' },
    icon(state === 'broken' ? 'link-broken' : 'link', { size: 18 }));
  for (let i = ui.start; i < end; i += 1) {
    const gapsHere = ghosts.filter((g) => g.at === i);
    gapsHere.forEach((g) => {
      if (items.length) items.push(link('broken'));
      items.push(ghostTile(g));
    });
    if (items.length) {
      const state = states[i] === 'broken' || gapsHere.length ? 'broken' : states[i] === 'unverifiable' ? 'dim' : states[i] === 'unknown' ? 'unknown' : 'ok';
      items.push(link(state));
    }
    items.push(entryTile(entries[i], states[i], i === selIndex));
  }
  if (end === entries.length) {
    ghosts.filter((g) => g.at >= entries.length).forEach((g) => {
      items.push(link('broken'));
      items.push(ghostTile(g));
    });
  }
  const page = (delta) => {
    ui.start = Math.max(0, Math.min(Math.max(0, entries.length - 1), ui.start + delta * WINDOW));
    ui.selectedSeq = entries[ui.start]?.seq ?? null;
    store.emit('sealSelection');
    // Focus stays on the arrow: say what the page now shows.
    announce(t('seal.chain.sub', {
      from: formatInt(Math.min(entries.length, ui.start + 1)), to: formatInt(Math.min(entries.length, ui.start + WINDOW)), total: formatInt(entries.length),
    }));
  };
  const prev = button({ label: '', icon: 'chevron-left', size: 'sm', focusKey: 'seal-prev', attrs: { 'aria-label': t('seal.page.prev'), 'data-focus-fallback': 'seal-next' }, disabled: ui.start === 0, onClick: () => page(-1) });
  const next = button({ label: '', icon: 'chevron-right', size: 'sm', focusKey: 'seal-next', attrs: { 'aria-label': t('seal.page.next'), 'data-focus-fallback': 'seal-prev' }, disabled: end >= entries.length, onClick: () => page(1) });
  const chain = h('ol', { class: 'chain', 'aria-label': t('seal.chain.title') }, items);
  // keep the selected tile in view inside the scroller (without moving the page)
  requestAnimationFrame(() => {
    const tile = chain.querySelector(`[data-focus-key="tile-${entries[selIndex]?.seq}"]`)?.parentElement;
    if (tile) chain.scrollLeft = Math.max(0, tile.offsetLeft - chain.clientWidth / 2 + tile.clientWidth / 2);
  });
  return card({
    title: t('seal.chain.sub', { from: formatInt(Math.min(entries.length, ui.start + 1)), to: formatInt(end), total: formatInt(entries.length) }),
    actions: h('div', { class: 'row', css: { '--row-gap': '6px' } }, prev, next),
    className: 'chain-card',
    body: chain,
  });
}

function entryTile(entry, state, selected) {
  const seq = String(entry.seq).padStart(6, '0');
  const stateLabel = { verified: t('seal.tile.verified'), broken: t('seal.tile.broken'), unverifiable: t('seal.tile.unverifiable'), unknown: '' }[state] ?? '';
  const typeLabel = entry.type === 'R' ? t('seal.tile.rejected') : t('seal.tile.accepted');
  return h('li', { class: ['tile', `is-${state}`, selected && 'is-selected', entry.type === 'R' && 'is-r'] },
    h('button', {
      type: 'button',
      class: 'tile-btn',
      dataset: { focusKey: `tile-${entry.seq}` },
      'aria-current': selected ? 'true' : undefined,
      on: { click: () => select(entry.seq) },
    },
    h('span', { class: 'sr-only' }, `${t('seal.tile.inspect')} `),
    h('span', { class: 'tile-top' },
      h('span', { class: 'tile-seq mono' }, `#${seq}`),
      h('span', { class: ['tile-type', entry.type === 'R' ? 'is-r' : 'is-a'], title: typeLabel },
        h('span', { 'aria-hidden': 'true' }, entry.type),
        h('span', { class: 'sr-only' }, typeLabel)),
      h('span', { class: 'tile-code mono' }, entry.code)),
    h('span', { class: 'tile-id mono' }, entry.id),
    h('span', { class: 'tile-amt' }, entry.currency && entry.sign !== '?'
      ? formatMoney(`${entry.sign === '-' ? '-' : ''}${entry.amountCents || '0'}`, entry.currency) : '\u{2014}'),
    stateLabel ? h('span', { class: 'sr-only' }, `, ${stateLabel}`) : null),
  h('span', { class: 'tile-mac' },
    h('span', { class: 'tile-mac-label' }, t('seal.tile.mac')),
    h('span', { class: 'hash', title: entry.mac }, shortHash(entry.mac)),
    copyButton(entry.mac, { what: t('seal.tile.macOf', { seq: entry.seq }) })),
  state === 'broken' ? h('span', { class: 'tile-crack', 'aria-hidden': 'true' }, crack()) : null,
  stateLabel ? h('span', { class: 'tile-state', 'aria-hidden': 'true' }, icon(state === 'verified' ? 'check' : state === 'broken' ? 'link-broken' : 'minus-circle', { size: 13 }), stateLabel) : null);
}

function ghostTile(g) {
  const label = g.from === g.to ? t('seal.tile.missing', { seq: g.from }) : t('seal.tile.missingRange', { from: g.from, to: g.to });
  return h('li', { class: 'tile is-missing' },
    h('div', { class: 'tile-ghost' }, icon('scissors', { size: 18 }), h('span', null, label)));
}

function crack() {
  return svg('svg', { viewBox: '0 0 100 120', preserveAspectRatio: 'none', class: 'crack-svg' },
    svg('path', { d: 'M58 0 L46 22 L60 38 L41 58 L55 74 L38 96 L47 120', class: 'crack-line' }),
    svg('path', { d: 'M46 22 L30 30 M41 58 L24 62 M55 74 L72 82', class: 'crack-line is-thin' }));
}

// ---------- inspector ----------
function inspectorCard(entry, state, lastTamper) {
  const changed = lastTamper && lastTamper.file !== 'ACCEPTED.DAT' && lastTamper.file !== 'REJECTED.DAT' &&
    lastTamper.after && lastTamper.after === entry.raw && lastTamper.before
    ? diffRanges(lastTamper.before, lastTamper.after) : [];
  return card({
    title: t('seal.inspect.title', { seq: entry.seq }),
    sub: t('seal.inspect.sub'),
    className: ['inspector-card', state === 'broken' && 'is-broken'].filter(Boolean).join(' '),
    actions: h('div', { class: 'row', css: { '--row-gap': '6px' } },
      chip(entry.type === 'R' ? t('seal.tile.rejected') : t('seal.tile.accepted'), { tone: entry.type === 'R' ? 'danger' : 'ok', dot: true }),
      chip(formatTimestamp(entry.timestamp, { short: true }), { icon: 'clock' })),
    body: [
      recordView(entry.raw, LEDGER_LAYOUT, {
        separator: '|',
        marks: [{ at: LEDGER_MAC_INPUT, label: t('seal.inspect.macInput') }],
        changed,
        caption: t('seal.inspect.title', { seq: entry.seq }),
      }),
      h('dl', { class: 'kv' },
        h('dt', null, 'RECORD-MAC'), h('dd', null, hashLine(entry.recordMac, 'RECORD-MAC')),
        h('dt', null, 'PREV-MAC'), h('dd', null, hashLine(entry.prev, 'PREV-MAC')),
        h('dt', null, 'MAC'), h('dd', null, hashLine(entry.mac, 'MAC'))),
    ],
  });
}
