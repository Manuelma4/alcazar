// Lookout · jobui: job widgets shared by Overview, Transactions and Seal.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';
import { t } from './strings.mjs';
import { href } from './router.mjs';
import { formatDecimal, formatInt, formatMoney, formatMs, formatPercent, formatTimestamp, shortHash } from './format.mjs';
import { acceptedRecord, rejectedRecord, ACCEPTED_LAYOUT, REJECTED_LAYOUT } from './records.mjs';
import { chip, copyButton, escapedText, kpi, layerChip, meter, openDrawer, banner } from './ui.mjs';
import { recordView } from './recordview.mjs';

export const SIGNAL_ICONS = { ZSCORE: 'zscore', STRUCTURING: 'structuring', VELOCITY: 'velocity', ENTROPY: 'entropy' };
const STAGE_LAYER = { gatehouse: 'gatehouse', txnguard: 'cobol', fraudscan: 'fortran', seal: 'seal' };

export function signalChip(signal) {
  return h('span', { class: 'chip signal layer-fortran', title: t(`signal.${signal}`) },
    icon(SIGNAL_ICONS[signal] ?? 'alert', { size: 14 }), signal);
}

export function statusChip(row) {
  if (row.status === 'rejected') return chip(h('span', null, t('tx.status.rejected'), ' ', h('span', { class: 'mono' }, row.rejection.code)), { tone: 'danger', icon: 'x-circle' });
  if (row.status === 'flagged') return h('span', { class: 'chip layer layer-fortran' }, icon('observatory', { size: 14 }), t('tx.status.flagged'));
  return chip(t('tx.status.accepted'), { tone: 'ok', icon: 'check-circle' });
}

export function jobKpis(job) {
  const s = job.summary;
  const v = job.ledger.verification;
  const b = job.risk.benford;
  const total = job.stages.reduce((sum, x) => sum + x.ms, 0);
  return h('div', { class: 'kpis' },
    kpi({ label: t('kpi.received'), value: formatInt(s.received), icon: 'gatehouse', layer: 'gatehouse', sub: t('kpi.received.sub', { ms: formatMs(total) }) }),
    kpi({ label: t('kpi.accepted'), value: formatInt(s.accepted), icon: 'rampart', layer: 'cobol', sub: formatPercent(s.received ? s.accepted / s.received : 0) }),
    kpi({ label: t('kpi.rejected'), value: formatInt(s.rejected), icon: 'x-circle', layer: 'cobol', sub: t('kpi.rejected.sub', { n: new Set(job.rejections.map((r) => r.code)).size }) }),
    kpi({ label: t('kpi.flagged'), value: formatInt(s.flagged), icon: 'observatory', layer: 'fortran', sub: t('kpi.flagged.sub', { n: new Set(job.risk.transactions.flatMap((x) => x.signals)).size }) }),
    v.stale
      ? kpi({ label: t('kpi.ledger'), text: true, value: t('kpi.ledger.stale'), icon: 'alert', layer: 'seal', sub: t('kpi.ledger.staleSub') })
      : kpi({
        label: t('kpi.ledger'),
        text: true,
        value: v.valid ? t('kpi.ledger.valid') : t('kpi.ledger.broken'),
        icon: v.valid ? 'seal' : 'link-broken',
        layer: 'seal',
        sub: v.valid ? t('kpi.ledger.sub', { entries: formatInt(v.entries), n: v.verifiedBy.length }) : t('kpi.ledger.brokenSub', { reason: v.reason ?? '', seq: v.brokenAt ?? '' }),
      }),
    kpi({ label: t('kpi.benford'), text: true, value: t(`verdict.${b.verdict}`), icon: 'zscore', layer: 'fortran', sub: t(`verdict.basis.${b.verdictBasis}`, { p: b.pValue.toFixed(3), mad: b.mad.toFixed(4), n: b.n }) }));
}

/** Stage timeline: one segment per stage, proportional to its time. */
export function pipelineTimeline(job) {
  const total = Math.max(1, job.stages.reduce((sum, s) => sum + s.ms, 0));
  return h('div', { class: 'timeline' },
    h('div', { class: 'timeline-bar', role: 'img', 'aria-label': job.stages.map((s) => `${s.name} ${formatMs(s.ms)}`).join(', ') },
      job.stages.map((s) => h('span', {
        class: ['timeline-seg', `layer-${STAGE_LAYER[s.name] ?? 'gatehouse'}`],
        css: { '--share': String(Math.max(0.04, s.ms / total)) },
      }))),
    h('ol', { class: 'timeline-legend' }, job.stages.map((s) => h('li', { class: `layer-${STAGE_LAYER[s.name] ?? 'gatehouse'}` },
      h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'timeline-name' }, t.has(`tx.stage.${s.name}`) ? t(`tx.stage.${s.name}`) : s.name),
      h('span', { class: 'timeline-meta mono' }, formatMs(s.ms), s.rc !== null ? ` \u{00B7} ${t('tx.stage.rc', { rc: s.rc })}` : ''),
      s.status !== 'ok' ? chip(s.status, { tone: s.status === 'error' ? 'danger' : 'warn', className: 'timeline-status' }) : null))));
}

/** Amount for a row: exact money for accepted, the submitted text for rejected. */
export function rowAmount(row) {
  if (row.accepted) return formatMoney(row.accepted.amountCents, row.accepted.currency);
  if (row.input?.amount) return `${row.input.amount} ${row.input.currency}`.trim();
  return '\u{2014}';
}

function kvRow(label, value) {
  return [h('dt', null, label), h('dd', null, value)];
}

