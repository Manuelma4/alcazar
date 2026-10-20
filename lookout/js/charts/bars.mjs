// Lookout · charts/bars: horizontal bar chart (rejection reasons).
// One series → one colour (the layer that rejected them), value at the tip,
// hairline grid, hover + keyboard tooltips.

import { h, svg } from '../dom.mjs';
import { anchorOf, barPath, createTooltip, niceTicks, responsive, roving, svgRoot, tipContent } from './common.mjs';
import { formatInt, formatPercent } from '../format.mjs';

const truncate = (text, chars) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}\u{2026}` : text);

/**
 * @param {{ code: string, field: string, message: string, count: number }[]} rows
 */
export function reasonBars(rows, { label, total, markClass = 'mark-cobol' }) {
  const wrap = h('div', { class: 'chart chart-bars' });
  const tip = createTooltip(wrap);
  let svgEl = null;

  const draw = (width) => {
    svgEl?.remove();
    const rowH = 34;
    const bar = 14;
    const top = 4;
    const axisH = 24;
    const codeW = 44;
    const labelW = Math.round(Math.min(Math.max(150, width * 0.44), 320));
    const valueW = 34;
    const plotX = labelW + 10;
    const plotW = Math.max(40, width - plotX - valueW);
    const bodyH = rows.length * rowH;
    const height = top + bodyH + axisH;
    const max = Math.max(1, ...rows.map((r) => r.count));
    const ticks = niceTicks(max, { integer: true, target: Math.min(5, max) });
    const xMax = ticks.at(-1);
    const sx = (v) => plotX + (v / xMax) * plotW;
    const chars = Math.max(6, Math.floor((labelW - codeW - 6) / 6.3));

    svgEl = svgRoot(width, height, label);
    svgEl.append(
      svg('g', { class: 'chart-grid', 'aria-hidden': 'true' },
        ticks.map((v) => svg('path', { d: `M${sx(v).toFixed(1)} ${top}V${top + bodyH}` }))),
      svg('g', { class: 'chart-axis', 'aria-hidden': 'true' },
        svg('path', { class: 'chart-baseline', d: `M${plotX} ${top}V${top + bodyH}` }),
        ticks.map((v) => svg('text', { x: sx(v).toFixed(1), y: height - 6, 'text-anchor': 'middle' }, formatInt(v)))));

    const marks = rows.map((r, i) => {
      const y = top + i * rowH;
      const w = Math.max(3, sx(r.count) - plotX);
      const mid = y + rowH / 2 + 4;
      return svg('g', {
        class: 'chart-mark',
        role: 'img',
        'aria-label': `${r.code}, ${r.message}: ${formatInt(r.count)} (${formatPercent(total ? r.count / total : 0)})`,
      },
      svg('rect', { class: 'chart-hit', x: 0, y, width, height: rowH }),
      svg('text', { class: 'chart-code', x: 0, y: mid }, r.code),
      svg('text', { class: 'chart-label', x: codeW, y: mid }, truncate(r.message, chars)),
      svg('path', { class: ['chart-bar', markClass].join(' '), d: barPath(plotX, y + (rowH - bar) / 2, w, bar, { horizontal: true }) }),
      svg('text', { class: 'chart-value', x: (plotX + w + 6).toFixed(1), y: mid }, formatInt(r.count)));
    });
    svgEl.append(...marks);
    wrap.prepend(svgEl);

    const show = (g, i) => {
      const r = rows[i];
      const anchor = anchorOf(g.querySelector('.chart-bar'), wrap);
      tip.show(tipContent(`${formatInt(r.count)} · ${formatPercent(total ? r.count / total : 0)}`, `${r.code} · ${r.field}`, r.message), anchor.x, anchor.y);
    };
    marks.forEach((g, i) => {
      g.addEventListener('pointerenter', () => show(g, i));
      g.addEventListener('pointerleave', () => tip.hide());
    });
    roving(marks, { onFocus: show, onBlur: () => tip.hide() });
  };

  const stop = responsive(wrap, draw);
  return { el: wrap, destroy: () => { stop(); tip.off(); } };
}
