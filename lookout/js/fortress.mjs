// Lookout · fortress: the overview's signature figure. A cross-section of the
// Alcazar at night: transfers enter through the Gatehouse arch, cross the
// COBOL rampart, pass the Fortran observatory and are sealed in the archive,
// while the Watchtower scans the code from above.
//
// The animation is a *replay* of a real job (the batch itself takes ~50 ms):
// packets take the colour of the last layer that checked them, rejected ones
// bounce off the rampart, flagged ones get a saffron halo. Reduced motion →
// the final state is drawn at once.

import { svg, reducedMotion } from './dom.mjs';
import { t } from './strings.mjs';

const W = 1200;
const H = 420;
const GROUND = 360;
const ROAD = 343;
const X = { gatehouse: 150, cobol: 450, watchtower: 600, fortran: 750, seal: 1050 };
const WALL_FACE = 423;      // where rejected packets hit the portcullis
const GATE_EXIT = 476;      // past the rampart gate: validated by COBOL
const SEAL_DOOR = 1050;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const deg = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, a) => `${(cx + r * Math.cos(deg(a))).toFixed(2)} ${(cy + r * Math.sin(deg(a))).toFixed(2)}`;

/** Horseshoe-arch opening: jambs at cx±half, springing at y, radius r (> half). */
function horseshoe(cx, springY, half, r, bottom = GROUND) {
  return `M${cx - half} ${bottom}V${springY}A${r} ${r} 0 1 1 ${cx + half} ${springY}V${bottom}Z`;
}

/** Alternating voussoirs (the Córdoba-style rosca) around a horseshoe arch. */
function voussoirs(cx, springY, half, rIn, rOut, count, classes) {
  const off = Math.sqrt(rIn * rIn - half * half);
  const cy = springY - off;
  const a0 = (Math.atan2(off, -half) * 180) / Math.PI; // ~155°
  const a1 = 360 + (Math.atan2(off, half) * 180) / Math.PI; // ~385°
  const step = (a1 - a0) / count;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const s = a0 + i * step;
    const e = s + step;
    out.push(svg('path', {
      class: classes[i % classes.length],
      d: `M${pt(cx, cy, rIn, s)}A${rIn} ${rIn} 0 0 1 ${pt(cx, cy, rIn, e)}L${pt(cx, cy, rOut, e)}A${rOut} ${rOut} 0 0 0 ${pt(cx, cy, rOut, s)}Z`,
    }));
  }
  return out;
}

function merlons(x0, count, width, gap, top, height, capped) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = x0 + i * (width + gap);
    out.push(svg('rect', { x, y: top, width, height, class: 'fx-stone' }));
    if (capped) out.push(svg('path', { d: `M${x} ${top}L${x + width / 2} ${top - 8}L${x + width} ${top}Z`, class: 'fx-stone' }));
  }
  return out;
}

function sebka(x0, y, count, w, gap) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const cx = x0 + i * (w + gap) + w / 2;
    out.push(svg('path', { d: horseshoe(cx, y, w / 2 - 1, w / 2 + 1, y + 14), class: 'fx-trim-line' }));
  }
  return out;
}

