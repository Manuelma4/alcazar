// Lookout · Watchtower: static analysis for COBOL and Fortran, entirely in
// the browser (the scanner module is imported from /watchtower/src/ — the
// source being scanned never leaves the tab), plus the repository self-scan
// that Gatehouse runs at start-up.

import { h, mount, debounce, reducedMotion } from '../dom.mjs';
import { icon } from '../icons.mjs';
import { t } from '../strings.mjs';
import { store } from '../store.mjs';
import { loadExamples, loadReport } from '../actions.mjs';
import { createEditor } from '../editor.mjs';
import { BUILTIN_SAMPLES } from '../samples.mjs';
import { SEVERITIES, normalizeFileResult } from '../api.mjs';
import { formatInt, formatIso, formatMs, hasInvisible, splitInvisible } from '../format.mjs';
import {
  banner, button, card, chip, cweChip, dataTable, disclosure, emptyState, errorBanner, inputField, openDrawer, preserveFocus, selectField, sevChip, viewHeader,
} from '../ui.mjs';
import { toast } from '../live.mjs';

let scannerPromise = null;
let docsBase = null;
/** The Watchtower module, loaded on demand; null when it is not installed. */
function loadScanner() {
  scannerPromise ??= import('/watchtower/src/index.mjs').then(async (mod) => {
    try {
      const version = await import('/watchtower/src/version.mjs');
      docsBase = typeof version.DOCS_BASE_URI === 'string' && version.DOCS_BASE_URI.startsWith('https://') ? version.DOCS_BASE_URI : null;
    } catch {
      docsBase = null;
    }
    return mod;
  }).catch(() => {
    scannerPromise = null;
    return null;
  });
  return scannerPromise;
}

const DEFAULT_SOURCE = BUILTIN_SAMPLES[0];
const ui = {
  source: DEFAULT_SOURCE.source,
  filename: DEFAULT_SOURCE.name,
  language: 'auto',
  format: 'auto',
  sample: DEFAULT_SOURCE.path,
  reveal: false,
  ruleQuery: '',
};

export function render() {
  const cleanups = [];
  const reportSlot = h('div');
  const scannerSlot = h('div');
  const rulesSlot = h('div');
  const el = h('div', { class: 'view view-watchtower' },
    viewHeader({ eyebrow: t('wt.eyebrow'), title: t('wt.title'), lead: t('wt.lead') }),
    reportSlot, scannerSlot, rulesSlot);

  const drawReport = () => mount(reportSlot, reportCard());
  cleanups.push(store.on(['report', 'reportError'], drawReport));
  drawReport();
  if (!store.get('report') && !store.get('reportError')) loadReport();

  let disposed = false;
  cleanups.push(() => { disposed = true; });
  loadScanner().then((scanner) => {
    if (disposed) return;
    if (!scanner) {
      mount(scannerSlot, banner({ tone: 'warn', icon: 'watchtower', title: t('wt.unavailable.title'), body: t('wt.unavailable.body') }));
      return;
    }
    const workspace = scannerCard(scanner, cleanups);
    mount(scannerSlot, workspace);
    mount(rulesSlot, rulesCard(scanner));
  });
  return { el, cleanup: () => cleanups.forEach((fn) => fn()) };
}

// =====================================================================
// Repository report
// =====================================================================
function countBySeverity(results) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  let findings = 0;
  let suppressed = 0;
  for (const r of results) {
    for (const f of r.findings) {
      counts[f.severity] += 1;
      findings += 1;
    }
    suppressed += r.suppressed.length;
  }
  return { counts, findings, suppressed, files: results.length };
}

function severityBar(counts, total) {
  if (!total) return h('div', { class: 'sev-bar is-empty', 'aria-hidden': 'true' });
  return h('div', { class: 'sev-bar', 'aria-hidden': 'true' },
    SEVERITIES.filter((s) => counts[s] > 0).map((s) => h('span', { class: `sev-seg sev-${s}`, css: { '--share': String(counts[s] / total) } })));
}

function reportCard() {
  const report = store.get('report');
  const error = store.get('reportError');
  if (error) return errorBanner(error, { title: t('wt.report.unavailable') });
  if (!report) return card({ title: t('wt.report.title'), body: h('p', { class: 'status-line is-busy' }, icon('spinner', { size: 16 }), t('health.checking')) });
  const groups = ['production', 'vulnerable', 'hardened'].map((name) => report.groups.find((g) => g.name === name) ?? { name, results: [] });
  return card({
    title: t('wt.report.title'),
    sub: t('wt.report.sub', { version: report.tool.version || '\u{2014}', date: formatIso(report.generatedAt) }),
    className: 'layer-watchtower report-card',
    body: h('div', { class: 'report-groups' }, groups.map(groupPanel)),
  });
}

