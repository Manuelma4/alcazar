// Lookout · Transactions: load a batch (sample / paste / upload), run it, and
// read the result: KPIs, pipeline, rejection reasons, top risk, Benford,
// the amount histogram and every transfer.

import { h, mount, debounce, reducedMotion } from '../dom.mjs';
import { icon } from '../icons.mjs';
import { t } from '../strings.mjs';
import { store } from '../store.mjs';
import { fetchSample, runBatch } from '../actions.mjs';
import { parseBatchText, previewRows } from '../batch.mjs';
import { buildRows, filterRows, histogramEdgesInUnits, outliers, reasonCounts, topRisk, totals } from '../jobmodel.mjs';
import { formatCentsPlain, formatDecimal, formatInt, formatIso, formatMoney, formatPercent, formatTimestamp } from '../format.mjs';
import {
  banner, button, card, chip, copyButton, dataTable, emptyState, errorBanner, escapedText, inputField, meter, segmented, setBusy, statusLine, viewHeader,
} from '../ui.mjs';
import { jobKpis, openTransferDrawer, pipelineTimeline, rowAmount, signalChip, statusChip } from '../jobui.mjs';
import { reasonBars } from '../charts/bars.mjs';
import { benfordChart } from '../charts/benford.mjs';
import { histogramChart } from '../charts/histogram.mjs';
import { chartWithTable } from '../charts/common.mjs';

const PAGE = 25;
const MAX_FILE = 2 * 1024 * 1024;

/** View state that survives navigation (never persisted to storage). */
const ui = {
  source: 'sample',
  size: '200',
  seed: '42',
  paste: '',
  loaded: null, // { transactions, source, warnings }
  filter: 'all',
  query: '',
  page: 0,
};

export function render() {
  const cleanups = [];
  const results = h('div', { class: 'stack', css: { '--stack-gap': '20px' } });
  const el = h('div', { class: 'view view-transactions' },
    viewHeader({ eyebrow: t('tx.eyebrow'), title: t('tx.title'), lead: t('tx.lead') }),
    loaderCard(cleanups),
    results);

  const resultCleanups = [];
  const renderResults = () => {
    resultCleanups.splice(0).forEach((fn) => fn());
    const job = store.get('job');
    if (!job) {
      mount(results, card({ body: emptyState({ icon: 'coins', title: t('tx.empty.title'), body: t('tx.empty.body') }) }));
      return;
    }
    mount(results, ...resultSections(job, resultCleanups));
  };
  cleanups.push(store.on('job', renderResults));
  renderResults();
  return { el, cleanup: () => [...cleanups, ...resultCleanups].forEach((fn) => fn()) };
}