function waxSeal(cx, cy, r) {
  const pts = [];
  for (let i = 0; i <= 72; i += 1) {
    const a = (i / 72) * Math.PI * 2;
    const rr = r + 1.6 * Math.cos(10 * a);
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  const s = r * 0.42;
  const d2 = s * Math.SQRT2;
  return [
    svg('path', { d: `M${pts.join('L')}Z`, class: 'fx-seal-wax' }),
    svg('circle', { cx, cy, r: r - 5, class: 'fx-seal-ring' }),
    svg('path', { d: `M${cx - s} ${cy - s}h${2 * s}v${2 * s}h${-2 * s}z`, class: 'fx-seal-star' }),
    svg('path', { d: `M${cx} ${cy - d2}L${cx + d2} ${cy}L${cx} ${cy + d2}L${cx - d2} ${cy}z`, class: 'fx-seal-star' }),
  ];
}

function drawScene() {
  const rand = rng(1492);
  const stars = Array.from({ length: 46 }, () => svg('circle', {
    cx: (rand() * W).toFixed(1),
    cy: (8 + rand() * 210).toFixed(1),
    r: (0.5 + rand() * 1.1).toFixed(2),
    class: rand() > 0.82 ? 'fx-star is-bright' : 'fx-star',
  }));

  // distant city: flat roofs, two domes and a minaret-bell tower
  let skyline = `M0 ${GROUND}V300`;
  let x = 0;
  while (x < W) {
    const w = 26 + Math.floor(rand() * 46);
    const top = 282 + Math.floor(rand() * 26);
    skyline += `H${x}V${top}H${Math.min(W, x + w)}`;
    x += w;
  }
  skyline += `V${GROUND}Z`;

  const defs = svg('defs', null,
    svg('linearGradient', { id: 'fx-sky', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: '0', class: 'fx-sky-1' }),
      svg('stop', { offset: '1', class: 'fx-sky-2' })),
    svg('linearGradient', { id: 'fx-door', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: '0', class: 'fx-door-1' }),
      svg('stop', { offset: '1', class: 'fx-door-2' })),
    svg('radialGradient', { id: 'fx-lantern', cx: 0.5, cy: 0.5, r: 0.5 },
      svg('stop', { offset: '0', class: 'fx-lantern-1' }),
      svg('stop', { offset: '1', class: 'fx-lantern-2' })),
    svg('pattern', { id: 'fx-tiles', width: 16, height: 8, patternUnits: 'userSpaceOnUse' },
      svg('path', { d: 'M8 0.5 11.5 4 8 7.5 4.5 4z', class: 'fx-tile' })));

  const sky = svg('g', { class: 'fx-sky' },
    svg('rect', { x: 0, y: 0, width: W, height: GROUND, fill: 'url(#fx-sky)' }),
    ...stars,
    svg('path', { class: 'fx-moon', d: 'M1112 40a26 26 0 1 0 22 40 21 21 0 1 1-22-40z' }),
    svg('circle', { class: 'fx-sun', cx: 1110, cy: 66, r: 22 }),
    svg('path', { class: 'fx-skyline', d: skyline }),
    // a bell tower on the horizon, after the Giralda
    svg('path', { class: 'fx-skyline', d: 'M905 300V214h16v-8h-3v-14h6v-10l3-6 3 6v10h6v14h-3v8h16v86z' }));

  // ---------- Watchtower (background) ----------
  const tower = svg('g', { class: 'fx-building layer-watchtower', 'data-part': 'watchtower' },
    svg('path', { class: 'fx-beam', d: `M${X.watchtower - 2} 96L352 230L520 230Z` }),
    svg('path', { class: 'fx-beam is-late', d: `M${X.watchtower + 2} 96L700 196L812 196Z` }),
    svg('path', { class: 'fx-stone fx-far', d: `M586 ${GROUND}L590 128H610L614 ${GROUND}Z` }),
    svg('rect', { class: 'fx-stone fx-far', x: 580, y: 112, width: 40, height: 16 }),
    ...merlons(581, 3, 9, 6.5, 104, 9, false),
    svg('circle', { cx: X.watchtower, cy: 94, r: 30, fill: 'url(#fx-lantern)', class: 'fx-lantern-glow' }),
    svg('rect', { class: 'fx-door', x: 592, y: 84, width: 16, height: 20, rx: 1 }),
    svg('circle', { class: 'fx-lantern', cx: X.watchtower, cy: 94, r: 4.5 }),
    svg('path', { class: 'fx-trim-line', d: 'M590 150H610M589 190H611M588 240H612' }));

  // ---------- Gatehouse ----------
  const gate = svg('g', { class: 'fx-building layer-gatehouse', 'data-part': 'gatehouse' },
    svg('rect', { class: 'fx-stone', x: 62, y: 150, width: 176, height: GROUND - 150 }),
    svg('rect', { class: 'fx-shade', x: 206, y: 150, width: 32, height: GROUND - 150 }),
    ...merlons(64, 7, 16, 10, 132, 18, true),
    svg('rect', { class: 'fx-trim', x: 58, y: 146, width: 184, height: 5 }),
    ...sebka(77, 162, 7, 14, 7.6),
    svg('rect', { class: 'fx-alfiz', x: 92, y: 184, width: 116, height: GROUND - 184 }),
    ...voussoirs(X.gatehouse, 262, 38, 42, 54, 17, ['fx-vous-a', 'fx-vous-b']),
    svg('path', { class: 'fx-door', d: horseshoe(X.gatehouse, 262, 38, 42) }),
    svg('rect', { class: 'fx-trim', x: 104, y: 259, width: 10, height: 5 }),
    svg('rect', { class: 'fx-trim', x: 186, y: 259, width: 10, height: 5 }));

  // ---------- Rampart (COBOL) ----------
  const tiles = [];
  for (let tx = 330; tx <= 572; tx += 14) tiles.push(svg('path', { class: 'fx-azulejo', d: `M${tx} 241l6 6-6 6-6-6z` }));
  const courses = [];
  [272, 290, 308, 326, 344].forEach((y, row) => {
    courses.push(svg('path', { class: 'fx-course', d: `M318 ${y}H582` }));
    for (let jx = 330 + (row % 2) * 18; jx < 582; jx += 36) {
      if (jx > 414 && jx < 486) continue;
      courses.push(svg('path', { class: 'fx-course', d: `M${jx} ${y}v18` }));
    }
  });
  const portcullis = [];
  for (let px = 433; px <= 467; px += 8.5) portcullis.push(`M${px} 276V${GROUND - 4}`);
  const wall = svg('g', { class: 'fx-building layer-cobol', 'data-part': 'cobol' },
    svg('rect', { class: 'fx-stone', x: 318, y: 226, width: 264, height: GROUND - 226 }),
    ...merlons(328, 11, 14, 9, 210, 16, false),
    svg('path', { class: 'fx-trim-line', d: 'M318 236H582M318 258H582' }),
    ...tiles,
    ...courses,
    ...voussoirs(X.cobol, 308, 22, 25, 33, 11, ['fx-vous-c', 'fx-vous-b']),
    svg('path', { class: 'fx-door', d: horseshoe(X.cobol, 308, 22, 25) }),
    svg('path', { class: 'fx-portcullis', d: `${portcullis.join('')}M428 300H472M428 322H472M428 342H472` }),
    svg('rect', { class: 'fx-plaque', x: 496, y: 316, width: 70, height: 18, rx: 2 }),
    svg('text', { class: 'fx-plaque-text', x: 531, y: 328.5, 'text-anchor': 'middle' }, 'TXNGUARD'));

  // ---------- Observatory (Fortran) ----------
  const scan = svg('path', { class: 'fx-scan', d: `M${X.fortran - 3} 168L716 ${GROUND - 4}H784L${X.fortran + 3} 168Z` });
  const observatory = svg('g', { class: 'fx-building layer-fortran', 'data-part': 'fortran' },
    svg('rect', { class: 'fx-stone', x: 700, y: 196, width: 100, height: GROUND - 196 }),
    svg('rect', { class: 'fx-shade', x: 778, y: 196, width: 22, height: GROUND - 196 }),
    svg('path', { class: 'fx-stone fx-dome', d: 'M700 190C700 152 726 138 750 126C774 138 800 152 800 190Z' }),
    svg('path', { class: 'fx-rib', d: 'M750 126C738 140 722 160 716 190M750 126C746 146 740 168 737 190M750 126C754 146 760 168 763 190M750 126C762 140 778 160 784 190' }),
    svg('rect', { class: 'fx-trim', x: 694, y: 190, width: 112, height: 7 }),
    svg('rect', { class: 'fx-slit', x: 746.5, y: 142, width: 7, height: 46, rx: 3.5 }),
    svg('path', { class: 'fx-trim-line', d: 'M750 126V110' }),
    svg('circle', { class: 'fx-armillary', cx: 750, cy: 100, r: 11 }),
    svg('ellipse', { class: 'fx-armillary', cx: 750, cy: 100, rx: 11, ry: 4, transform: 'rotate(-24 750 100)' }),
    svg('path', { class: 'fx-armillary', d: 'M739 104 761 96' }),
    svg('path', { class: 'fx-door', d: horseshoe(X.fortran, 246, 9, 10.5, 270) }),
    svg('path', { class: 'fx-trim-line', d: 'M700 300H800' }),
    svg('path', { class: 'fx-trim-line', d: 'M700 306H800' }));

  // ---------- Seal archive ----------
  const medallion = svg('g', { class: 'fx-medallion' }, ...waxSeal(X.seal, 257, 21));
  const archive = svg('g', { class: 'fx-building layer-seal', 'data-part': 'seal' },
    svg('path', { class: 'fx-stone fx-roof', d: 'M948 224L1050 182L1152 224Z' }),
    svg('path', { class: 'fx-course', d: 'M972 214L1050 190L1128 214M992 220L1050 202L1108 220' }),
    svg('rect', { class: 'fx-stone', x: 962, y: 224, width: 176, height: GROUND - 224 }),
    svg('rect', { class: 'fx-shade', x: 1112, y: 224, width: 26, height: GROUND - 224 }),
    svg('rect', { class: 'fx-trim', x: 956, y: 222, width: 188, height: 6 }),
    ...[998, 1050, 1102].flatMap((cx) => [
      svg('path', { class: 'fx-door', d: horseshoe(cx, 318, 14, 16) }),
      svg('path', { class: 'fx-trim-line', d: horseshoe(cx, 318, 17.5, 20) }),
    ]),
    medallion);

  const ground = svg('g', { class: 'fx-ground' },
    svg('rect', { x: 0, y: GROUND, width: W, height: H - GROUND, class: 'fx-earth' }),
    svg('rect', { x: 0, y: GROUND, width: W, height: 8, fill: 'url(#fx-tiles)' }),
    svg('path', { class: 'fx-road', d: `M0 ${GROUND}H${W}` }));

  const label = (x, y, text, layer) => svg('text', { class: ['fx-label', `layer-${layer}`].join(' '), x, y, 'text-anchor': 'middle' }, text);
  const labels = svg('g', { class: 'fx-labels', 'aria-hidden': 'true' },
    label(X.gatehouse, 396, t('fortress.label.gatehouse'), 'gatehouse'),
    label(X.cobol, 396, t('fortress.label.cobol'), 'cobol'),
    label(X.fortran, 396, t('fortress.label.fortran'), 'fortran'),
    label(X.seal, 396, t('fortress.label.seal'), 'seal'),
    label(X.watchtower, 62, t('fortress.label.watchtower'), 'watchtower'));

  const pile = svg('g', { class: 'fx-pile' });
  const packets = svg('g', { class: 'fx-packets' });

  return { defs, sky, tower, gate, wall, observatory, scan, archive, ground, labels, pile, packets, medallion };
}