function groupPanel(group) {
  const c = countBySeverity(group.results);
  const serious = c.counts.critical + c.counts.high;
  const clean = c.findings === 0;
  const tone = group.name === 'vulnerable' ? (c.findings ? 'is-hot' : '') : serious === 0 ? 'is-clean' : 'is-hot';
  const files = group.results.length
    ? disclosure({
      summary: t('wt.group.showFiles'),
      body: h('ul', { class: 'file-list' }, group.results.map((r) => {
        const fc = countBySeverity([r]);
        const example = group.name !== 'production';
        return h('li', null,
          example
            ? h('button', { type: 'button', class: 'link-button mono small', title: t('wt.group.open', { file: r.file }), on: { click: () => openExample(r.file) } }, r.file)
            : h('span', { class: 'mono small' }, r.file),
          h('span', { class: 'row file-counts', css: { '--row-gap': '4px' } },
            fc.findings ? SEVERITIES.filter((s) => fc.counts[s]).map((s) => sevChip(s, `${fc.counts[s]}`)) : chip(t('wt.group.clean'), { tone: 'ok', className: 'square' })));
      })),
    })
    : null;
  return h('section', { class: ['report-group', tone, `group-${group.name}`], 'aria-label': t(`wt.group.${group.name}`) },
    h('div', { class: 'report-group-head' },
      h('span', { class: 'report-group-icon' }, icon(group.name === 'production' ? 'rampart' : group.name === 'vulnerable' ? 'alert' : 'shield', { size: 20 })),
      h('div', null,
        h('h3', { class: 'report-group-name' }, t(`wt.group.${group.name}`)),
        h('p', { class: 'tiny muted' }, t(`wt.group.${group.name}.desc`)))),
    group.results.length
      ? [
        h('p', { class: 'report-headline' }, t('wt.group.headline', { critical: c.counts.critical, high: c.counts.high })),
        h('p', { class: 'small text-2' },
          `${t('wt.group.files', { n: c.files })} \u{00B7} ${clean ? t('wt.group.clean') : t('wt.group.findings', { n: c.findings })}`,
          c.suppressed ? ` \u{00B7} ${t('wt.findings.suppressed', { n: c.suppressed })}` : ''),
        severityBar(c.counts, c.findings),
        h('div', { class: 'row sev-row', css: { '--row-gap': '4px' } },
          SEVERITIES.map((s) => (c.counts[s] ? sevChip(s, `${c.counts[s]} ${t(`severity.${s}`)}`) : null))),
        files,
      ]
      : h('p', { class: 'small muted' }, t('wt.group.empty')));
}

let openExampleHook = null;
function openExample(path) {
  openExampleHook?.(path);
}

