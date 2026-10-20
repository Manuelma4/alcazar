// Lookout · recordview: a fixed-width record shown the mainframe way — a
// 3270 column ruler over the bytes, fields in alternating bands, and a legend
// with each field's columns and value.

import { h } from './dom.mjs';
import { ruler, segments } from './records.mjs';
import { t } from './strings.mjs';

/**
 * @param {string} record
 * @param {ReadonlyArray<[string, number, string]>} layout
 * @param {{ separator?: string, marks?: { at: number, label: string }[], changed?: [number, number][], caption?: string }} [options]
 */
export function recordView(record, layout, { separator = '', marks = [], changed = [], caption } = {}) {
  const segs = segments(record, layout, separator);
  const isChanged = (start, end) => changed.some(([a, b]) => a < end && b > start);
  let band = 0;
  const line = h('div', { class: 'rec-line' }, segs.map((s) => {
    if (s.separator) return h('span', { class: 'rec-sep' }, s.text);
    band += 1;
    const cls = ['rec-seg', band % 2 ? 'is-odd' : 'is-even'];
    if (isChanged(s.start, s.start + s.length)) cls.push('is-changed');
    return h('span', { class: cls, title: `${s.name} · ${s.start + 1}–${s.start + s.length}` }, s.text.replace(/ /g, '\u{00B7}'));
  }));
  const markers = marks.length ? h('div', { class: 'rec-marks', 'aria-hidden': 'true' },
    marks.map((m) => h('span', { class: 'rec-mark', css: { '--col': String(m.at) } }, m.label))) : null;

  const legend = h('table', { class: 'data rec-legend' },
    caption ? h('caption', { class: 'sr-only' }, caption) : null,
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, t('col.field')),
      h('th', { scope: 'col', class: 'num' }, t('col.columns')),
      h('th', { scope: 'col' }, t('col.value')))),
    h('tbody', null, segs.filter((s) => !s.separator).map((s) => h('tr', { class: isChanged(s.start, s.start + s.length) ? 'is-changed' : undefined },
      // A changed field says so in words, not only in red (1.4.1).
      h('th', { scope: 'row', class: 'mono' }, s.name,
        isChanged(s.start, s.start + s.length) ? h('span', { class: 'rec-changed-tag' }, t('rec.changed')) : null),
      h('td', { class: 'num mono' }, `${s.start + 1}\u{2013}${s.start + s.length}`),
      h('td', { class: 'mono break' }, s.text.trim() || '\u{2014}')))));

  return h('div', { class: 'rec' },
    h('div', { class: 'rec-scroll', tabindex: '0', role: 'group', 'aria-label': caption ?? t('rec.label', { n: record.length }) },
      h('div', { class: 'rec-ruler', 'aria-hidden': 'true' }, ruler(record.length)),
      line,
      markers),
    h('div', { class: 'table-wrap rec-legend-wrap' }, legend));
}