/** The detail drawer for one transfer. */
export function openTransferDrawer(row, job) {
  const body = [];
  body.push(h('div', { class: 'row' }, statusChip(row), row.risk?.signals.map(signalChip)));

  if (row.rejection) {
    const r = row.rejection;
    body.push(banner({
      tone: 'danger',
      icon: 'rampart',
      title: h('span', null, h('span', { class: 'mono' }, r.code), ` \u{00B7} ${r.field}`),
      body: [h('p', null, r.message), h('p', { class: 'mono small muted', css: { 'margin-top': '4px' } }, r.detail)],
    }));
    body.push(h('section', { class: 'stack' },
      h('h3', { class: 'section-title' }, t('tx.drawer.rejected')),
      recordView(rejectedRecord(r), REJECTED_LAYOUT, { caption: t('tx.drawer.rejected') })));
    if (row.input) {
      const i = row.input;
      body.push(h('section', { class: 'stack' },
        h('h3', { class: 'section-title' }, t('tx.drawer.submitted')),
        h('dl', { class: 'kv' },
          kvRow(t('col.id'), escapedText(i.id, { className: 'mono' })),
          kvRow(t('col.time'), escapedText(i.timestamp, { className: 'mono' })),
          kvRow(t('col.from'), h('span', { class: 'mono' }, i.from || '\u{2014}')),
          kvRow(t('col.to'), h('span', { class: 'mono' }, i.to || '\u{2014}')),
          kvRow(t('col.amount'), escapedText(`${i.amount} ${i.currency}`, { className: 'mono' })),
          kvRow(t('col.channel'), escapedText(i.channel, { className: 'mono' })),
          kvRow(t('col.card'), h('span', { class: 'mono' }, i.card || '\u{2014}')),
          kvRow(t('col.memo'), escapedText(i.memo || '\u{2014}', { className: 'mono' })))));
    }
  }

  if (row.accepted) {
    const a = row.accepted;
    body.push(h('dl', { class: 'kv' },
      kvRow(t('col.time'), formatTimestamp(a.timestamp)),
      kvRow(t('col.amount'), h('strong', null, formatMoney(a.amountCents, a.currency))),
      kvRow(t('col.from'), h('span', { class: 'stack', css: { '--stack-gap': '2px' } }, h('span', { class: 'mono' }, a.fromMasked), h('span', { class: 'mono muted tiny' }, `${t('col.token')} ${a.fromToken}`))),
      kvRow(t('col.to'), h('span', { class: 'stack', css: { '--stack-gap': '2px' } }, h('span', { class: 'mono' }, a.toMasked), h('span', { class: 'mono muted tiny' }, `${t('col.token')} ${a.toToken}`))),
      kvRow(t('col.channel'), a.channel),
      kvRow(t('col.card'), h('span', { class: 'mono' }, a.panMasked ?? '\u{2014}')),
      kvRow(t('col.memo'), escapedText(a.memo || '\u{2014}'))));
    if (row.risk) {
      const r = row.risk;
      body.push(h('section', { class: 'stack' },
        h('h3', { class: 'section-title' }, t('tx.drawer.risk')),
        h('div', { class: 'risk-score' },
          h('span', { class: 'risk-score-value' }, formatInt(r.score)),
          meter(r.score / 100, { color: 'var(--fortran)', label: t('tx.drawer.scoreLabel', { score: r.score }) })),
        h('dl', { class: 'kv' },
          kvRow(t('col.z'), r.z === null ? '\u{2014}' : formatDecimal(r.z, 2)),
          kvRow(t('col.entropy'), r.entropy === null ? '\u{2014}' : t('tx.drawer.bits', { bits: formatDecimal(r.entropy, 2) }))),
        r.signals.length ? h('ul', { class: 'signal-list' }, r.signals.map((s) => h('li', null, signalChip(s), h('span', { class: 'small text-2' }, signalDescription(s, job))))) : null));
    }
    body.push(h('section', { class: 'stack' },
      h('h3', { class: 'section-title' }, t('tx.drawer.accepted')),
      recordView(acceptedRecord(a), ACCEPTED_LAYOUT, { caption: t('tx.drawer.accepted') })));
  }

  if (row.entry) {
    const e = row.entry;
    body.push(h('section', { class: 'stack' },
      h('h3', { class: 'section-title' }, t('tx.drawer.ledger')),
      h('dl', { class: 'kv' },
        kvRow('SEQ', h('span', { class: 'mono' }, String(e.seq).padStart(6, '0'))),
        kvRow(t('seal.tile.mac'), h('span', { class: 'hash-line' }, h('span', { class: 'hash' }, shortHash(e.mac, 8, 8)), copyButton(e.mac, { what: 'MAC' })))),
      h('a', { class: 'btn btn-sm', href: href('seal', String(e.seq)) }, icon('seal', { size: 16 }), h('span', null, t('tx.drawer.openSeal')))));
  }

  openDrawer({
    eyebrow: t('tx.drawer.eyebrow', { line: row.line }),
    title: h('span', { class: 'mono' }, escapedText(row.id || '\u{2014}')),
    body,
  });
}

export function signalDescription(signal, job) {
  const th = job.risk.thresholds;
  return t(`signal.${signal}.desc`, {
    z: th.z,
    count: th.velocityCount,
    window: th.velocityWindowS,
    len: th.entropyMinLength,
    bits: th.entropyBits,
  });
}

export function layerOfStage(name) {
  return STAGE_LAYER[name] ?? 'gatehouse';
}

export { layerChip };
