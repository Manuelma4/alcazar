// Lookout · ui: shared components. Everything is built with h()/svg();
// untrusted values only ever arrive as text.

import { h, id as uid } from './dom.mjs';
import { icon } from './icons.mjs';
import { t } from './strings.mjs';
import { splitInvisible } from './format.mjs';
import { toast } from './live.mjs';

export const LAYERS = Object.freeze({
  gatehouse: { icon: 'gatehouse' },
  cobol: { icon: 'rampart' },
  fortran: { icon: 'observatory' },
  seal: { icon: 'seal' },
  watchtower: { icon: 'watchtower' },
});

export function layerName(layer) {
  return t(`layer.${layer}`);
}

// ---------- layout ----------
export function viewHeader({ eyebrow, title, lead, actions }) {
  return h('header', { class: 'view-head' },
    eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
    h('div', { class: 'row', css: { '--row-gap': '16px' } },
      h('h1', { class: 'view-title grow', tabindex: '-1', id: 'view-title' }, title),
      actions ? h('div', { class: 'card-actions' }, actions) : null),
    ornament(),
    lead ? h('p', { class: 'lead' }, lead) : null);
}

export function ornament() {
  return h('div', { class: 'ornament', 'aria-hidden': 'true' }, icon('khatam', { size: 14 }));
}

/**
 * A titled region. The title becomes the accessible name of the section.
 */
export function card({ title, sub, eyebrow, actions, body = [], className, level = 2, accent = false, labelId }) {
  const headingId = labelId ?? uid('card');
  const Heading = `h${level}`;
  return h('section', { class: ['card', accent && 'is-accent', className], 'aria-labelledby': title ? headingId : undefined },
    title || actions ? h('div', { class: 'card-head' },
      h('div', { class: 'grow' },
        eyebrow ? h('p', { class: 'eyebrow', css: { 'margin-bottom': '6px' } }, eyebrow) : null,
        title ? h(Heading, { class: 'card-title', id: headingId }, title) : null,
        sub ? h('p', { class: 'card-sub' }, sub) : null),
      actions ? h('div', { class: 'card-actions' }, actions) : null) : null,
    body);
}

// ---------- controls ----------
export function button({ label, icon: iconName, variant = 'secondary', size, onClick, type = 'button', disabled = false, title, attrs = {}, iconAfter = false, focusKey }) {
  const classes = ['btn', variant !== 'secondary' && `btn-${variant}`, size && `btn-${size}`];
  const glyph = iconName ? icon(iconName, { size: size === 'sm' ? 16 : size === 'xs' ? 14 : 18 }) : null;
  // While busy a button stays focusable (aria-disabled) but ignores clicks.
  const guarded = onClick ? (event) => {
    if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }
    onClick(event);
  } : undefined;
  return h('button', { type, class: classes, disabled, title, dataset: focusKey ? { focusKey } : undefined, on: { click: guarded }, ...attrs },
    iconAfter ? null : glyph, label ? h('span', null, label) : null, iconAfter ? glyph : null);
}

export function iconButton({ label, icon: iconName, onClick, size = 'sm', variant = 'ghost', attrs = {} }) {
  return h('button', {
    type: 'button',
    class: ['btn', `btn-${variant}`, 'btn-icon', size && `btn-${size}`],
    'aria-label': label,
    title: label,
    on: { click: onClick },
    ...attrs,
  }, icon(iconName, { size: size === 'xs' ? 14 : 16 }));
}

/**
 * Put a button into a busy state (spinner + aria-busy) and back. The button
 * keeps focus while busy: it is aria-disabled, not disabled.
 */
const busyIcons = new WeakMap();
export function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  const label = btn.querySelector('span');
  if (busy) {
    if (btn.classList.contains('is-busy')) return;
    btn.dataset.label = label?.textContent ?? '';
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('aria-disabled', 'true');
    const original = btn.querySelector('svg');
    const spinner = icon('spinner', { size: 18 });
    if (original) {
      busyIcons.set(btn, original);
      original.replaceWith(spinner);
    } else {
      btn.prepend(spinner);
    }
    if (busyLabel && label) label.textContent = busyLabel;
  } else {
    if (!btn.classList.contains('is-busy')) return;
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-disabled');
    const spinner = btn.querySelector('svg');
    const original = busyIcons.get(btn);
    if (spinner && original) spinner.replaceWith(original);
    else spinner?.remove();
    busyIcons.delete(btn);
    if (btn.dataset.label !== undefined && label) label.textContent = btn.dataset.label;
  }
}