// =====================================================================
// Scanner workspace
// =====================================================================
function scannerCard(scanner, cleanups) {
  const findingsSlot = h('div', { class: 'findings' });
  const metaLine = h('p', { class: 'scan-meta mono' });
  const invisibleSlot = h('div');
  const revealSlot = h('div', { class: 'reveal', hidden: true });
  let last = null;

  const editor = createEditor({
    value: ui.source,
    label: t('wt.editor.label'),
    describedBy: 'wt-meta',
    onInput: debounce((value) => {
      ui.source = value;
      runScan();
    }, 220),
  });
  metaLine.id = 'wt-meta';

  function languageOption() {
    return ui.language === 'auto' ? undefined : ui.language;
  }

  function runScan() {
    const started = performance.now();
    let result;
    try {
      result = scanner.scan(ui.source, { filename: ui.filename || 'input', language: languageOption(), format: ui.format === 'auto' ? undefined : ui.format });
    } catch (error) {
      metaLine.textContent = t('wt.scanError', { error: String(error?.message ?? error) });
      return;
    }
    const ms = performance.now() - started;
    last = { ...normalizeFileResult({ ...result, file: ui.filename || 'input' }), raw: result };
    const mode = last.format === 'fixed' ? (last.language === 'fortran' ? 'fortran-fixed' : 'cobol-fixed') : 'free';
    editor.setMode(mode);
    editor.setFindings(last.findings);
    metaLine.textContent = t('wt.scanned', {
      ms: ms < 1 ? '<1 ms' : formatMs(ms),
      language: t(`wt.lang.${['cobol', 'fortran'].includes(last.language) ? last.language : 'unknown'}`),
      format: last.format ? t(`wt.format.${last.format}`) : '\u{2014}',
    });
    renderInvisible();
    renderFindings();
    if (ui.reveal) renderReveal();
  }

  function renderInvisible() {
    const count = [...ui.source].filter((ch) => hasInvisible(ch) && ch !== '\n' && ch !== '\r' && ch !== '\t').length;
    if (!count) {
      mount(invisibleSlot);
      if (ui.reveal) toggleReveal(false);
      return;
    }
    preserveFocus(invisibleSlot, () => mount(invisibleSlot, banner({
      tone: 'danger',
      icon: 'eye',
      title: t('wt.invisible.title', { n: count }),
      body: t('wt.invisible.body'),
      actions: button({ label: ui.reveal ? t('wt.reveal.hide') : t('wt.reveal'), icon: 'eye', size: 'sm', focusKey: 'wt-reveal', onClick: () => toggleReveal(!ui.reveal) }),
    })));
  }

  function toggleReveal(on) {
    ui.reveal = on;
    revealSlot.hidden = !on;
    editor.el.hidden = on;
    if (on) renderReveal();
    renderInvisible();
  }

  function renderReveal() {
    const lines = ui.source.split('\n');
    mount(revealSlot, h('pre', { class: 'reveal-code', tabindex: '0', 'aria-label': t('wt.reveal.label') },
      lines.map((line, i) => h('span', { class: 'reveal-line' },
        h('span', { class: 'reveal-no', 'aria-hidden': 'true' }, String(i + 1).padStart(3, ' ')),
        splitInvisible(line).map((p) => (p.escaped ? h('span', { class: 'esc' }, p.text) : p.text)),
        '\n'))));
  }

  function renderFindings() {
    const r = last;
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
    r.findings.forEach((f) => { counts[f.severity] += 1; });
    const order = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.line - b.line || a.column - b.column;
    const sorted = [...r.findings].sort(order);
    mount(findingsSlot,
      h('div', { class: 'findings-head' },
        h('h3', { class: 'card-title' }, t('wt.findings.title'), ' ', h('span', { class: 'muted' }, `(${r.findings.length})`)),
        h('div', { class: 'row', css: { '--row-gap': '4px' }, role: 'group', 'aria-label': t('wt.findings.summary') },
          SEVERITIES.map((s) => sevChip(s, `${counts[s]} ${t(`severity.${s}`)}`)))),
      sorted.length
        ? h('ol', { class: 'finding-list' }, sorted.map((f) => findingItem(f)))
        : emptyState({ icon: 'watchtower', title: t('wt.findings.none') }),
      r.suppressed.length
        ? disclosure({ summary: t('wt.findings.suppressed', { n: r.suppressed.length }), body: h('ol', { class: 'finding-list' }, r.suppressed.map((f) => findingItem(f, true))) })
        : null);
  }

  let findingSeq = 0;
  function findingItem(f, suppressed = false) {
    const rule = scanner.RULES.find((x) => x.id === f.ruleId);
    findingSeq += 1;
    const fid = `wt-f${findingSeq}`;
    return h('li', { class: ['finding', `sev-${f.severity}`, suppressed && 'is-suppressed'] },
      h('button', {
        type: 'button',
        class: 'finding-main',
        'aria-labelledby': `${fid}-go ${fid}-title ${fid}-loc`,
        'aria-describedby': `${fid}-top ${fid}-msg`,
        on: { click: () => { if (ui.reveal) toggleReveal(false); editor.focusLine(f.line, f.column, f.endColumn); } },
      },
      h('span', { class: 'sr-only', id: `${fid}-go` }, t('wt.finding.gotoPrefix')),
      h('span', { class: 'finding-top', id: `${fid}-top` },
        sevChip(f.severity),
        h('span', { class: 'mono small strong' }, f.ruleId),
        h('span', { class: 'finding-loc mono', id: `${fid}-loc` }, `L${f.line}:${f.column}`)),
      h('span', { class: 'finding-title', id: `${fid}-title` }, f.title),
      h('span', { class: 'finding-msg', id: `${fid}-msg` }, f.message),
      f.snippet ? h('code', { class: 'finding-snippet' }, snippetWithSpan(f)) : null),
      h('div', { class: 'finding-actions row', css: { '--row-gap': '6px' } },
        cweChip(f.cwe),
        rule ? button({ label: t('wt.finding.rule'), icon: 'info', size: 'xs', variant: 'ghost', onClick: () => ruleDrawer(rule) }) : null),
      suppressed && f.suppression ? h('p', { class: 'tiny muted' }, t('wt.finding.justification', { text: f.suppression.justification })) : null,
      f.fix ? disclosure({ summary: t('wt.finding.fix'), body: h('p', { class: 'small text-2' }, f.fix) }) : null);
  }

  function snippetWithSpan(f) {
    const text = f.snippet.replace(/\s+$/, '');
    const lead = text.length - text.trimStart().length;
    const start = Math.max(0, f.column - 1 - lead);
    const trimmed = text.trimStart();
    const end = Math.max(start, Math.min(trimmed.length, f.endColumn - 1 - lead));
    const parts = [trimmed.slice(0, start), trimmed.slice(start, end), trimmed.slice(end)];
    const render = (s) => splitInvisible(s).map((p) => (p.escaped ? h('span', { class: 'esc' }, p.text) : p.text));
    return [render(parts[0]), h('mark', null, render(parts[1])), render(parts[2])];
  }

  // ---------- toolbar ----------
  const exampleOptions = () => {
    const examples = store.get('examples');
    const list = Array.isArray(examples) && examples.length ? examples : [];
    const opts = [];
    const groupOf = (name) => list.filter((e) => e.group === name).map((e) => ({ value: e.path, label: e.path.split('/').at(-1) }));
    if (groupOf('vulnerable').length) opts.push({ group: t('wt.sample.vulnerable'), options: groupOf('vulnerable') });
    if (groupOf('hardened').length) opts.push({ group: t('wt.sample.hardened'), options: groupOf('hardened') });
    opts.push({ group: t('wt.sample.builtin'), options: BUILTIN_SAMPLES.map((s) => ({ value: s.path, label: s.name })) });
    return opts;
  };
  const allSamples = () => [...(Array.isArray(store.get('examples')) ? store.get('examples') : []), ...BUILTIN_SAMPLES];
  const selectSlot = h('div', { class: 'wt-select' });
  const drawSelect = () => mount(selectSlot, selectField({
    label: t('wt.sample'),
    value: ui.sample,
    options: [{ value: '', label: t('wt.sample.placeholder') }, ...exampleOptions()],
    onChange: (path) => loadSample(path),
    idOverride: 'wt-sample',
  }));
  const filename = inputField({ label: t('wt.filename'), value: ui.filename, mono: true, attrs: { spellcheck: 'false', autocomplete: 'off' }, onInput: debounce((v) => { ui.filename = v.slice(0, 120); runScan(); }, 250), idOverride: 'wt-filename' });
  const language = selectField({
    label: t('wt.language'),
    value: ui.language,
    options: [{ value: 'auto', label: t('wt.lang.auto') }, { value: 'cobol', label: t('wt.lang.cobol') }, { value: 'fortran', label: t('wt.lang.fortran') }],
    onChange: (v) => { ui.language = v; runScan(); },
    idOverride: 'wt-language',
  });
  const format = selectField({
    label: t('wt.format'),
    value: ui.format,
    options: [{ value: 'auto', label: t('wt.format.auto') }, { value: 'fixed', label: t('wt.format.fixed') }, { value: 'free', label: t('wt.format.free') }],
    onChange: (v) => { ui.format = v; runScan(); },
    idOverride: 'wt-format',
  });
  const sarifBtn = button({ label: t('wt.sarif'), icon: 'download', size: 'sm', onClick: downloadSarif });

  function loadSample(path) {
    const sample = allSamples().find((s) => s.path === path);
    if (!sample) return;
    ui.sample = path;
    ui.source = sample.source;
    ui.filename = sample.path.split('/').at(-1);
    filename.input.value = ui.filename;
    editor.setValue(ui.source);
    if (ui.reveal) toggleReveal(false);
    runScan();
    const select = document.getElementById('wt-sample');
    if (select && select.value !== path) select.value = path;
  }
  openExampleHook = (path) => {
    loadSample(path);
    document.getElementById('wt-editor-card')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  cleanups.push(() => { openExampleHook = null; });

  function downloadSarif() {
    if (!last) return;
    const sarif = scanner.toSarif([{ file: ui.filename || 'input', language: last.raw.language, format: last.raw.format, findings: last.raw.findings, suppressed: last.raw.suppressed }]);
    const blob = new Blob([JSON.stringify(sarif, null, 2)], { type: 'application/sarif+json' });
    const url = URL.createObjectURL(blob);
    const base = (ui.filename || 'watchtower').replace(/[^\w.-]+/g, '_').replace(/\.[^.]*$/, '') || 'watchtower';
    const a = h('a', { href: url, download: `${base}.sarif`, class: 'sr-only' }, 'SARIF');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(t('wt.sarif.done'));
  }

  drawSelect();
  cleanups.push(store.on('examples', drawSelect));
  if (store.get('examples') === null) loadExamples();

  const workspace = h('div', { class: 'wt-workspace' },
    h('div', { class: 'wt-editor-col' },
      invisibleSlot,
      editor.el,
      revealSlot,
      h('div', { class: 'editor-foot' }, metaLine, h('span', { class: 'tiny muted' }, t('wt.editor.columns')))),
    h('div', { class: 'wt-findings-col' }, findingsSlot));

  runScan();

  return h('section', { class: 'card layer-watchtower scanner-card', id: 'wt-editor-card', 'aria-labelledby': 'wt-editor-title' },
    h('div', { class: 'card-head' },
      h('div', { class: 'grow' },
        h('h2', { class: 'card-title', id: 'wt-editor-title' }, t('wt.editor.title')),
        h('p', { class: 'card-sub' }, t('wt.editor.sub'))),
      h('div', { class: 'card-actions' }, sarifBtn)),
    h('div', { class: 'wt-toolbar' }, selectSlot, filename.el, language, format),
    workspace);
}

// =====================================================================
// Rules
// =====================================================================
function ruleDrawer(rule) {
  const docsUrl = docsBase && /^[A-Z0-9-]+$/.test(rule.id) ? `${docsBase}${rule.id}.md` : null;
  openDrawer({
    eyebrow: t('wt.rule.eyebrow'),
    title: h('span', null, h('span', { class: 'mono' }, rule.id), h('br'), h('span', { class: 'drawer-subtitle' }, rule.title)),
    body: [
      h('dl', { class: 'kv' },
        h('dt', null, t('wt.rule.severity')), h('dd', null, sevChip(rule.severity)),
        h('dt', null, t('wt.rule.cwe')), h('dd', null, cweChip(rule.cwe)),
        h('dt', null, t('wt.rule.language')), h('dd', null, rule.language === 'any' ? t('wt.rule.lang.any') : t(`wt.lang.${rule.language}`)),
        h('dt', null, t('wt.rule.precision')), h('dd', null, t.has(`wt.precision.${rule.precision}`) ? t(`wt.precision.${rule.precision}`) : rule.precision)),
      h('section', { class: 'stack' }, h('h3', { class: 'section-title' }, t('wt.rule.summary')), h('p', null, rule.summary)),
      h('section', { class: 'stack' }, h('h3', { class: 'section-title' }, t('wt.rule.rationale')), h('p', { class: 'text-2' }, rule.rationale)),
      h('section', { class: 'stack' }, h('h3', { class: 'section-title' }, t('wt.rule.fix')), h('p', { class: 'text-2' }, rule.fix)),
      docsUrl
        ? h('a', { class: 'btn btn-sm', href: docsUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', { size: 16 }), h('span', null, t('wt.rule.docs')))
        : h('p', { class: 'small muted mono' }, rule.docs),
    ],
  });
}

function rulesCard(scanner) {
  const tableSlot = h('div');
  const draw = () => {
    const q = ui.ruleQuery.trim().toLowerCase();
    const rows = scanner.RULES.filter((r) => !q || `${r.id} ${r.title} ${r.cwe} ${r.language} ${r.severity}`.toLowerCase().includes(q));
    mount(tableSlot, dataTable({
      caption: t('wt.rules.title'),
      columns: [
        { key: 'id', label: 'ID', render: (r) => h('button', { type: 'button', class: 'link-button mono strong nowrap', on: { click: () => ruleDrawer(r) } }, r.id) },
        { key: 'title', label: t('col.name') },
        { key: 'severity', label: t('wt.rule.severity'), render: (r) => sevChip(r.severity) },
        { key: 'cwe', label: 'CWE', render: (r) => cweChip(r.cwe) },
        { key: 'language', label: t('wt.rule.language'), render: (r) => (r.language === 'any' ? t('wt.rule.lang.any') : t(`wt.lang.${r.language}`)) },
      ],
      rows,
      stack: true,
    }));
  };
  const searchId = 'wt-rule-search';
  const search = h('label', { class: 'search', for: searchId },
    h('span', { class: 'sr-only' }, t('wt.rules.filter')),
    icon('filter', { size: 16 }),
    h('input', { id: searchId, class: 'input', type: 'search', placeholder: t('wt.rules.filter'), props: { value: ui.ruleQuery }, on: { input: debounce((e) => { ui.ruleQuery = e.target.value; draw(); }, 120) } }));
  draw();
  return card({
    title: t('wt.rules.title'),
    sub: t('wt.rules.sub', { n: scanner.RULES.length }),
    actions: search,
    className: 'rules-card',
    body: tableSlot,
  });
}
