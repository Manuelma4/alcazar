// Lookout · Overview: hero, the fortress map, KPI tiles and runtime status.

import { h, mount } from '../dom.mjs';
import { icon } from '../icons.mjs';
import { t } from '../strings.mjs';
import { store } from '../store.mjs';
import { href } from '../router.mjs';
import { runDemo } from '../actions.mjs';
import { createFortress } from '../fortress.mjs';
import { formatInt, formatMs, capitalize } from '../format.mjs';
import { jobKpis } from '../jobui.mjs';
import { button, card, chip, errorBanner, kpi, layerChip, pill, statusLine, setBusy } from '../ui.mjs';

const CHECK_ICON = { pass: 'check-circle', fail: 'x-circle' };

export function render() {
  const cleanups = [];

  // ---------- hero ----------
  // runDemo announces its progress; failures arrive as an alert banner.
  const status = statusLine({ live: false });
  const errorSlot = h('div');
  const demoBtn = button({ label: t('overview.cta.demo'), icon: 'play', variant: 'primary', onClick: onDemo });
  async function onDemo() {
    if (store.get('batchBusy')) return;
    setBusy(demoBtn, true, t('overview.cta.demoBusy'));
    status.set('busy', t('demo.generating'));
    mount(errorSlot);
    const job = await runDemo();
    setBusy(demoBtn, false);
    if (job) {
      const total = job.stages.reduce((sum, s) => sum + s.ms, 0);
      status.set('ok', t('overview.demo.done', {
        n: formatInt(job.summary.received), ms: formatMs(total),
        accepted: formatInt(job.summary.accepted), rejected: formatInt(job.summary.rejected), flagged: formatInt(job.summary.flagged),
      }));
    } else {
      status.set('error', t('overview.demo.failed'));
      const error = store.get('batchError');
      if (error) mount(errorSlot, errorBanner(error));
    }
  }

  const runtimePanel = h('div', { class: 'hero-status' });
  const renderRuntime = () => {
    const health = store.get('health');
    const error = store.get('healthError');
    if (error) {
      mount(runtimePanel, errorBanner(error, { title: t('health.unreachable') }));
      return;
    }
    if (!health) {
      mount(runtimePanel, h('p', { class: 'status-line is-busy' }, icon('spinner', { size: 16 }), t('health.checking')));
      return;
    }
    const passed = health.selftest.checks.filter((c) => c.status === 'pass').length;
    const allPass = health.selftest.status === 'pass';
    mount(runtimePanel,
      h('div', { class: 'hero-status-head' },
        h('p', { class: 'eyebrow' }, t('overview.runtime.title')),
        chip(health.status === 'ok' ? t('overview.runtime.ok') : t('overview.runtime.degraded'), { tone: health.status === 'ok' ? 'ok' : 'warn', dot: true })),
      h('div', { class: 'pills' },
        pill({ icon: 'gatehouse', label: t('overview.runtime.gatehouse'), value: health.version || '\u{2014}', tone: 'gold' }),
        pill({ icon: allPass ? 'shield' : 'shield-alert', label: t('overview.runtime.selftest'), value: `${passed}/${health.selftest.checks.length}`, tone: allPass ? 'ok' : 'danger' }),
        pill({ icon: 'terminal', label: t('overview.runtime.node'), value: health.runtime.node || '\u{2014}' }),
        pill({ icon: 'rampart', label: t('overview.runtime.cobol'), value: health.runtime.cobol || '\u{2014}' }),
        pill({ icon: 'observatory', label: t('overview.runtime.fortran'), value: health.runtime.fortran || '\u{2014}' }),
        pill({ icon: 'key', label: t('overview.runtime.key'), value: health.keySource ? capitalize(health.keySource) : '\u{2014}' }),
        pill({ icon: health.demo ? 'flask' : 'lock', label: t('overview.runtime.demo'), value: health.demo ? t('common.on') : t('common.off'), tone: health.demo ? 'warn' : 'ok' })),
      h('ul', { class: 'selftest-list', 'aria-label': t('overview.runtime.checks') },
        health.selftest.checks.map((c) => h('li', { class: c.status === 'pass' ? 'is-pass' : 'is-fail' },
          icon(CHECK_ICON[c.status] ?? 'info', { size: 15 }),
          h('span', { class: 'selftest-name' }, t.has(`selftest.${c.name}`) ? t(`selftest.${c.name}`) : c.name),
          h('span', { class: 'sr-only' }, c.status === 'pass' ? t('common.pass') : t('common.fail'))))));
  };
  renderRuntime();
  cleanups.push(store.on(['health', 'healthError'], renderRuntime));

  const hero = h('section', { class: 'hero card is-accent', 'aria-labelledby': 'view-title' },
    h('div', { class: 'hero-copy' },
      h('p', { class: 'eyebrow' }, icon('khatam', { size: 14 }), t('overview.eyebrow')),
      h('h1', { class: 'view-title', id: 'view-title', tabindex: '-1' }, t('overview.title')),
      h('p', { class: 'lead' }, t('overview.lead')),
      h('div', { class: 'hero-actions row' },
        demoBtn,
        h('a', { class: 'btn', href: href('siege') }, icon('siege', { size: 18 }), h('span', null, t('overview.cta.siege'))),
        h('a', { class: 'btn btn-ghost', href: href('watchtower') }, icon('watchtower', { size: 18 }), h('span', null, t('overview.cta.scan')))),
      status.el,
      errorSlot),
    runtimePanel);

  // ---------- fortress ----------
  const stageEls = {};
  const stageTile = (key, layer, iconName) => {
    const value = h('p', { class: 'stage-value' }, '\u{2014}');
    const sub = h('p', { class: 'stage-sub' }, t(`overview.stage.${key}.idle`));
    const ms = h('span', { class: 'stage-ms' });
    stageEls[key] = { value, sub, ms };
    return h('li', { class: ['stage', `layer-${layer}`] },
      h('p', { class: 'stage-name' }, icon(iconName, { size: 16 }), h('span', null, t(`overview.stage.${key}`)), ms),
      value, sub);
  };
  const strip = h('ol', { class: 'stage-strip', 'aria-label': t('overview.stage.label') },
    stageTile('gatehouse', 'gatehouse', 'gatehouse'),
    stageTile('txnguard', 'cobol', 'rampart'),
    stageTile('fraudscan', 'fortran', 'observatory'),
    stageTile('seal', 'seal', 'seal'));

  const setStage = (key, value, sub, ms) => {
    stageEls[key].value.textContent = value;
    stageEls[key].sub.textContent = sub;
    stageEls[key].ms.textContent = ms ?? '';
  };

  const fortress = createFortress({
    onProgress(counts) {
      if (!counts) {
        for (const key of Object.keys(stageEls)) setStage(key, '\u{2014}', t(`overview.stage.${key}.idle`));
        return;
      }
      const job = store.get('job');
      const st = counts.stages ?? {};
      const ms = (name) => (counts.done && st[name] ? formatMs(st[name].ms) : '');
      setStage('gatehouse', formatInt(counts.gatehouse), t('overview.stage.gatehouse.sub'), ms('gatehouse'));
      setStage('txnguard', formatInt(counts.accepted), t('overview.stage.txnguard.sub', {
        rejected: formatInt(counts.rejected), rc: st.txnguard?.rc ?? '\u{2014}',
      }), ms('txnguard'));
      setStage('fraudscan', formatInt(counts.flagged), t('overview.stage.fraudscan.sub', { scored: formatInt(job?.risk.n ?? 0) }), ms('fraudscan'));
      const v = job?.ledger.verification;
      let sealSub = t('overview.stage.seal.sub');
      if (counts.done && v) {
        if (v.stale) sealSub = t('overview.stage.seal.stale');
        else sealSub = v.valid ? t('overview.stage.seal.valid', { n: v.verifiedBy.length }) : t('overview.stage.seal.broken', { reason: v.reason ?? '' });
      }
      setStage('seal', formatInt(counts.sealed), sealSub, ms('seal'));
    },
  });
  cleanups.push(() => fortress.destroy());

  const replayBtn = button({ label: t('overview.fortress.replay'), icon: 'replay', size: 'sm', onClick: () => fortress.replay() });
  const legend = h('ul', { class: 'fx-legend', 'aria-label': t('overview.legend.label') },
    h('li', null, h('span', { class: 'fx-key is-gatehouse' }), t('overview.legend.entering')),
    h('li', null, h('span', { class: 'fx-key is-cobol' }), t('overview.legend.validated')),
    h('li', null, h('span', { class: 'fx-key is-rejected' }), t('overview.legend.rejected')),
    h('li', null, h('span', { class: 'fx-key is-flagged' }), t('overview.legend.flagged')),
    h('li', null, h('span', { class: 'fx-key is-seal' }), t('overview.legend.sealed')));

  const fortressCard = card({
    title: t('overview.fortress.title'),
    sub: t('overview.fortress.sub'),
    actions: replayBtn,
    className: 'fortress-card',
    body: [h('figure', { class: 'fortress' }, fortress.el, h('figcaption', { class: 'sr-only' }, t('overview.fortress.caption'))), legend, strip],
  });

  // ---------- KPIs ----------
  const kpiRow = h('div');
  const renderKpis = () => {
    const job = store.get('job');
    replayBtn.disabled = !job;
    if (job) {
      mount(kpiRow, jobKpis(job));
      return;
    }
    mount(kpiRow, h('div', { class: 'kpis' },
      kpi({ label: t('kpi.received'), empty: true, icon: 'gatehouse', layer: 'gatehouse', sub: t('kpi.empty') }),
      kpi({ label: t('kpi.accepted'), empty: true, icon: 'rampart', layer: 'cobol' }),
      kpi({ label: t('kpi.rejected'), empty: true, icon: 'x-circle', layer: 'cobol' }),
      kpi({ label: t('kpi.flagged'), empty: true, icon: 'observatory', layer: 'fortran' }),
      kpi({ label: t('kpi.ledger'), empty: true, icon: 'seal', layer: 'seal' }),
      kpi({ label: t('kpi.benford'), empty: true, icon: 'zscore', layer: 'fortran' })));
  };

  // ---------- explore ----------
  const explore = h('div', { class: 'grid grid-3 explore' },
    exploreCard('transactions', 'coins', 'gatehouse'),
    exploreCard('seal', 'seal', 'seal'),
    exploreCard('siege', 'siege', 'cobol'),
    exploreCard('watchtower', 'watchtower', 'watchtower'),
    exploreCard('defenses', 'shield', 'fortran'),
    layersCard());

  const el = h('div', { class: 'view view-overview' },
    hero,
    fortressCard,
    h('h2', { class: 'section-title' }, t('overview.kpis.title')),
    kpiRow,
    h('h2', { class: 'section-title' }, t('overview.explore.title')),
    explore);

  // ---------- wiring ----------
  let lastReplay = store.get('replayToken');
  let lastJob = store.get('job');
  const onJob = () => {
    const job = store.get('job');
    const token = store.get('replayToken');
    if (job === lastJob && token === lastReplay) return;
    const animateIt = token !== lastReplay;
    lastJob = job;
    lastReplay = token;
    renderKpis();
    fortress.setJob(job, { animateIt });
  };
  renderKpis();
  requestAnimationFrame(() => fortress.setJob(store.get('job'), { animateIt: false }));
  cleanups.push(store.on(['job', 'replayToken'], onJob));
  if (store.get('batchBusy')) setBusy(demoBtn, true, t('overview.cta.demoBusy'));
  cleanups.push(store.on('batchBusy', (busy) => {
    if (busy) setBusy(demoBtn, true, t('overview.cta.demoBusy'));
    else setBusy(demoBtn, false);
  }));

  return { el, cleanup: () => cleanups.forEach((fn) => fn()) };
}

function exploreCard(id, iconName, layer) {
  return h('a', { class: ['explore-card', `layer-${layer}`], href: href(id) },
    h('span', { class: 'explore-icon' }, icon(iconName, { size: 22 })),
    h('span', { class: 'explore-text' },
      h('span', { class: 'explore-title' }, t(`nav.${id}`), h('span', { class: 'explore-sub' }, ` \u{00B7} ${t(`nav.${id}.sub`)}`)),
      h('span', { class: 'explore-body' }, t(`overview.explore.${id}`))),
    icon('arrow-right', { size: 18, class: 'explore-arrow' }));
}

function layersCard() {
  return h('div', { class: 'explore-card is-static' },
    h('span', { class: 'explore-text' },
      h('span', { class: 'explore-title' }, t('overview.layers.title')),
      h('span', { class: 'layer-chips row', css: { '--row-gap': '6px', 'margin-top': '8px' } },
        layerChip('gatehouse'), layerChip('cobol'), layerChip('fortran'), layerChip('seal'), layerChip('watchtower')),
      h('span', { class: 'explore-body', css: { 'margin-top': '8px' } }, t('overview.layers.body'))));
}
