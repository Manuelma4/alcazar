// Lookout · charts/common: hand-made SVG chart plumbing (no libraries).
// Responsive redraws, one HTML tooltip per chart (positioned through CSSOM
// custom properties — no style attributes), roving keyboard focus across
// marks, and clean ticks.

import { h, svg } from '../dom.mjs';

/** Redraw `draw(width)` whenever the host's width changes. */
export function responsive(host, draw) {
  let width = 0;
  let frame = 0;
  const run = () => {
    frame = 0;
    const next = Math.floor(host.clientWidth);
    if (next > 0 && next !== width) {
      width = next;
      draw(width);
    }
  };
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(run);
  });
  observer.observe(host);
  requestAnimationFrame(run);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/**
 * Tooltip living inside `host` (which must be position: relative). Escape
 * dismisses it without moving the pointer or the focus (1.4.13).
 */
export function createTooltip(host) {
  const tip = h('div', { class: 'chart-tip', role: 'presentation', 'aria-hidden': 'true' });
  host.append(tip);
  const onKey = (event) => {
    if (event.key === 'Escape') tip.classList.remove('is-on');
  };
  document.addEventListener('keydown', onKey);
  return {
    show(content, x, y) {
      tip.replaceChildren(...[].concat(content));
      tip.classList.add('is-on');
      const hostWidth = host.clientWidth;
      const tipWidth = tip.offsetWidth;
      const tipHeight = tip.offsetHeight;
      const left = Math.max(4, Math.min(hostWidth - tipWidth - 4, x - tipWidth / 2));
      const top = y - tipHeight - 12 < 0 ? y + 16 : y - tipHeight - 12;
      tip.style.setProperty('--tx', `${Math.round(left)}px`);
      tip.style.setProperty('--ty', `${Math.round(top)}px`);
    },
    hide() {
      tip.classList.remove('is-on');
    },
    /** Remove the Escape listener (the chart's destroy calls it). */
    off() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

/** Tooltip body: the value leads, the label follows (dataviz convention). */
export function tipContent(value, label, extra) {
  return [
    h('p', { class: 'chart-tip-value' }, value),
    label ? h('p', { class: 'chart-tip-label' }, label) : null,
    extra ? h('p', { class: 'chart-tip-extra' }, extra) : null,
  ].filter(Boolean);
}

/**
 * Make marks keyboard reachable with a single tab stop: arrow keys move
 * between them; focus shows the same tooltip as hover.
 * @param {SVGElement[]} marks  each with an aria-label
 */
export function roving(marks, { onFocus, onBlur } = {}) {
  marks.forEach((mark, index) => {
    mark.setAttribute('tabindex', index === 0 ? '0' : '-1');
    mark.addEventListener('focus', () => {
      marks.forEach((m) => m.setAttribute('tabindex', m === mark ? '0' : '-1'));
      onFocus?.(mark, index);
    });
    mark.addEventListener('blur', () => onBlur?.(mark, index));
    mark.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let next = null;
      if (event.key in keys) next = (index + keys[event.key] + marks.length) % marks.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = marks.length - 1;
      if (next === null) return;
      event.preventDefault();
      marks[next].focus();
    });
  });
}

/** Position of an SVG element's box centre-top, in host pixels. */
export function anchorOf(el, host) {
  const box = el.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  return { x: box.left - hostBox.left + box.width / 2, y: box.top - hostBox.top };
}

/** 1, 2 or 5 × 10^k ticks covering [0, max]. */
export function niceTicks(max, { target = 4, integer = false } = {}) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
  if (integer) step = Math.max(1, Math.round(step));
  const ticks = [];
  for (let i = 0; i * step <= max + step * 1e-9; i += 1) ticks.push(Number((i * step).toFixed(10)));
  if (ticks.at(-1) < max) ticks.push(Number((ticks.length * step).toFixed(10)));
  return ticks;
}

/** A bar with a 4px rounded data end and a square baseline. */
export function barPath(x, y, w, hgt, { horizontal = false, radius = 4 } = {}) {
  if (horizontal) {
    const r = Math.max(0, Math.min(radius, w, hgt / 2));
    return `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + hgt - r}Q${x + w} ${y + hgt} ${x + w - r} ${y + hgt}H${x}Z`;
  }
  const r = Math.max(0, Math.min(radius, hgt, w / 2));
  return `M${x} ${y + hgt}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + hgt}Z`;
}

export function svgRoot(width, height, label) {
  return svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'chart-svg',
    role: 'group',
    'aria-label': label,
  });
}

/** Chart + equivalent table with a toggle button (charts never gate data). */
export function chartWithTable({ chartHost, table, showTableLabel, showChartLabel }) {
  const tableHost = h('div', { class: 'chart-table', hidden: true }, table);
  // The label says what the button will show next; no aria-pressed, which
  // would contradict a label that changes.
  let showingTable = false;
  const toggle = h('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    on: {
      click: () => {
        showingTable = !showingTable;
        tableHost.hidden = !showingTable;
        chartHost.hidden = showingTable;
        toggle.querySelector('span').textContent = showingTable ? showChartLabel : showTableLabel;
      },
    },
  }, h('span', null, showTableLabel));
  return { toggle, tableHost };
}
