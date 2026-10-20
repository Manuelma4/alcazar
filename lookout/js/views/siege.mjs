// Lookout · Siege: the attack lab. Every scenario in shared/lab.mjs is sent
// from this tab to the live gateway through runScenario(); the card resolves
// with the layer that contained it — or fails loudly.

import { h, mount, svg } from '../dom.mjs';
import { icon } from '../icons.mjs';
import { t } from '../strings.mjs';
import { store } from '../store.mjs';
import { launch, launchSiege, loadLab, stopSiege } from '../actions.mjs';
import { formatBytes, formatInt, formatMs, splitInvisible } from '../format.mjs';
import { LAYERS, banner, button, card, chip, cweChip, emptyState, layerName, segmented, setBusy, viewHeader } from '../ui.mjs';

const ui = { category: 'all' };
const LAYER_ORDER = ['gatehouse', 'cobol', 'fortran', 'seal'];

export function render() {
  const cleanups = [];
  const body = h('div', { class: 'stack', css: { '--stack-gap': '20px' } });
  const lead = h('p', { class: 'lead' }, t('siege.lead', { n: '\u{2026}' }));
  const header = viewHeader({ eyebrow: t('siege.eyebrow'), title: t('siege.title') });
  header.append(lead);
  const el = h('div', { class: 'view view-siege' }, header, body);

  let disposed = false;
  loadLab().then(({ SCENARIOS }) => {
    if (disposed) return;
    lead.textContent = t('siege.lead', { n: SCENARIOS.length });
    mount(body, ...build(SCENARIOS, cleanups));
  }).catch(() => {
    if (!disposed) mount(body, card({ body: emptyState({ icon: 'shield-alert', title: t('siege.loadError') }) }));
  });
  return {
    el,
    cleanup: () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    },
  };
}

function expectedText(expected) {
  const parts = [layerName(expected.layer)];
  if (expected.code) parts.push(expected.code);
  if (expected.signal) parts.push(expected.signal);
  if (expected.status) parts.push(String(expected.status));
  return parts.join(' \u{00B7} ');
}

function outcomeText(outcome) {
  return [outcome.layer ? layerName(outcome.layer) : null, outcome.code].filter(Boolean).join(' \u{00B7} ');
}