// =====================================================================
// Loader
// =====================================================================
function loaderCard(cleanups) {
  const panel = h('div', { class: 'loader-panel' });
  const loadedSlot = h('div', { class: 'stack' });
  // runBatch announces sending / done; failures arrive as an alert banner.
  const status = statusLine({ live: false });
  const errorSlot = h('div');
  const runBtn = button({ label: t('tx.run'), icon: 'play', variant: 'primary', onClick: onRun });
  const clearBtn = button({
    label: t('tx.clear'),
    icon: 'x',
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      setLoaded(null);
      // Clear hides itself: hand focus to the chosen source instead.
      panel.closest('section')?.querySelector('input[type=radio]:checked')?.focus();
    },
  });

  function setLoaded(value) {
    ui.loaded = value;
    renderLoaded();
  }

  function sourceLabel(source) {
    if (!source) return '';
    if (source.kind === 'sample') return t('tx.source.label.sample', { seed: source.seed });
    if (source.kind === 'file') return t('tx.source.label.file', { name: source.name });
    return t('tx.source.label.paste');
  }

  function renderLoaded() {
    const loaded = ui.loaded;
    runBtn.disabled = !loaded || store.get('batchBusy');
    clearBtn.hidden = !loaded;
    if (!loaded) {
      mount(loadedSlot, h('p', { class: 'muted small' }, t('tx.loaded.none')));
      return;
    }
    const n = loaded.transactions.length;
    const rows = previewRows(loaded.transactions, 5);
    mount(loadedSlot,
      h('p', { class: 'loaded-line' }, icon('check-circle', { size: 16 }), t('tx.loaded', { n: formatInt(n), source: sourceLabel(loaded.source) })),
      loaded.warnings.map((w) => banner({ tone: 'warn', icon: 'alert', title: t(`tx.warn.${w}`) })),
      h('details', { class: 'disclosure' },
        h('summary', null, icon('chevron-right', { size: 15, class: 'chev' }), t('tx.preview.title')),
        h('div', { class: 'disclosure-body' },
          dataTable({
            caption: t('tx.preview.title'),
            columns: [
              { key: 'line', label: t('col.line'), num: true },
              { key: 'id', label: t('col.id'), render: (r) => escapedText(r.id, { className: 'mono' }) },
              { key: 'timestamp', label: t('col.time'), render: (r) => h('span', { class: 'mono' }, formatTimestamp(r.timestamp, { short: true })) },
              { key: 'from', label: t('col.from'), render: (r) => h('span', { class: 'mono small' }, r.from) },
              { key: 'to', label: t('col.to'), render: (r) => h('span', { class: 'mono small' }, r.to) },
              { key: 'amount', label: t('col.amount'), num: true, render: (r) => escapedText(`${r.amount} ${r.currency}`, { className: 'mono' }) },
              { key: 'channel', label: t('col.channel'), render: (r) => escapedText(r.channel, { className: 'mono' }) },
              { key: 'card', label: t('col.card'), render: (r) => h('span', { class: 'mono small' }, r.card || '\u{2014}') },
            ],
            rows,
            stack: true,
          }),
          n > rows.length ? h('p', { class: 'muted small', css: { 'margin-top': '8px' } }, t('tx.preview.more', { n: formatInt(n - rows.length) })) : null)));
  }

  async function onRun() {
    if (!ui.loaded || store.get('batchBusy')) return;
    setBusy(runBtn, true, t('tx.run.busy'));
    mount(errorSlot);
    status.set('busy', t('batch.sending', { n: formatInt(ui.loaded.transactions.length) }));
    const job = await runBatch(ui.loaded.transactions, ui.loaded.source);
    setBusy(runBtn, false);
    if (job) {
      status.set('ok', t('batch.done', {
        accepted: formatInt(job.summary.accepted),
        rejected: formatInt(job.summary.rejected),
        flagged: formatInt(job.summary.flagged),
        verdict: job.ledger.verification.valid ? t('batch.sealOk') : t('batch.sealBad'),
      }));
      ui.page = 0;
      // The results are below: move focus there, not just the page.
      const results = document.getElementById('tx-results-title');
      if (results) {
        if (!results.hasAttribute('tabindex')) results.setAttribute('tabindex', '-1');
        results.focus({ preventScroll: true });
        results.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    } else {
      status.set('error', t('batch.failed', { code: store.get('batchError')?.code ?? '' }));
      const error = store.get('batchError');
      if (error) mount(errorSlot, errorBanner(error));
    }
    runBtn.disabled = !ui.loaded;
  }

  // ----- sample -----
  function samplePanel() {
    const size = inputField({ label: t('tx.sample.size'), value: ui.size, type: 'number', mono: true, hint: t('tx.sample.sizeHint'), attrs: { min: 1, max: 1000, step: 1, inputmode: 'numeric' }, onInput: (v) => { ui.size = v; } });
    const seed = inputField({ label: t('tx.sample.seed'), value: ui.seed, type: 'number', mono: true, hint: t('tx.sample.seedHint'), attrs: { min: 0, step: 1, inputmode: 'numeric' }, onInput: (v) => { ui.seed = v; } });
    const go = button({ label: t('tx.sample.generate'), icon: 'refresh', onClick: generate });
    const sampleStatus = statusLine();
    async function generate() {
      const n = Number(ui.size);
      const s = Number(ui.seed);
      const valid = Number.isInteger(n) && n >= 1 && n <= 1000 && Number.isInteger(s) && s >= 0 && s <= 2147483647;
      size.input.setAttribute('aria-invalid', String(!(Number.isInteger(n) && n >= 1 && n <= 1000)));
      seed.input.setAttribute('aria-invalid', String(!(Number.isInteger(s) && s >= 0)));
      if (!valid) {
        sampleStatus.set('error', t('tx.sample.invalid'));
        return;
      }
      setBusy(go, true, t('tx.sample.busy'));
      try {
        const sample = await fetchSample(n, s);
        setLoaded({ transactions: sample.transactions, source: { kind: 'sample', seed: sample.seed, size: n }, warnings: [] });
        sampleStatus.set('ok', t('tx.loaded', { n: formatInt(sample.transactions.length), source: t('tx.source.label.sample', { seed: sample.seed }) }));
      } catch (error) {
        sampleStatus.set('error', t('batch.failed', { code: error.code ?? '' }));
        mount(errorSlot, errorBanner(error));
      } finally {
        setBusy(go, false);
      }
    }
    return h('div', { class: 'stack' },
      h('div', { class: 'loader-row' }, size.el, seed.el, h('div', { class: 'field field-action' }, go)),
      sampleStatus.el);
  }

  // ----- paste -----
  function pastePanel() {
    const textareaId = 'tx-paste';
    const parseStatus = statusLine();
    const area = h('textarea', {
      id: textareaId,
      class: 'textarea mono',
      rows: 9,
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      'aria-describedby': 'tx-paste-hint',
      placeholder: '{ "transactions": [ { "id": "TX-1", "timestamp": "20251020101500", "from": "FR76…", "to": "DE89…", "amount": "125.00", "currency": "EUR", "channel": "WEB", "memo": "Invoice" } ] }',
      props: { value: ui.paste },
      on: { input: (e) => { ui.paste = e.target.value; } },
    });
    const load = button({
      label: t('tx.paste.load'),
      icon: 'check',
      onClick: () => {
        const parsed = parseBatchText(ui.paste);
        if (!parsed.ok) {
          area.setAttribute('aria-invalid', 'true');
          parseStatus.set('error', t(`tx.parse.${parsed.error}`, { detail: parsed.detail ?? '' }));
          return;
        }
        area.removeAttribute('aria-invalid');
        parseStatus.set('ok', t('tx.loaded', { n: formatInt(parsed.transactions.length), source: t('tx.source.label.paste') }));
        setLoaded({ transactions: parsed.transactions, source: { kind: 'paste' }, warnings: parsed.warnings });
      },
    });
    return h('div', { class: 'stack' },
      h('div', { class: 'field' },
        h('label', { class: 'label', for: textareaId }, t('tx.paste.label')),
        area,
        h('p', { class: 'hint', id: 'tx-paste-hint' }, t('tx.paste.hint'))),
      h('div', { class: 'row' }, load),
      parseStatus.el);
  }

  // ----- file -----
  function filePanel() {
    const fileStatus = statusLine();
    const input = h('input', {
      type: 'file',
      id: 'tx-file',
      class: 'sr-only',
      accept: '.json,application/json',
      on: {
        change: (e) => {
          readFile(e.target.files?.[0]);
          e.target.value = '';
        },
      },
    });
    async function readFile(file) {
      if (!file) return;
      if (file.size > MAX_FILE) {
        fileStatus.set('error', t('tx.file.tooBig'));
        return;
      }
      let text;
      try {
        text = await file.text();
      } catch {
        fileStatus.set('error', t('tx.file.unreadable'));
        return;
      }
      const parsed = parseBatchText(text);
      if (!parsed.ok) {
        fileStatus.set('error', t(`tx.parse.${parsed.error}`, { detail: parsed.detail ?? '' }));
        return;
      }
      const name = file.name.replace(/[^\w.-]+/g, '_').slice(0, 60);
      fileStatus.set('ok', t('tx.file.read', { name }));
      setLoaded({ transactions: parsed.transactions, source: { kind: 'file', name }, warnings: parsed.warnings });
    }
    const zone = h('div', {
      class: 'dropzone',
      on: {
        dragover: (e) => { e.preventDefault(); zone.classList.add('is-over'); },
        dragleave: () => zone.classList.remove('is-over'),
        drop: (e) => {
          e.preventDefault();
          zone.classList.remove('is-over');
          readFile(e.dataTransfer?.files?.[0]);
        },
      },
    },
    icon('upload', { size: 26 }),
    h('p', { class: 'strong' }, t('tx.file.drop')),
    h('p', { class: 'muted small' }, t('tx.file.or')),
    h('label', { class: 'btn btn-sm', for: 'tx-file' }, icon('file', { size: 16 }), h('span', null, t('tx.file.choose'))),
    input,
    h('p', { class: 'hint' }, t('tx.file.hint')));
    return h('div', { class: 'stack' }, zone, fileStatus.el);
  }

  const panels = { sample: samplePanel, paste: pastePanel, file: filePanel };
  const showPanel = (key) => {
    ui.source = key;
    mount(panel, panels[key]());
  };
  const tabs = segmented({
    name: 'source',
    legend: t('tx.source.legend'),
    value: ui.source,
    options: [
      { value: 'sample', label: t('tx.source.sample'), icon: 'refresh' },
      { value: 'paste', label: t('tx.source.paste'), icon: 'file' },
      { value: 'file', label: t('tx.source.file'), icon: 'upload' },
    ],
    onChange: showPanel,
  });
  showPanel(ui.source);
  renderLoaded();
  const syncBusy = (busy) => {
    if (busy) setBusy(runBtn, true, t('tx.run.busy'));
    else {
      setBusy(runBtn, false);
      runBtn.disabled = !ui.loaded;
    }
  };
  if (store.get('batchBusy')) syncBusy(true);
  cleanups.push(store.on('batchBusy', syncBusy));

  return card({
    title: t('tx.load.title'),
    sub: t('tx.load.sub'),
    className: 'loader-card',
    body: [
      tabs,
      h('div', { class: 'loader-body' }, panel),
      h('div', { class: 'loader-foot' },
        loadedSlot,
        h('div', { class: 'row' }, runBtn, clearBtn),
        status.el,
        errorSlot),
    ],
  });
}

