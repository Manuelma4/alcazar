// Lookout · charts/histogram: accepted amounts on a log10 axis (FRAUDSCAN's
// quarter-decade bins). Bars are neutral so the story pops: the ZSCORE
// outliers sit far out as saffron diamonds on a rug below the axis.

import { h, svg } from '../dom.mjs';
import { anchorOf, barPath, createTooltip, niceTicks, responsive, roving, svgRoot, tipContent } from './common.mjs';
import { formatCompact, formatDecimal, formatInt } from '../format.mjs';
import { t } from '../strings.mjs';

const unitsLabel = (log10) => {
  const v = 10 ** log10;
  if (v >= 1000) return formatCompact(v);
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? formatInt(rounded) : formatDecimal(rounded, rounded < 10 ? 2 : 0);
};

/**
 * @param {{ edges: number[], counts: number[], medianLog: number | null,
 *   outliers: { id: string, log: number, amount: string, z: number | null }[] }} data
 */
export function histogramChart(data, { label }) {
  const wrap = h('div', { class: 'chart chart-hist' });
  const tip = createTooltip(wrap);
  let svgEl = null;

  // Trim empty bins at both ends, keeping one bin of air.
  let first = data.counts.findIndex((c) => c > 0);
  let last = data.counts.length - 1 - [...data.counts].reverse().findIndex((c) => c > 0);
  if (first < 0) {
    first = 0;
    last = data.counts.length - 1;
  }
  for (const o of data.outliers) {
    const k = data.edges.findIndex((e, i) => i < data.edges.length - 1 && o.log >= e && o.log < data.edges[i + 1]);
    if (k >= 0) {
      first = Math.min(first, k);
      last = Math.max(last, k);
    }
  }
  first = Math.max(0, first - 1);
  last = Math.min(data.counts.length - 1, last + 1);
  const bins = data.counts.slice(first, last + 1).map((count, i) => ({ count, lo: data.edges[first + i], hi: data.edges[first + i + 1] }));

  const draw = (width) => {
    svgEl?.remove();
    const height = 250;
    const left = 36;
    const right = 10;
    const top = 16;
    const rug = 26;
    const bottom = 28 + rug;
    const plotW = Math.max(120, width - left - right);
    const plotH = height - top - bottom;
    const lo = bins[0]?.lo ?? 0;
    const hi = bins.at(-1)?.hi ?? 1;
    const sx = (v) => left + ((v - lo) / (hi - lo || 1)) * plotW;
    const max = Math.max(1, ...bins.map((b) => b.count));
    const ticks = niceTicks(max, { integer: true, target: 4 });
    const yMax = ticks.at(-1);
    const sy = (v) => top + plotH - (v / yMax) * plotH;
    const base = top + plotH;
    const decades = [];
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k += 1) decades.push(k);

    svgEl = svgRoot(width, height, label);
    svgEl.append(
      svg('g', { class: 'chart-grid', 'aria-hidden': 'true' },
        ticks.map((v) => svg('path', { d: `M${left} ${sy(v).toFixed(1)}H${left + plotW}` }))),
      svg('g', { class: 'chart-axis', 'aria-hidden': 'true' },
        ticks.map((v) => svg('text', { x: left - 8, y: (sy(v) + 4).toFixed(1), 'text-anchor': 'end' }, formatInt(v))),
        decades.map((k) => [
          svg('path', { class: 'chart-tick', d: `M${sx(k).toFixed(1)} ${base}v5` }),
          svg('text', { x: sx(k).toFixed(1), y: base + 18, 'text-anchor': 'middle' }, unitsLabel(k)),
        ]),
        svg('path', { class: 'chart-baseline', d: `M${left} ${base}H${left + plotW}` }),
        svg('path', { class: 'chart-rug-line', d: `M${left} ${base + rug + 6}H${left + plotW}` })));

    const binMarks = bins.map((b) => {
      const x0 = sx(b.lo) + 1;
      const x1 = sx(b.hi) - 1;
      const y = sy(b.count);
      return svg('g', {
        class: 'chart-mark',
        role: 'img',
        'aria-label': t('chart.hist.bin', { lo: unitsLabel(b.lo), hi: unitsLabel(b.hi), n: formatInt(b.count) }),
      },
      svg('rect', { class: 'chart-hit', x: x0 - 1, y: top, width: Math.max(1, x1 - x0 + 2), height: plotH }),
      b.count > 0 ? svg('path', { class: 'chart-bar mark-neutral', d: barPath(x0, y, Math.max(1, x1 - x0), base - y, { radius: 3 }) }) : null);
    });
    svgEl.append(...binMarks);

    if (data.medianLog !== null && data.medianLog >= lo && data.medianLog <= hi) {
      const mx = sx(data.medianLog);
      svgEl.append(svg('g', { class: 'chart-median', 'aria-hidden': 'true' },
        svg('path', { d: `M${mx.toFixed(1)} ${top - 4}V${base}` }),
        svg('text', { x: (mx + 5).toFixed(1), y: top + 6 }, `${t('tx.hist.median')} ${unitsLabel(data.medianLog)}`)));
    }

    const outlierMarks = data.outliers.map((o) => {
      const x = sx(Math.min(hi, Math.max(lo, o.log)));
      const y = base + rug - 2;
      return svg('g', {
        class: 'chart-mark',
        role: 'img',
        'aria-label': t('chart.hist.outlier', { id: o.id, amount: o.amount, z: o.z === null ? '\u{2014}' : formatDecimal(o.z, 1) }),
      },
      svg('rect', { class: 'chart-hit', x: x - 12, y: y - 12, width: 24, height: 24 }),
      svg('path', { class: 'chart-outlier', d: `M${x.toFixed(1)} ${y - 7}l6 7-6 7-6-7z` }));
    });
    svgEl.append(...outlierMarks);
    wrap.prepend(svgEl);

    const showBin = (g, i) => {
      const b = bins[i];
      const anchor = anchorOf(g.querySelector('.chart-bar') ?? g.querySelector('.chart-hit'), wrap);
      tip.show(tipContent(t('tx.hist.count', { n: b.count }), `${unitsLabel(b.lo)} \u{2013} ${unitsLabel(b.hi)}`), anchor.x, b.count ? anchor.y : base - 20);
    };
    const showOutlier = (g, i) => {
      const o = data.outliers[i];
      const anchor = anchorOf(g.querySelector('.chart-outlier'), wrap);
      tip.show(tipContent(o.amount, o.id, `${t('tx.hist.outlier')} \u{00B7} z ${o.z === null ? '\u{2014}' : formatDecimal(o.z, 1)}`), anchor.x, anchor.y);
    };
    binMarks.forEach((g, i) => {
      g.addEventListener('pointerenter', () => showBin(g, i));
      g.addEventListener('pointerleave', () => tip.hide());
    });
    outlierMarks.forEach((g, i) => {
      g.addEventListener('pointerenter', () => showOutlier(g, i));
      g.addEventListener('pointerleave', () => tip.hide());
    });
    roving(binMarks, { onFocus: showBin, onBlur: () => tip.hide() });
    if (outlierMarks.length) roving(outlierMarks, { onFocus: showOutlier, onBlur: () => tip.hide() });
  };

  const legend = h('ul', { class: 'chart-legend', 'aria-hidden': 'true' },
    h('li', null, h('span', { class: 'legend-swatch mark-neutral' }), t('chart.hist.legendBins')),
    data.outliers.length ? h('li', null, h('span', { class: 'legend-diamond' }), t('tx.hist.outlier')) : null,
    h('li', null, h('span', { class: 'legend-median' }), t('tx.hist.median')));

  const stop = responsive(wrap, draw);
  return { el: h('div', null, legend, wrap), destroy: stop, bins };
}