function build(scenarios, cleanups) {
  const categories = [...new Set(scenarios.map((s) => s.category))];
  const cards = new Map();
  const grid = h('div', { class: 'siege-grid' });

  // ---------- command bar ----------
  // Run state lives in the store (siegeRun), so leaving and coming back
  // mid-siege shows the same progress, Stop button and result.
  const progressBar = h('span');
  const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(scenarios.length), 'aria-valuenow': '0', 'aria-label': t('siege.progress.label') }, progressBar);
  const progressText = h('p', { class: 'small text-2' });
  const launchAll = button({ label: t('siege.launchAll'), icon: 'siege', variant: 'primary', focusKey: 'siege-all', onClick: () => launchSiege(visibleScenarios()) });
  const stop = button({ label: t('siege.stop'), icon: 'stop', variant: 'ghost', focusKey: 'siege-stop', onClick: () => stopSiege() });
  stop.hidden = true;
  const resultSlot = h('div', { class: 'siege-result-slot' });

  function visibleScenarios() {
    return ui.category === 'all' ? scenarios : scenarios.filter((s) => s.category === ui.category);
  }

  function summarize(list) {
    const results = store.get('siege');
    let contained = 0;
    let expected = 0;
    let ms = 0;
    const byLayer = Object.fromEntries(LAYER_ORDER.map((l) => [l, 0]));
    for (const s of list) {
      const r = results.get(s.id);
      if (r?.state !== 'done') continue;
      if (r.outcome.contained) contained += 1;
      if (r.outcome.asExpected) expected += 1;
      if (r.outcome.layer) byLayer[r.outcome.layer] = (byLayer[r.outcome.layer] ?? 0) + 1;
      ms += r.outcome.ms ?? 0;
    }
    return { total: list.length, contained, expected, ms, byLayer, failures: list.length - expected };
  }

  function runList(run) {
    return run?.ids ? scenarios.filter((x) => run.ids.includes(x.id)) : visibleScenarios();
  }

  function renderResult(list, run) {
    const s = summarize(list);
    const done = list.filter((x) => store.get('siege').get(x.id)?.state === 'done').length;
    if (!done) {
      mount(resultSlot);
      return;
    }
    const perfect = s.failures === 0 && done === list.length;
    mount(resultSlot, h('section', { class: ['card', 'siege-result', perfect ? 'is-perfect' : 'is-flawed'], 'aria-labelledby': 'siege-result-title' },
      waxSeal(list, s),
      h('div', { class: 'stack' },
        h('p', { class: 'eyebrow' }, t('siege.result.title')),
        h('h2', { class: 'siege-result-title', id: 'siege-result-title' }, t('siege.result.contained', { contained: s.contained, total: s.total })),
        h('p', { class: 'text-2' }, t('siege.result.expected', { n: s.expected, ms: formatMs(s.ms) })),
        run?.cancelled ? h('p', { class: 'small ink-warn' }, t('siege.result.partial', { done, total: list.length })) : null,
        s.failures && done === list.length ? h('p', { class: 'small ink-danger strong' }, t('siege.result.failures', { n: s.failures })) : null,
        h('div', { class: 'stack', css: { '--stack-gap': '6px' } },
          h('p', { class: 'section-title' }, t('siege.result.byLayer')),
          h('div', { class: 'row', css: { '--row-gap': '6px' } },
            LAYER_ORDER.map((l) => h('span', { class: ['chip', 'layer', `layer-${l}`] }, icon(LAYERS[l].icon, { size: 14 }), `${layerName(l)} ${s.byLayer[l]}`)))))));
  }

  const filter = segmented({
    name: 'siege-cat',
    legend: t('siege.filter.legend'),
    value: ui.category,
    options: [{ value: 'all', label: t('siege.cat.all'), count: scenarios.length },
      ...categories.map((c) => ({ value: c, label: t.has(`siege.cat.${c}`) ? t(`siege.cat.${c}`) : c, count: scenarios.filter((s) => s.category === c).length }))],
    onChange: (value) => {
      ui.category = value;
      for (const [id, entry] of cards) entry.el.hidden = !(value === 'all' || entry.scenario.category === value);
    },
  });

  const command = card({
    title: t('siege.command.title'),
    sub: t('siege.command.sub'),
    className: 'siege-command',
    actions: h('div', { class: 'row' }, stop, launchAll),
    body: [h('div', { class: 'stack' }, progress, progressText), h('div', { class: 'siege-filter' }, filter)],
  });

  const updateProgress = () => {
    const run = store.get('siegeRun');
    if (run?.running) {
      setBusy(launchAll, true);
      stop.hidden = false;
    } else {
      setBusy(launchAll, false);
      // Stop hides itself when the run ends: focus must not fall to <body>.
      if (stop.contains(document.activeElement)) launchAll.focus({ preventScroll: true });
      stop.hidden = true;
      if (run?.finishedAt) renderResult(runList(run), run);
    }
    const total = run?.total ?? scenarios.length;
    const doneCount = run?.done ?? 0;
    progress.setAttribute('aria-valuemax', String(total));
    progress.setAttribute('aria-valuenow', String(doneCount));
    progressBar.parentElement.style.setProperty('--value', `${total ? (doneCount / total) * 100 : 0}%`);
    if (run?.running) {
      const current = scenarios.find((s) => s.id === run.current);
      progressText.textContent = `${t('siege.progress', { done: doneCount, total })}${current ? ` \u{2014} ${current.title}` : ''}`;
    } else if (run) {
      progressText.textContent = t('siege.progress', { done: doneCount, total });
    } else {
      progressText.textContent = t('siege.result.idle');
    }
  };
  updateProgress();
  cleanups.push(store.on('siegeRun', updateProgress));

  for (const scenario of scenarios) {
    const entry = scenarioCard(scenario);
    entry.el.hidden = !(ui.category === 'all' || scenario.category === ui.category);
    cards.set(scenario.id, entry);
    grid.append(entry.el);
  }
  const onSiege = () => {
    for (const entry of cards.values()) entry.update();
  };
  onSiege();
  cleanups.push(store.on('siege', onSiege));

  return [command, resultSlot, grid];
}

