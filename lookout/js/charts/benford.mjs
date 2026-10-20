// Lookout · charts/benford: observed first-digit shares (bars, FRAUDSCAN's
// colour) against Benford's expected curve (neutral reference line + dots).

import { h, svg } from '../dom.mjs';
import { anchorOf, barPath, createTooltip, niceTicks, responsive, roving, svgRoot, tipContent } from './common.mjs';
import { formatInt, formatPercent } from '../format.mjs';
import { t } from '../strings.mjs';

export function benfordChart(benford, { label }) {
  const wrap = h('div', { class: 'chart chart-benford' });
  const tip = createTooltip(wrap);
  let svgEl = null;

  const draw = (width) => {
    svgEl?.remove();
    const height = 240;
    const left = 40;
    const right = 8;
    const top = 12;
    const bottom = 30;
    const plotW = Math.max(120, width - left - right);
    const plotH = height - top - bottom;
    const max = Math.max(0.05, ...benford.observed, ...benford.expected);
    const ticks = niceTicks(max, { target: 4 });
    const yMax = ticks.at(-1);
    const sy = (v) => top + plotH - (v / yMax) * plotH;
    const band = plotW / 9;
    const barW = Math.min(24, band * 0.5);
    const cx = (i) => left + band * i + band / 2;

    svgEl = svgRoot(width, height, label);
    const expectedLine = benford.expected.map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join('');
    svgEl.append(
      svg('g', { class: 'chart-grid', 'aria-hidden': 'true' },
        ticks.map((v) => svg('path', { d: `M${left} ${sy(v).toFixed(1)}H${left + plotW}` }))),
      svg('g', { class: 'chart-axis', 'aria-hidden': 'true' },
        ticks.map((v) => svg('text', { x: left - 8, y: (sy(v) + 4).toFixed(1), 'text-anchor': 'end' }, formatPercent(v, 0))),
        benford.observed.map((_, i) => svg('text', { x: cx(i).toFixed(1), y: height - 8, 'text-anchor': 'middle', class: 'chart-axis-strong' }, String(i + 1))),
        svg('path', { class: 'chart-baseline', d: `M${left} ${top + plotH}H${left + plotW}` })));

    const marks = benford.observed.map((obs, i) => {
      const y = sy(obs);
      return svg('g', {
        class: 'chart-mark',
        role: 'img',
        'aria-label': t('chart.benford.mark', { d: i + 1, obs: formatPercent(obs), n: formatInt(benford.counts[i]), exp: formatPercent(benford.expected[i]) }),
      },
      svg('rect', { class: 'chart-hit', x: left + band * i, y: top, width: band, height: plotH }),
      svg('path', { class: 'chart-bar mark-fortran', d: barPath(cx(i) - barW / 2, y, barW, top + plotH - y) }));
    });
    svgEl.append(...marks,
      svg('path', { class: 'chart-ref-line', d: expectedLine, 'aria-hidden': 'true' }),
      svg('g', { class: 'chart-ref-dots', 'aria-hidden': 'true' },
        benford.expected.map((v, i) => svg('circle', { cx: cx(i).toFixed(1), cy: sy(v).toFixed(1), r: 4 }))));
    wrap.prepend(svgEl);

    const show = (g, i) => {
      const anchor = anchorOf(g.querySelector('.chart-bar'), wrap);
      tip.show(tipContent(
        `${formatPercent(benford.observed[i])} · ${formatInt(benford.counts[i])}`,
        t('chart.benford.tipLabel', { d: i + 1 }),
        t('chart.benford.tipExpected', { exp: formatPercent(benford.expected[i]) }),
      ), anchor.x, Math.min(anchor.y, sy(benford.expected[i])));
    };
    marks.forEach((g, i) => {
      g.addEventListener('pointerenter', () => show(g, i));
      g.addEventListener('pointerleave', () => tip.hide());
    });
    roving(marks, { onFocus: show, onBlur: () => tip.hide() });
  };

  const legend = h('ul', { class: 'chart-legend', 'aria-hidden': 'true' },
    h('li', null, h('span', { class: 'legend-swatch mark-fortran' }), t('tx.benford.observed')),
    h('li', null, h('span', { class: 'legend-line' }), t('tx.benford.expected')));

  const stop = responsive(wrap, draw);
  return { el: h('div', null, legend, wrap), destroy: () => { stop(); tip.off(); } };
}