/**
 * Re-render `root` without dropping keyboard focus: the focused control is
 * found again after `render()` by its data-focus-key (or id).
 */
export function preserveFocus(root, render) {
  const active = document.activeElement;
  const inside = active && active !== document.body && root.contains(active);
  const key = inside ? active.dataset?.focusKey ?? (active.id ? `#${active.id}` : null) : null;
  render();
  if (!key) return;
  const next = key.startsWith('#') ? root.querySelector(`#${CSS.escape(key.slice(1))}`) : root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (next && !next.disabled) next.focus({ preventScroll: true });
}

export function chip(content, { tone, icon: iconName, mono = false, title, className, href, dot = false } = {}) {
  const tag = href ? 'a' : 'span';
  const attrs = { class: ['chip', tone && `tone-${tone}`, mono && 'mono', className], title };
  if (href) Object.assign(attrs, { href, target: '_blank', rel: 'noopener noreferrer' });
  return h(tag, attrs, dot ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null, iconName ? icon(iconName, { size: 14 }) : null, content);
}

export function layerChip(layer, content) {
  const meta = LAYERS[layer] ?? LAYERS.gatehouse;
  return h('span', { class: ['chip', 'layer', `layer-${layer}`] }, icon(meta.icon, { size: 14 }), content ?? layerName(layer));
}

export function sevChip(severity, content) {
  return h('span', { class: ['chip', 'sev', `sev-${severity}`] }, h('span', { class: 'dot', 'aria-hidden': 'true' }), content ?? t(`severity.${severity}`));
}

/** CWE chip linking to the MITRE definition (opens in a new tab). */
export function cweChip(cwe) {
  const match = /^CWE-(\d{1,5})$/.exec(String(cwe ?? ''));
  if (!match) return null;
  return chip(cwe, {
    mono: true,
    href: `https://cwe.mitre.org/data/definitions/${match[1]}.html`,
    title: t('common.cweLink', { cwe }),
    className: 'square',
  });
}

export function pill({ icon: iconName = 'info', label, value, tone, title }) {
  return h('span', { class: ['pill', tone && `tone-${tone}`], title },
    icon(iconName, { size: 15 }),
    label ? h('span', { class: 'pill-label' }, label) : null,
    value !== undefined && value !== null ? h('span', { class: 'pill-value' }, value) : null);
}

export function kpi({ label, value, sub, layer, icon: iconName, empty = false, title, text = false }) {
  return h('div', { class: ['kpi', layer && `layer-${layer}`], title },
    h('p', { class: 'kpi-label' }, iconName ? icon(iconName, { size: 15 }) : null, label),
    h('p', { class: ['kpi-value', empty && 'is-empty', text && !empty && 'is-text'] }, empty ? '\u{2014}' : value),
    sub ? h('p', { class: 'kpi-sub' }, sub) : null);
}

/**
 * Segmented control on native radio inputs (arrow keys, form semantics and
 * screen-reader support for free).
 */
export function segmented({ name, legend, options, value, onChange, iconOnly = false, className }) {
  const groupName = `${name}-${uid('seg')}`;
  return h('fieldset', { class: ['seg', iconOnly && 'icon-only', className] },
    h('legend', null, legend),
    options.map((opt) => h('label', { class: 'seg-opt', title: iconOnly ? opt.label : opt.title },
      h('input', {
        type: 'radio',
        name: groupName,
        value: opt.value,
        dataset: { focusKey: `${name}:${opt.value}` },
        props: { checked: opt.value === value },
        'aria-label': iconOnly ? opt.label : undefined,
        on: { change: (event) => { if (event.target.checked) onChange(opt.value); } },
      }),
      h('span', null,
        opt.icon ? icon(opt.icon, { size: 15 }) : null,
        iconOnly ? null : opt.label,
        opt.count !== undefined ? h('span', { class: 'count' }, opt.count) : null))));
}