function scenarioCard(scenario) {
  const ex = scenario.expected;
  const layer = LAYERS[ex.layer] ? ex.layer : 'gatehouse';
  const outcomeSlot = h('div', { class: 'siege-outcome' });
  const titleId = `siege-${scenario.id}`;
  // 29 buttons say "Launch": each is described by its attack's title.
  const launchBtn = button({ label: t('siege.card.launch'), icon: 'play', size: 'sm', focusKey: `siege-${scenario.id}`, onClick: () => launch(scenario), attrs: { 'aria-describedby': titleId } });
  // Busy, not disabled: a disabled button drops the keyboard focus it holds.
  const setLaunchable = (yes) => {
    if (yes) launchBtn.removeAttribute('aria-disabled');
    else launchBtn.setAttribute('aria-disabled', 'true');
  };
  const el = h('article', { class: ['siege-card', `layer-${layer}`], 'aria-labelledby': titleId },
    h('div', { class: 'siege-card-top' },
      h('span', { class: 'eyebrow' }, t.has(`siege.cat.${scenario.category}`) ? t(`siege.cat.${scenario.category}`) : scenario.category),
      scenario.cwe ? cweChip(scenario.cwe) : chip(t('siege.card.fraud'), { className: 'square', icon: 'observatory' })),
    h('h3', { class: 'siege-title', id: titleId }, scenario.title),
    h('p', { class: 'siege-summary' }, scenario.summary),
    h('div', { class: 'siege-expect' },
      h('span', { class: 'siege-expect-label' }, t('siege.card.expected')),
      h('span', { class: ['chip', 'layer', `layer-${layer}`] }, icon(LAYERS[layer].icon, { size: 14 }), expectedText(ex))),
    outcomeSlot,
    h('div', { class: 'siege-foot' }, launchBtn, payloadDisclosure(scenario)));

  let signature = null;
  const update = () => {
    const state = store.get('siege').get(scenario.id);
    const next = JSON.stringify([state?.state, state?.at, state?.error, state?.outcome?.layer, state?.outcome?.code, state?.outcome?.asExpected]);
    if (next === signature) return;
    signature = next;
    el.classList.remove('is-running', 'is-ok', 'is-unexpected', 'is-breach', 'is-error', 'is-queued');
    if (!state || state.state === 'idle') {
      mount(outcomeSlot);
      setLaunchable(true);
      launchBtn.querySelector('span').textContent = t('siege.card.launch');
      return;
    }
    if (state.state === 'queued' || state.state === 'running') {
      el.classList.add(state.state === 'queued' ? 'is-queued' : 'is-running');
      setLaunchable(false);
      mount(outcomeSlot, h('p', { class: 'siege-status is-busy' }, icon(state.state === 'queued' ? 'clock' : 'spinner', { size: 16 }), t(state.state === 'queued' ? 'siege.card.queued' : 'siege.card.running')));
      return;
    }
    setLaunchable(true);
    launchBtn.querySelector('span').textContent = t('siege.card.relaunch');
    if (state.state === 'error') {
      el.classList.add('is-error');
      mount(outcomeSlot, h('p', { class: 'siege-status is-error' }, icon('alert', { size: 16 }), t('siege.card.error', { error: state.error })));
      return;
    }
    const o = state.outcome;
    const meta = h('span', { class: 'siege-meta mono' }, [o.status ? t('siege.card.status', { status: o.status }) : null, formatMs(o.ms)].filter(Boolean).join(' \u{00B7} '));
    if (o.contained && o.asExpected) {
      el.classList.add('is-ok');
      mount(outcomeSlot, h('div', { class: ['siege-verdict', 'is-ok', `layer-${o.layer}`] },
        h('span', { class: 'siege-shield' }, icon('shield', { size: 22 })),
        h('span', { class: 'stack', css: { '--stack-gap': '2px' } },
          h('span', { class: 'siege-verdict-title' }, t('siege.card.contained', { layer: outcomeText(o) })),
          h('span', { class: 'siege-detail' }, detailText(o.detail), ' ', meta))));
    } else if (o.contained) {
      el.classList.add('is-unexpected');
      mount(outcomeSlot, h('div', { class: 'siege-verdict is-unexpected' },
        h('span', { class: 'siege-shield' }, icon('shield-alert', { size: 22 })),
        h('span', { class: 'stack', css: { '--stack-gap': '2px' } },
          h('span', { class: 'siege-verdict-title' }, t('siege.card.unexpected', { layer: outcomeText(o), expected: expectedText(ex) })),
          h('span', { class: 'siege-detail' }, detailText(o.detail), ' ', meta))));
    } else {
      el.classList.add('is-breach');
      mount(outcomeSlot, h('div', { class: 'siege-verdict is-breach', role: 'alert' },
        h('span', { class: 'siege-shield' }, icon('shield-x', { size: 22 })),
        h('span', { class: 'stack', css: { '--stack-gap': '2px' } },
          h('span', { class: 'siege-verdict-title' }, t('siege.card.breach')),
          h('span', { class: 'siege-detail' }, detailText(o.detail), ' ', meta))));
    }
  };
  return { el, scenario, update };
}

function detailText(detail) {
  return h('span', { dir: 'ltr' }, splitInvisible(String(detail ?? '')).map((p) => (p.escaped ? h('span', { class: 'esc' }, p.text) : p.text)));
}