/**
 * @param {{ onProgress?: (counts: object) => void }} options
 */
export function createFortress({ onProgress } = {}) {
  const parts = drawScene();
  const titleId = `fx-title-${Math.random().toString(36).slice(2, 8)}`;
  const descId = `${titleId}-d`;
  const desc = svg('desc', { id: descId }, t('fortress.desc.idle'));
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'fortress-svg',
    role: 'img',
    'aria-labelledby': `${titleId} ${descId}`,
    preserveAspectRatio: 'xMidYMid meet',
  },
  svg('title', { id: titleId }, t('fortress.title')),
  desc,
  parts.defs, parts.sky, parts.tower, parts.gate, parts.wall, parts.scan, parts.observatory,
  parts.archive, parts.ground, parts.pile, parts.packets, parts.labels);

  let frame = 0;
  let job = null;

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function clearPackets() {
    parts.packets.replaceChildren();
    parts.pile.replaceChildren();
  }

  function finalCounts(j) {
    const by = Object.fromEntries(j.stages.map((s) => [s.name, s]));
    return {
      gatehouse: j.summary.received,
      accepted: j.summary.accepted,
      rejected: j.summary.rejected,
      flagged: j.summary.flagged,
      sealed: j.ledger.entries.length,
      stages: by,
      done: true,
    };
  }

  function pileDot(i) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    return svg('circle', { class: 'fx-pk is-rejected is-piled', cx: 362 + col * 9 + (row % 2) * 4.5, cy: GROUND - 5 - row * 8, r: 4.2 });
  }

  /** Packets in the replay: up to 48 stand for the whole batch, proportionally. */
  function sampleSizes(j) {
    const total = Math.max(1, j.summary.received);
    const n = Math.min(48, total);
    const rej = j.summary.rejected > 0 ? Math.max(1, Math.round((j.summary.rejected / total) * n)) : 0;
    const flg = j.summary.flagged > 0 ? Math.max(1, Math.round((j.summary.flagged / total) * n)) : 0;
    return { total, n, rej, flg };
  }

  function drawStatic(j) {
    clearPackets();
    const { rej } = sampleSizes(j);
    for (let i = 0; i < Math.min(rej, 18); i += 1) parts.pile.append(pileDot(i));
    if (j.summary.flagged > 0) {
      parts.packets.append(svg('circle', { class: 'fx-halo', cx: 820, cy: ROAD, r: 9 }));
      parts.packets.append(svg('circle', { class: 'fx-pk is-cobol', cx: 820, cy: ROAD, r: 4.6 }));
    }
    parts.medallion.classList.add('is-lit');
    onProgress?.(finalCounts(j));
  }

  /** Replay the job as packets crossing the fortress. */
  function animate(j) {
    stop();
    clearPackets();
    parts.medallion.classList.remove('is-lit');
    const { total, n, rej, flg } = sampleSizes(j);
    const kinds = [];
    for (let i = 0; i < n; i += 1) kinds.push(i < rej ? 'rejected' : i < rej + flg ? 'flagged' : 'accepted');
    const shuffle = rng(total * 31 + j.summary.rejected);
    for (let i = kinds.length - 1; i > 0; i -= 1) {
      const k = Math.floor(shuffle() * (i + 1));
      [kinds[i], kinds[k]] = [kinds[k], kinds[i]];
    }
    const spacing = 2000 / n;
    const speed = 0.46; // px per ms
    const packets = kinds.map((kind, i) => {
      const dot = svg('circle', { class: 'fx-pk is-gatehouse', cx: -20, cy: ROAD, r: 4.6 });
      const halo = kind === 'flagged' ? svg('circle', { class: 'fx-halo', cx: -20, cy: ROAD, r: 9, opacity: 0 }) : null;
      if (halo) parts.packets.append(halo);
      parts.packets.append(dot);
      return { kind, dot, halo, start: i * spacing + shuffle() * spacing * 0.6, phase: 'travel', bounceAt: 0, wobble: (shuffle() - 0.5) * 3 };
    });
    const seen = { gate: 0, wallOk: 0, rejected: 0, flagged: 0, sealed: 0 };
    let piled = 0;
    // Scale what the packets have shown so far to the job's real totals.
    const part = (count, of, outOf) => Math.min(of, Math.round((count / Math.max(1, outOf)) * of));
    const report = () => {
      onProgress?.({
        gatehouse: part(seen.gate, j.summary.received, n),
        accepted: part(seen.wallOk, j.summary.accepted, n - rej),
        rejected: part(seen.rejected, j.summary.rejected, rej),
        flagged: part(seen.flagged, j.summary.flagged, flg),
        sealed: part(seen.sealed + seen.rejected, j.ledger.entries.length, n),
        stages: Object.fromEntries(j.stages.map((s) => [s.name, s])),
        done: false,
      });
    };
    const pulse = (el, keyframes, duration) => {
      try {
        el.animate(keyframes, { duration, easing: 'ease-out' });
      } catch {
        /* WAAPI unavailable: skip the flourish */
      }
    };
    let last = -1;
    const t0 = performance.now();
    const step = (now) => {
      const elapsed = now - t0;
      let active = 0;
      for (const p of packets) {
        const local = elapsed - p.start;
        if (local < 0) {
          active += 1;
          continue;
        }
        if (p.phase === 'done') continue;
        active += 1;
        if (p.phase === 'travel') {
          const x = -20 + speed * local;
          const y = ROAD + Math.sin(local / 140) * 0.8 + p.wobble * 0.2;
          if (x >= 20 && !p.passedGate) {
            p.passedGate = true;
            seen.gate += 1;
          }
          if (p.kind === 'rejected' && x >= WALL_FACE) {
            p.phase = 'bounce';
            p.bounceAt = elapsed;
            p.dot.setAttribute('class', 'fx-pk is-rejected');
            pulse(parts.wall.querySelector('.fx-portcullis'), [{ opacity: 1 }, { opacity: 0.35 }], 420);
            continue;
          }
          if (x >= GATE_EXIT && !p.passedWall) {
            p.passedWall = true;
            seen.wallOk += 1;
            p.dot.setAttribute('class', 'fx-pk is-cobol');
          }
          if (x >= X.fortran && !p.passedFortran) {
            p.passedFortran = true;
            if (p.kind === 'flagged') {
              seen.flagged += 1;
              p.halo.setAttribute('opacity', '1');
              pulse(parts.scan, [{ opacity: 0 }, { opacity: 0.32 }, { opacity: 0 }], 520);
            }
          }
          if (x >= SEAL_DOOR) {
            p.phase = 'sealing';
            p.sealAt = elapsed;
            seen.sealed += 1;
            p.dot.setAttribute('class', 'fx-pk is-seal');
            pulse(parts.medallion, [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], 360);
            continue;
          }
          p.dot.setAttribute('cx', x.toFixed(1));
          p.dot.setAttribute('cy', y.toFixed(1));
          if (p.halo) {
            p.halo.setAttribute('cx', x.toFixed(1));
            p.halo.setAttribute('cy', y.toFixed(1));
          }
        } else if (p.phase === 'bounce') {
          const tau = Math.min(1, (elapsed - p.bounceAt) / 640);
          const x = WALL_FACE - 58 * tau;
          const target = pileTarget(piled);
          const y = ROAD - 44 * Math.sin(Math.PI * tau) + (target.cy - ROAD) * tau;
          p.dot.setAttribute('cx', (x + (target.cx - (WALL_FACE - 58)) * tau).toFixed(1));
          p.dot.setAttribute('cy', y.toFixed(1));
          if (tau >= 1) {
            p.phase = 'done';
            seen.rejected += 1;
            p.dot.remove();
            if (piled < 18) parts.pile.append(pileDot(piled));
            piled += 1;
          }
        } else if (p.phase === 'sealing') {
          const tau = Math.min(1, (elapsed - p.sealAt) / 260);
          p.dot.setAttribute('r', (4.6 * (1 - tau)).toFixed(2));
          p.dot.setAttribute('cy', (ROAD - 6 * tau).toFixed(1));
          if (p.halo) p.halo.setAttribute('opacity', String(1 - tau));
          if (tau >= 1) {
            p.phase = 'done';
            p.dot.remove();
            p.halo?.remove();
          }
        }
      }
      const signature = seen.gate + seen.wallOk * 100 + seen.rejected * 10000 + seen.flagged * 1e6 + seen.sealed * 1e8;
      if (signature !== last) {
        last = signature;
        report();
      }
      if (active > 0) frame = requestAnimationFrame(step);
      else {
        frame = 0;
        parts.medallion.classList.add('is-lit');
        if (j.summary.flagged > 0) {
          parts.packets.append(svg('circle', { class: 'fx-halo', cx: 820, cy: ROAD, r: 9 }));
          parts.packets.append(svg('circle', { class: 'fx-pk is-cobol', cx: 820, cy: ROAD, r: 4.6 }));
        }
        onProgress?.(finalCounts(j));
      }
    };
    frame = requestAnimationFrame(step);
  }

  function pileTarget(i) {
    const col = i % 6;
    const row = Math.floor(Math.min(i, 17) / 6);
    return { cx: 362 + col * 9 + (row % 2) * 4.5, cy: GROUND - 5 - row * 8 };
  }

  function describe(j) {
    if (!j) return t('fortress.desc.idle');
    return t('fortress.desc.job', {
      received: j.summary.received,
      rejected: j.summary.rejected,
      flagged: j.summary.flagged,
      entries: j.ledger.entries.length,
      verifiers: j.ledger.verification.verifiedBy.length,
    });
  }

  return {
    el: root,
    setJob(next, { animateIt = true } = {}) {
      job = next;
      desc.textContent = describe(next);
      if (!next) {
        stop();
        clearPackets();
        parts.medallion.classList.remove('is-lit');
        onProgress?.(null);
        return;
      }
      if (animateIt && !reducedMotion()) animate(next);
      else drawStatic(next);
    },
    replay() {
      if (job) this.setJob(job, { animateIt: true });
    },
    destroy() {
      stop();
    },
  };
}