// =====================================================================
// Results
// =====================================================================
function resultSections(job, cleanups) {
  const sections = [];
  const totalsList = totals(job);
  sections.push(h('section', { class: 'card result-head', 'aria-labelledby': 'tx-results-title' },
    h('div', { class: 'card-head' },
      h('div', { class: 'grow' },
        h('p', { class: 'eyebrow' }, t('tx.result.eyebrow')),
        h('h2', { class: 'card-title hash-line', id: 'tx-results-title' },
          h('span', { class: 'mono job-id' }, job.job),
          copyButton(job.job, { what: t('seal.job') })),
        h('p', { class: 'card-sub' }, t('tx.result.sub', { created: formatIso(job.createdAt), expires: formatIso(job.expiresAt) }))),
      h('div', { class: 'totals' },
        h('p', { class: 'eyebrow' }, t('tx.totals.title')),
        h('div', { class: 'row', css: { '--row-gap': '6px' } },
          totalsList.length ? totalsList.map(([ccy, cents]) => h('span', { class: 'total-chip' }, h('span', { class: 'total-ccy' }, ccy), h('span', { class: 'total-amt' }, formatMoney(cents, ccy)))) : h('span', { class: 'muted small' }, '\u{2014}')))),
    pipelineTimeline(job)));

  sections.push(jobKpis(job));

  // ----- rejection reasons -----
  const reasons = reasonCounts(job);
  let reasonsBody;
  let reasonsActions = null;
  if (!reasons.length) {
    reasonsBody = emptyState({ icon: 'check-circle', title: t('tx.reasons.none') });
  } else {
    const chart = reasonBars(reasons, { label: t('tx.reasons.title'), total: job.summary.rejected });
    cleanups.push(chart.destroy);
    const table = dataTable({
      caption: t('tx.reasons.title'),
      columns: [
        { key: 'code', label: t('col.code'), render: (r) => h('span', { class: 'mono strong' }, r.code) },
        { key: 'field', label: t('col.field'), render: (r) => h('span', { class: 'mono small' }, r.field) },
        { key: 'message', label: t('col.reason') },
        { key: 'count', label: t('col.count'), num: true, render: (r) => formatInt(r.count) },
      ],
      rows: reasons,
    });
    const chartHost = h('div', null, chart.el);
    const { toggle, tableHost } = chartWithTable({ chartHost, table, showTableLabel: t('chart.showTable'), showChartLabel: t('chart.showChart') });
    reasonsActions = toggle;
    reasonsBody = [
      h('p', { class: 'chart-summary' }, t('tx.reasons.summary', { n: formatInt(job.summary.rejected), codes: reasons.length, top: `${reasons[0].code} (${reasons[0].count})` })),
      chartHost,
      tableHost,
    ];
  }

  // ----- top risk -----
  const risky = topRisk(job, 10);
  const openRisk = (r) => {
    const row = buildRows(job, store.get('jobInput')).find((x) => x.id === r.risk.id && x.accepted);
    if (row) openTransferDrawer(row, job);
  };
  const riskBody = risky.length
    ? dataTable({
      caption: t('tx.risk.title'),
      columns: [
        {
          key: 'id',
          label: t('col.id'),
          render: (r) => h('button', {
            type: 'button',
            class: 'link-button mono strong nowrap',
            'aria-label': t('tx.details', { id: r.risk.id }),
            on: { click: () => openRisk(r) },
          }, r.risk.id),
        },
        { key: 'score', label: t('col.score'), render: (r) => h('span', { class: 'score-cell' }, h('span', { class: 'mono strong' }, formatInt(r.risk.score)), meter(r.risk.score / 100, { color: 'var(--fortran)' })) },
        { key: 'signals', label: t('col.signals'), render: (r) => h('span', { class: 'row', css: { '--row-gap': '4px' } }, r.risk.signals.map(signalChip)) },
        { key: 'z', label: t('col.z'), num: true, render: (r) => (r.risk.z === null ? '\u{2014}' : formatDecimal(r.risk.z, 1)) },
        { key: 'amount', label: t('col.amount'), num: true, render: (r) => (r.accepted ? h('span', { class: 'nowrap' }, formatMoney(r.accepted.amountCents, r.accepted.currency)) : '\u{2014}') },
      ],
      rows: risky,
      stack: true,
      onRowClick: openRisk,
    })
    : emptyState({ icon: 'observatory', title: t('tx.risk.none') });

  sections.push(h('div', { class: 'grid grid-2' },
    card({ title: t('tx.reasons.title'), sub: t('tx.reasons.sub'), actions: reasonsActions, className: 'layer-cobol chart-card', body: reasonsBody }),
    card({ title: t('tx.risk.title'), sub: t('tx.risk.sub'), className: 'layer-fortran', body: riskBody })));

  // ----- Benford -----
  const b = job.risk.benford;
  const benford = benfordChart(b, { label: t('tx.benford.title') });
  cleanups.push(benford.destroy);
  const benfordTable = dataTable({
    caption: t('tx.benford.title'),
    columns: [
      { key: 'd', label: t('col.digit'), num: true },
      { key: 'count', label: t('col.count'), num: true, render: (r) => formatInt(r.count) },
      { key: 'obs', label: t('col.observed'), num: true, render: (r) => formatPercent(r.obs) },
      { key: 'exp', label: t('col.expected'), num: true, render: (r) => formatPercent(r.exp) },
    ],
    rows: b.observed.map((obs, i) => ({ d: i + 1, count: b.counts[i], obs, exp: b.expected[i] })),
  });
  const benfordHost = h('div', null, benford.el);
  const bToggle = chartWithTable({ chartHost: benfordHost, table: benfordTable, showTableLabel: t('chart.showTable'), showChartLabel: t('chart.showChart') });
  const verdictTone = { close: 'ok', acceptable: 'ok', marginal: 'warn', nonconforming: 'danger', insufficient: 'muted' }[b.verdict];
  const benfordStats = h('dl', { class: 'stat-grid' },
    h('div', null, h('dt', null, t('tx.benford.chi2')), h('dd', { class: 'mono' }, formatDecimal(b.chi2, 2))),
    h('div', null, h('dt', null, t('tx.benford.p')), h('dd', { class: 'mono' }, formatDecimal(b.pValue, 3))),
    h('div', null, h('dt', null, t('tx.benford.mad')), h('dd', { class: 'mono' }, formatDecimal(b.mad, 4))),
    h('div', null, h('dt', null, t('tx.benford.decidedBy')), h('dd', null, chip(b.verdictBasis === 'none' ? '\u{2014}' : b.verdictBasis === 'chi2' ? 'chi\u{00B2}' : 'MAD', { mono: true, tone: 'gold' }))));

  // ----- histogram -----
  const edges = histogramEdgesInUnits(job.risk.amounts);
  const outs = outliers(job);
  const medianUnits = job.risk.amounts.medianCents > 0 ? job.risk.amounts.medianCents / 100 : null;
  const hist = histogramChart({
    edges,
    counts: job.risk.amounts.histogram.counts,
    medianLog: medianUnits ? Math.log10(medianUnits) : null,
    outliers: outs,
  }, { label: t('tx.hist.title') });
  cleanups.push(hist.destroy);
  const histTable = dataTable({
    caption: t('tx.hist.title'),
    columns: [
      { key: 'range', label: t('col.range'), render: (r) => h('span', { class: 'mono' }, `${formatDecimal(10 ** r.lo, 2)} \u{2013} ${formatDecimal(10 ** r.hi, 2)}`) },
      { key: 'count', label: t('col.count'), num: true, render: (r) => formatInt(r.count) },
    ],
    rows: hist.bins.filter((x) => x.count > 0),
  });
  const histHost = h('div', null, hist.el);
  const hToggle = chartWithTable({ chartHost: histHost, table: histTable, showTableLabel: t('chart.showTable'), showChartLabel: t('chart.showChart') });
  const a = job.risk.amounts;
  const anyCcy = job.accepted[0]?.currency ?? '';
  const mixed = new Set(job.accepted.map((x) => x.currency)).size > 1;
  const money = (cents) => (mixed ? formatCentsPlain(cents) : formatMoney(String(Math.round(cents)), anyCcy));

  sections.push(h('div', { class: 'grid grid-2' },
    card({
      title: t('tx.benford.title'),
      sub: t('tx.benford.sub'),
      actions: bToggle.toggle,
      className: 'layer-fortran chart-card',
      body: [
        h('div', { class: 'row verdict-row' },
          chip(t(`verdict.${b.verdict}`), { tone: verdictTone, dot: true }),
          h('span', { class: 'small text-2' }, t(`verdict.explain.${b.verdictBasis}`))),
        h('p', { class: 'chart-summary' }, t('tx.benford.summary', { n: formatInt(b.n), verdict: t(`verdict.${b.verdict}`).toLowerCase(), obs1: formatPercent(b.observed[0]), exp1: formatPercent(b.expected[0]) })),
        benfordHost,
        bToggle.tableHost,
        benfordStats,
      ],
    }),
    card({
      title: t('tx.hist.title'),
      sub: t('tx.hist.sub'),
      actions: hToggle.toggle,
      className: 'layer-fortran chart-card',
      body: [
        h('p', { class: 'chart-summary' }, t('tx.hist.summary', {
          n: formatInt(job.risk.n), min: money(a.minCents), max: money(a.maxCents), median: money(a.medianCents), outliers: formatInt(outs.length),
        })),
        histHost,
        hToggle.tableHost,
      ],
    })));

  // ----- every transfer -----
  sections.push(transferTable(job));
  return sections;
}

