// Lookout · icons: a small hand-drawn set, built with svg() (no icon font,
// no external sprite). 24×24, 1.7px strokes, currentColor.

import { svg } from './dom.mjs';

const P = (d, a = {}) => ['path', { d, ...a }];
const C = (cx, cy, r, a = {}) => ['circle', { cx, cy, r, ...a }];
const DOT = (cx, cy, r = 1.15) => C(cx, cy, r, { fill: 'currentColor', stroke: 'none' });

/** Wax-seal outline: a circle with a soft scalloped edge. */
function waxPath(cx, cy, r, bumps, depth) {
  const points = [];
  const steps = bumps * 8;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r + depth * Math.cos(bumps * a);
    points.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

const ICONS = {
  // ---- fortress identities ----
  gatehouse: [P('M2.5 21h19'), P('M3.75 21V3.5h16.5V21'), P('M7.5 21v-8.25a5.25 5.25 0 1 1 9 0V21'), P('M12 4.9v1.4')],
  rampart: [P('M3.25 21V6.5h2.5V10h2.5V6.5h2.5V10h2.5V6.5h2.5V10h2.5V6.5h2.5V21z'), P('M3.25 15.5h17.5M8.5 10v5.5M15.5 10v5.5M12 15.5V21')],
  observatory: [C(12, 13.5, 7.25), C(12, 13.5, 3.25), P('M6.4 19.1 17.6 7.9'), P('M12 6.25V5'), C(12, 3.6, 1.35)],
  seal: [P(waxPath(12, 10.4, 6.9, 9, 0.55)), C(12, 10.4, 3.4), P('M9.1 16.4 7.6 21.3l2.4-.9 1.2 2.1M14.9 16.4l1.5 4.9-2.4-.9-1.2 2.1')],
  watchtower: [P('M8.6 21 9.7 10.5h4.6L15.4 21'), P('M7.5 10.5h9V6.8h-1.9v1.5h-1.7V6.8h-1.8v1.5h-1.7V6.8H7.5z'), P('M11.1 13.4h1.8v2.9h-1.8z'), P('M12 2.4v1.6M8.7 3.4l1 1M15.3 3.4l-1 1'), P('M6.5 21h11')],
  lookout: [P('M4 21h16'), P('M6 21v-9a6.6 6.6 0 1 1 12 0v9'), P('M8.4 15.4c2-2.5 5.2-2.5 7.2 0-2 2.5-5.2 2.5-7.2 0z'), DOT(12, 15.4, 1.25)],
  khatam: [P('M6.6 6.6h10.8v10.8H6.6z'), P('M12 4.35 19.65 12 12 19.65 4.35 12z'), DOT(12, 12, 1.3)],
  coins: [P('M4 8.5h13.5'), P('M14 5l3.5 3.5L14 12'), P('M20 15.5H6.5'), P('M10 12 6.5 15.5 10 19')],
  siege: [P('M2.5 21h19'), P('M6.6 21 10 10.6 13.4 21'), P('M4.4 7.3 17.6 15.3'), P('M16.2 15.2h3.4v3.1h-3.4z'), C(4.1, 4.6, 1.45), P('M4.4 7.3l-.2-1.2')],
  shield: [P('M12 3l7 2.8v5.7c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V5.8z'), P('M8.9 12.2l2.2 2.2 4.1-4.4')],
  'shield-x': [P('M12 3l7 2.8v5.7c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V5.8z'), P('M9.6 9.6l4.8 4.8M14.4 9.6l-4.8 4.8')],
  'shield-alert': [P('M12 3l7 2.8v5.7c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V5.8z'), P('M12 8.3v4.4'), DOT(12, 15.6, 1.1)],

  // ---- signals ----
  zscore: [P('M2.5 18.5c3.4 0 4.7-11 7.6-11s4.2 11 7.6 11'), P('M2 21h20'), DOT(20.6, 9.2, 1.6)],
  structuring: [P('M3 6h18'), P('M5.5 20v-6M10 20v-8.2M14.5 20v-9.6M19 20v-10.6')],
  velocity: [P('M13 2.5 5 13.5h6l-1 8 8-11h-6z')],
  entropy: [P('M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z'), DOT(8.4, 8.4), DOT(15.6, 8.4), DOT(12, 12), DOT(8.4, 15.6), DOT(15.6, 15.6)],

  // ---- ledger ----
  link: [P('M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.2 1.2'), P('M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1.2-1.2')],
  'link-broken': [P('M15.6 13.4 18.66 11A4 4 0 0 0 13 5.34l-2.3 2.3'), P('M8.4 10.6 5.34 13A4 4 0 0 0 11 18.66l2.3-2.3'), P('M4 4l2.2 2.2M20 20l-2.2-2.2M9 2.8v2.4M2.8 9h2.4M15 21.2v-2.4M21.2 15h-2.4')],
  pen: [P('M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16z'), P('M13.5 6.5l4 4')],
  scissors: [C(6, 6, 2.6), C(6, 18, 2.6), P('M8.2 7.5 20 18M8.2 16.5 20 6')],
  'minus-circle': [C(12, 12, 8.5), P('M8 12h8')],

  // ---- utility ----
  check: [P('M5 12.5l4.5 4.5L19 7.5')],
  'check-circle': [C(12, 12, 8.75), P('M8.2 12.3l2.6 2.6 5-5.2')],
  x: [P('M6 6l12 12M18 6 6 18')],
  'x-circle': [C(12, 12, 8.75), P('M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6')],
  alert: [P('M12 3.6 2.6 20h18.8z'), P('M12 10v4.2'), DOT(12, 17.1, 1.1)],
  info: [C(12, 12, 8.75), P('M12 11v5.2'), DOT(12, 7.9, 1.1)],
  play: [P('M7.5 5v14l11.5-7z')],
  stop: [P('M6.5 6.5h11v11h-11z')],
  replay: [P('M4.2 12a7.8 7.8 0 1 0 2.3-5.5'), P('M4.2 4.2v4.6h4.6')],
  refresh: [P('M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9'), P('M18.6 3.4v3.8h-3.8M5.4 20.6v-3.8h3.8')],
  download: [P('M12 4v11'), P('M7 10.5l5 5 5-5'), P('M5 20h14')],
  upload: [P('M12 20V9'), P('M7 13.5l5-5 5 5'), P('M5 4h14')],
  search: [C(11, 11, 6.5), P('M16 16l4.5 4.5')],
  'chevron-right': [P('M9 5l7 7-7 7')],
  'chevron-left': [P('M15 5l-7 7 7 7')],
  'chevron-down': [P('M5 9l7 7 7-7')],
  'arrow-right': [P('M4.5 12h15'), P('M13.5 6l6 6-6 6')],
  external: [P('M14 4h6v6'), P('M20 4l-9 9'), P('M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5')],
  copy: [P('M10 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'), P('M15.5 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h4')],
  sun: [C(12, 12, 4), P('M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4')],
  moon: [P('M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z')],
  monitor: [P('M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5z'), P('M8.5 20h7M12 16.5V20')],
  lock: [P('M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11z'), P('M8 11V7.6a4 4 0 0 1 8 0V11')],
  key: [C(8, 15.5, 4), P('M10.9 12.6 19 4.5M16 7.5l2 2M13.8 9.7l1.8 1.8')],
  'log-out': [P('M9.5 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3.5'), P('M15 16.5 19.5 12 15 7.5'), P('M19.5 12H9.5')],
  file: [P('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'), P('M14 3v5h5'), P('M9.6 13l-2 2 2 2M14.4 13l2 2-2 2')],
  package: [P('M12 3l8 4.5v9L12 21l-8-4.5v-9z'), P('M4 7.5l8 4.5 8-4.5M12 12v9')],
  clock: [C(12, 12, 8.75), P('M12 7.2V12l3.2 2')],
  terminal: [P('M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6a1.5 1.5 0 0 1 1.5-1.5z'), P('M7 9l3 3-3 3M12.5 15H17')],
  cpu: [P('M7.5 7.5h9v9h-9z'), P('M10 3v4.5M14 3v4.5M10 16.5V21M14 16.5V21M3 10h4.5M3 14h4.5M16.5 10H21M16.5 14H21')],
  eye: [P('M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z'), C(12, 12, 2.8)],
  flask: [P('M9 3h6M10 3v6.2L4.7 18.4A1.7 1.7 0 0 0 6.2 21h11.6a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3'), P('M7.2 15h9.6')],
  target: [C(12, 12, 8), C(12, 12, 3), P('M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22')],
  filter: [P('M4 5h16l-6.3 7.4v5.8l-3.4 1.6v-7.4z')],
  spinner: [P('M12 3a9 9 0 1 1-9 9', { opacity: 0.95 })],
  bolt: [P('M13 2.5 5 13.5h6l-1 8 8-11h-6z')],
  layers: [P('M12 3.5 21 8l-9 4.5L3 8z'), P('M3 12.2l9 4.5 9-4.5M3 16.2l9 4.5 9-4.5')],
  globe: [C(12, 12, 8.75), P('M3.3 12h17.4M12 3.3c2.4 2.6 3.6 5.5 3.6 8.7s-1.2 6.1-3.6 8.7c-2.4-2.6-3.6-5.5-3.6-8.7S9.6 5.9 12 3.3z')],
  hash: [P('M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 9h16.5M3.5 15H20')],
};

/**
 * @param {keyof ICONS} name
 * @param {{ size?: number, label?: string, class?: string }} [options]
 */
export function icon(name, { size = 20, label, class: className } = {}) {
  const shapes = ICONS[name] ?? ICONS.info;
  const el = svg('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: ['icon', className],
    'aria-hidden': label ? undefined : 'true',
    role: label ? 'img' : undefined,
    'aria-label': label,
    focusable: 'false',
  }, ...shapes.map(([tag, attrs]) => svg(tag, attrs)));
  return el;
}

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** The Alcazar mark: gold horseshoe arch in its alfiz, framing a keyhole. */
export function logoMark({ size = 40, title } = {}) {
  return svg('svg', {
    viewBox: '0 0 64 64',
    width: size,
    height: size,
    class: 'brand-mark',
    role: title ? 'img' : undefined,
    'aria-hidden': title ? undefined : 'true',
    'aria-label': title,
    focusable: 'false',
  },
  svg('rect', { x: 10.5, y: 6.5, width: 43, height: 51, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5 }),
  svg('path', { d: 'M20 57.5V30.5a14 14 0 1 1 24 0V57.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
  svg('path', { d: 'M24.5 57.5V31.4a9.7 9.7 0 1 1 15 0V57.5', fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.35, 'stroke-width': 1.2 }),
  svg('circle', { cx: 32, cy: 31.5, r: 4.6, fill: 'currentColor' }),
  svg('path', { d: 'M29.4 34.3 27.9 45h8.2l-1.5-10.7z', fill: 'currentColor' }));
}