// ---------- payload ----------
function requestLines(scenario, { full = false } = {}) {
  const r = scenario.request;
  if (r.kind === 'raw') {
    const headers = Object.entries(r.headers ?? {}).map(([k, v]) => `${k}: ${v}`);
    return [`${r.method} ${r.path}`, ...headers, ...(r.body !== undefined ? ['', r.body] : [])].join('\n');
  }
  const txns = r.transactions ?? [];
  let bodyText;
  if (!full && txns.length > 3) {
    const head = JSON.stringify({ transactions: txns.slice(0, 1) }, null, 2).replace(/\n\s*\]\n\}$/, '');
    bodyText = `${head},\n    ${t('siege.payload.more', { n: formatInt(txns.length - 1), first: txns[1]?.id ?? '', last: txns.at(-1)?.id ?? '' })}\n  ]\n}`;
  } else {
    bodyText = JSON.stringify({ transactions: txns }, null, 2);
  }
  const batch = ['POST /api/batch', 'content-type: application/json', '', bodyText].join('\n');
  if (r.kind !== 'tamper') return batch;
  return [
    batch,
    '',
    `# ${t('siege.payload.then')}`,
    'POST /api/jobs/{job}/tamper',
    'content-type: application/json',
    '',
    JSON.stringify({ seq: r.seq, mode: r.mode }),
    '',
    `# ${t('siege.payload.then')}`,
    'POST /api/jobs/{job}/verify',
    'content-type: application/json',
    '',
    '{}',
  ].join('\n');
}

function codeWithEscapes(text) {
  return h('pre', { class: 'codeblock', tabindex: '0' }, splitInvisible(text).map((p) => (p.escaped && p.text !== '\\n' ? h('span', { class: 'esc' }, p.text) : p.text === '\\n' ? '\n' : p.text)));
}

function payloadDisclosure(scenario) {
  const bodyHost = h('div', { class: 'stack' });
  const details = h('details', { class: 'disclosure siege-payload' },
    h('summary', null, icon('chevron-right', { size: 15, class: 'chev' }), t('siege.card.payload')),
    h('div', { class: 'disclosure-body' }, bodyHost));
  details.addEventListener('toggle', () => {
    if (!details.open || bodyHost.childElementCount) return;
    const txns = scenario.request.transactions ?? [];
    const text = requestLines(scenario);
    const children = [codeWithEscapes(text)];
    if (/\p{Cf}/u.test(JSON.stringify(scenario.request))) children.push(h('p', { class: 'hint' }, t('siege.payload.escaped')));
    if (txns.length > 3) {
      const size = new TextEncoder().encode(JSON.stringify({ transactions: txns })).length;
      const more = button({
        label: t('siege.payload.full', { size: formatBytes(size) }),
        size: 'sm',
        variant: 'ghost',
        onClick: () => {
          // The button replaces itself: focus moves to what replaced it.
          const full = codeWithEscapes(requestLines(scenario, { full: true }));
          more.replaceWith(full);
          full.focus();
        },
      });
      children.push(more);
    }
    mount(bodyHost, ...children);
  });
  return details;
}

// ---------- the wax seal ----------
function waxSeal(list, summary) {
  const size = 168;
  const c = size / 2;
  const r = 52;
  const pts = [];
  for (let i = 0; i <= 96; i += 1) {
    const a = (i / 96) * Math.PI * 2;
    const rr = r + 3.2 * Math.cos(12 * a) + 1.2 * Math.sin(5 * a);
    pts.push(`${(c + rr * Math.cos(a)).toFixed(2)} ${(c + rr * Math.sin(a)).toFixed(2)}`);
  }
  const results = store.get('siege');
  const dots = list.map((s, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    const res = results.get(s.id);
    const o = res?.outcome;
    const cls = !o ? 'is-pending' : o.asExpected ? `layer-${o.layer}` : o.contained ? 'is-unexpected' : 'is-breach';
    return svg('circle', { cx: (c + 72 * Math.cos(a)).toFixed(2), cy: (c + 72 * Math.sin(a)).toFixed(2), r: 5, class: `seal-dot ${cls}` });
  });
  const perfect = summary.failures === 0;
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: ['siege-seal', perfect ? 'is-perfect' : 'is-flawed'].join(' '), role: 'img', 'aria-label': t('siege.result.contained', { contained: summary.contained, total: summary.total }) },
    svg('circle', { cx: c, cy: c, r: 72, class: 'seal-orbit' }),
    ...dots,
    svg('path', { d: `M${pts.join('L')}Z`, class: 'seal-wax' }),
    svg('circle', { cx: c, cy: c, r: 41, class: 'seal-ring' }),
    svg('circle', { cx: c, cy: c, r: 36, class: 'seal-ring is-inner' }),
    svg('text', { x: c, y: c + 2, 'text-anchor': 'middle', class: 'seal-count' }, `${summary.contained}/${summary.total}`),
    svg('text', { x: c, y: c + 20, 'text-anchor': 'middle', class: 'seal-caption' }, perfect ? t('siege.seal.sealed') : t('siege.seal.breached')));
}