function transferTable(job) {
  const rows = buildRows(job, store.get('jobInput'));
  const counts = {
    all: rows.length,
    accepted: rows.filter((r) => r.status !== 'rejected').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    flagged: rows.filter((r) => r.status === 'flagged').length,
  };
  const tableSlot = h('div');
  const pagerSlot = h('div', { class: 'pager' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  const columns = [
    { key: 'line', label: t('col.line'), num: true, render: (r) => h('span', { class: 'mono muted' }, String(r.line)) },
    {
      key: 'id',
      label: t('col.id'),
      render: (r) => h('span', { class: 'stack', css: { '--stack-gap': '2px' } },
        h('button', { type: 'button', class: 'link-button mono strong nowrap', 'aria-label': t('tx.details', { id: r.id }), on: { click: () => openTransferDrawer(r, job) } }, escapedText(r.id || '\u{2014}')),
        memoOf(r) ? h('span', { class: 'cell-sub' }, escapedText(memoOf(r))) : null),
    },
    { key: 'time', label: t('col.time'), render: (r) => h('span', { class: ['mono small', !r.accepted && 'muted'] }, timeOf(r)) },
    {
      key: 'route',
      label: `${t('col.from')} \u{2192} ${t('col.to')}`,
      render: (r) => h('span', { class: ['route mono', !r.accepted && 'muted'] },
        h('span', null, r.accepted?.fromMasked ?? r.input?.from ?? '\u{2014}'),
        h('span', { class: 'route-arrow', 'aria-hidden': 'true' }, '\u{2192}'),
        h('span', null, r.accepted?.toMasked ?? r.input?.to ?? '\u{2014}')),
    },
    { key: 'amount', label: t('col.amount'), num: true, render: (r) => h('span', { class: ['nowrap', r.accepted ? 'strong' : 'muted mono small'] }, r.accepted ? rowAmount(r) : escapedText(rowAmount(r))) },
    { key: 'channel', label: t('col.channel'), render: (r) => h('span', { class: 'mono small' }, r.accepted?.channel ?? r.input?.channel ?? '\u{2014}') },
    { key: 'status', label: t('col.status'), render: (r) => h('span', { class: 'row', css: { '--row-gap': '4px' } }, statusChip(r), r.risk?.signals.map(signalChip)) },
  ];

  // Page buttons are re-created on every page: keep focus on the one used,
  // or on the other one when the used one becomes disabled.
  const turn = (delta, key) => {
    ui.page += delta;
    draw();
    const target = pagerSlot.querySelector(`[data-focus-key="${key}"]`);
    const other = pagerSlot.querySelector(`[data-focus-key="${key === 'tx-next' ? 'tx-prev' : 'tx-next'}"]`);
    (target && !target.disabled ? target : other)?.focus({ preventScroll: true });
  };
  const draw = () => {
    const filtered = filterRows(rows, { filter: ui.filter, query: ui.query });
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
    ui.page = Math.min(ui.page, pages - 1);
    const slice = filtered.slice(ui.page * PAGE, ui.page * PAGE + PAGE);
    mount(tableSlot, slice.length
      ? dataTable({
        caption: t('tx.table.title'),
        columns,
        rows: slice,
        stack: true,
        rowClass: (r) => (r.status === 'rejected' ? 'row-rejected' : r.status === 'flagged' ? 'row-flagged' : null),
      })
      : emptyState({ icon: 'search', title: t('tx.table.empty') }));
    const from = filtered.length ? ui.page * PAGE + 1 : 0;
    const to = Math.min(filtered.length, (ui.page + 1) * PAGE);
    mount(pagerSlot,
      h('span', null, t('tx.pager', { from: formatInt(from), to: formatInt(to), total: formatInt(filtered.length) })),
      h('span', { class: 'row', css: { '--row-gap': '6px' } },
        button({ label: '', icon: 'chevron-left', size: 'sm', focusKey: 'tx-prev', attrs: { 'aria-label': t('tx.prev') }, disabled: ui.page === 0, onClick: () => turn(-1, 'tx-prev') }),
        h('span', { class: 'mono small' }, `${ui.page + 1} / ${pages}`),
        button({ label: '', icon: 'chevron-right', size: 'sm', focusKey: 'tx-next', attrs: { 'aria-label': t('tx.next') }, disabled: ui.page >= pages - 1, onClick: () => turn(1, 'tx-next') })));
    live.textContent = t('tx.pager', { from: formatInt(from), to: formatInt(to), total: formatInt(filtered.length) });
  };

  const searchId = 'tx-search';
  const search = h('label', { class: 'search', for: searchId },
    h('span', { class: 'sr-only' }, t('tx.search.label')),
    icon('search', { size: 16 }),
    h('input', {
      id: searchId,
      class: 'input',
      type: 'search',
      placeholder: t('tx.search.placeholder'),
      autocomplete: 'off',
      spellcheck: 'false',
      props: { value: ui.query },
      on: { input: debounce((e) => { ui.query = e.target.value; ui.page = 0; draw(); }, 120) },
    }));

  const filters = segmented({
    name: 'tx-filter',
    legend: t('tx.filter.legend'),
    value: ui.filter,
    options: ['all', 'accepted', 'rejected', 'flagged'].map((key) => ({ value: key, label: t(`tx.filter.${key}`), count: formatInt(counts[key]) })),
    onChange: (value) => {
      ui.filter = value;
      ui.page = 0;
      draw();
    },
  });

  draw();
  return card({
    title: t('tx.table.title'),
    sub: t('tx.table.sub'),
    className: 'table-card',
    body: [h('div', { class: 'table-tools' }, filters, search), tableSlot, pagerSlot, live],
  });
}

function memoOf(row) {
  return row.accepted?.memo || row.input?.memo || '';
}

function timeOf(row) {
  const ts = row.accepted?.timestamp ?? row.input?.timestamp ?? '';
  return ts ? formatTimestamp(ts, { short: true }) : '\u{2014}';
}