export function selectField({ label, value, options, onChange, hint, idOverride }) {
  const fieldId = idOverride ?? uid('sel');
  return h('div', { class: 'field' },
    h('label', { class: 'label', for: fieldId }, label),
    h('span', { class: 'select-wrap' },
      h('select', { class: 'select', id: fieldId, on: { change: (e) => onChange(e.target.value) } },
        options.map((opt) => opt.group
          ? h('optgroup', { label: opt.group }, opt.options.map((o) => h('option', { value: o.value, props: { selected: o.value === value } }, o.label)))
          : h('option', { value: opt.value, props: { selected: opt.value === value } }, opt.label)))),
    hint ? h('p', { class: 'hint' }, hint) : null);
}

export function inputField({ label, value = '', type = 'text', onInput, hint, attrs = {}, mono = false, idOverride }) {
  const fieldId = idOverride ?? uid('in');
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const input = h('input', {
    class: ['input', mono && 'mono'],
    id: fieldId,
    type,
    'aria-describedby': hintId,
    props: { value: String(value) },
    on: { input: (e) => onInput?.(e.target.value, e.target) },
    ...attrs,
  });
  return {
    el: h('div', { class: 'field' },
      h('label', { class: 'label', for: fieldId }, label),
      input,
      hint ? h('p', { class: 'hint', id: hintId }, hint) : null),
    input,
  };
}

export function copyButton(value, { label = t('common.copy'), what } = {}) {
  const btn = iconButton({
    label: what ? t('common.copyWhat', { what }) : label,
    icon: 'copy',
    size: 'xs',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(String(value));
        btn.classList.add('is-done');
        btn.replaceChildren(icon('check', { size: 14 }));
        toast(what ? t('common.copiedWhat', { what }) : t('common.copied'));
        setTimeout(() => {
          btn.classList.remove('is-done');
          btn.replaceChildren(icon('copy', { size: 14 }));
        }, 1600);
      } catch {
        toast(t('common.copyFailed'), { tone: 'danger' });
      }
    },
  });
  btn.classList.add('copy-btn');
  return btn;
}

export function banner({ tone = 'gold', icon: iconName = 'info', title, body, actions, role }) {
  return h('div', { class: ['banner', `tone-${tone}`], role },
    icon(iconName, { size: 22 }),
    h('div', null,
      title ? h('p', { class: 'banner-title' }, title) : null,
      body ? h('div', { class: 'banner-body' }, body) : null),
    actions ? h('div', { class: 'banner-actions card-actions' }, actions) : null);
}

export function emptyState({ icon: iconName = 'lookout', title, body, action }) {
  return h('div', { class: 'empty' },
    icon(iconName, { size: 44 }),
    h('p', { class: 'empty-title' }, title),
    body ? h('p', { class: 'empty-body' }, body) : null,
    action ?? null);
}

/** Describe an ApiError (or any error) as a danger banner. */
export function errorBanner(error, { title, actions } = {}) {
  const code = error?.code ?? 'ERROR';
  const known = t.has(`perror.${code}`) ? t(`perror.${code}`) : null;
  const details = [];
  if (error?.status) details.push(h('span', null, t('error.status', { status: error.status })));
  if (error?.field) details.push(h('span', null, t('error.field'), ' ', h('code', { class: 'mono' }, error.field)));
  if (Number.isInteger(error?.index)) details.push(h('span', null, t('error.index', { index: error.index, line: error.index + 1 })));
  return banner({
    tone: 'danger',
    icon: 'shield-alert',
    role: 'alert',
    title: title ?? (error?.network ? t('error.unreachable') : t('error.refused')),
    body: [
      h('div', { class: 'row', css: { '--row-gap': '8px' } },
        error?.network ? null : chip(code, { mono: true, tone: 'danger' }),
        h('span', null, escapedText(error?.message ?? String(error)))),
      known ? h('p', { class: 'muted small', css: { 'margin-top': '6px' } }, known) : null,
      details.length ? h('div', { class: 'error-detail row' }, details) : null,
    ],
    actions,
  });
}

/** Render untrusted text with invisible / bidi characters shown as escapes. */
export function escapedText(value, { className } = {}) {
  const parts = splitInvisible(value);
  return h('span', { class: className, dir: 'ltr' }, parts.map((p) => (p.escaped
    ? h('span', { class: 'esc', title: t('common.invisibleChar') }, p.text)
    : p.text)));
}

/** A live status line (role=status) for long operations. */
export function statusLine() {
  const iconSlot = h('span', { class: 'status-icon' });
  const textSlot = h('span', null);
  const el = h('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' }, iconSlot, textSlot);
  return {
    el,
    set(state, message) {
      el.className = ['status-line', state === 'busy' && 'is-busy', state === 'ok' && 'tone-ok', state === 'error' && 'tone-danger'].filter(Boolean).join(' ');
      iconSlot.replaceChildren(state ? icon(state === 'busy' ? 'spinner' : state === 'ok' ? 'check-circle' : state === 'error' ? 'alert' : 'info', { size: 16 }) : '');
      textSlot.textContent = message ?? '';
    },
  };
}

export function meter(ratio, { color, label } = {}) {
  const value = `${Math.max(0, Math.min(1, Number(ratio) || 0)) * 100}%`;
  return h('span', { class: 'meter', css: { '--value': value, '--meter': color }, role: label ? 'img' : undefined, 'aria-label': label },
    h('span', null));
}

export function disclosure({ summary, body, open = false, className }) {
  return h('details', { class: ['disclosure', className], props: { open } },
    h('summary', null, icon('chevron-right', { size: 15, class: 'chev' }), summary),
    h('div', { class: 'disclosure-body' }, body));
}

/**
 * A side drawer on the native <dialog>: focus is trapped and restored, Esc
 * closes it, the page behind is inert.
 */
export function openDrawer({ title, eyebrow, body, onClose }) {
  const headingId = uid('drawer');
  const dialog = h('dialog', { class: 'drawer', 'aria-labelledby': headingId },
    h('div', { class: 'drawer-head' },
      h('div', { class: 'grow' },
        eyebrow ? h('p', { class: 'eyebrow', css: { 'margin-bottom': '6px' } }, eyebrow) : null,
        h('h2', { id: headingId }, title)),
      iconButton({ label: t('common.close'), icon: 'x', size: 'sm', onClick: () => dialog.close() })),
    h('div', { class: 'drawer-body' }, body));
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * A data table. Columns: { key, label, num?, render?(row) }.
 * `stack` turns rows into labelled cards on phones (roles kept explicit so the
 * table semantics survive the CSS display change).
 */
export function dataTable({ caption, columns, rows, stack = false, rowClass, onRowClick, rowLabel, className }) {
  return h('div', { class: ['table-wrap', className] },
    h('table', { class: ['data', stack && 'is-stacked'], role: stack ? 'table' : undefined },
      caption ? h('caption', { class: 'sr-only' }, caption) : null,
      h('thead', { role: stack ? 'rowgroup' : undefined },
        h('tr', { role: stack ? 'row' : undefined },
          columns.map((col) => h('th', { scope: 'col', class: col.num ? 'num' : undefined, role: stack ? 'columnheader' : undefined }, col.label)))),
      h('tbody', { role: stack ? 'rowgroup' : undefined },
        rows.map((row) => {
          const tr = h('tr', {
            role: stack ? 'row' : undefined,
            class: [rowClass?.(row), onRowClick && 'is-clickable'],
          }, columns.map((col, index) => {
            const content = col.render ? col.render(row) : row[col.key];
            const cellTag = index === 0 && rowLabel ? 'th' : 'td';
            return h(cellTag, {
              class: [col.num && 'num', col.className],
              'data-label': col.label,
              scope: cellTag === 'th' ? 'row' : undefined,
              role: stack ? (cellTag === 'th' ? 'rowheader' : 'cell') : undefined,
            }, content);
          }));
          if (onRowClick) tr.addEventListener('click', (event) => {
            if (event.target.closest('a, button, input, select, textarea')) return;
            onRowClick(row);
          });
          return tr;
        }))));
}

export function fieldRow(label, value) {
  return [h('dt', null, label), h('dd', null, value)];
}
