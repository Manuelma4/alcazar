// Lookout · editor: a monospace source editor for Watchtower. A plain
// <textarea> (native editing, undo, IME, screen readers) with a synchronized
// line-number gutter, per-line severity markers, a 3270 column ruler and the
// fixed-form column guides (COBOL areas A/B, the column-72 margin).
// Scroll sync uses CSS custom properties set through the CSSOM.

import { h } from './dom.mjs';
import { ruler } from './records.mjs';
import { t } from './strings.mjs';

const LINE = 20; // px — must match .editor line-height
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Column guides per source form (1-based column after which a guide sits). */
const GUIDES = {
  'cobol-fixed': [{ after: 6, cls: 'is-seq' }, { after: 7, cls: 'is-ind' }, { after: 11, cls: 'is-a' }, { after: 72, cls: 'is-margin' }],
  'fortran-fixed': [{ after: 5, cls: 'is-seq' }, { after: 6, cls: 'is-ind' }, { after: 72, cls: 'is-margin' }],
  free: [],
};

export function createEditor({ value = '', label, describedBy, onInput }) {
  const gutterInner = h('div', { class: 'gutter-inner' });
  const marksLayer = h('div', { class: 'editor-marks' });
  const guidesLayer = h('div', { class: 'editor-guides' });
  const rulerInner = h('div', { class: 'editor-ruler-inner' }, ruler(160));
  const textarea = h('textarea', {
    class: 'editor-input',
    wrap: 'off',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    'aria-label': label,
    'aria-describedby': describedBy,
    'aria-multiline': 'true',
    props: { value },
  });
  const el = h('div', { class: 'editor', dataset: { mode: 'free' } },
    h('div', { class: 'editor-ruler', 'aria-hidden': 'true', title: t('wt.editor.ruler') }, h('span', { class: 'editor-ruler-pad' }), rulerInner),
    h('div', { class: 'editor-body' },
      h('div', { class: 'editor-gutter', 'aria-hidden': 'true' }, gutterInner),
      h('div', { class: 'editor-code' },
        h('div', { class: 'editor-layer', 'aria-hidden': 'true' }, guidesLayer, marksLayer),
        textarea)));

  let lineCount = 0;
  let markers = new Map();

  const sync = () => {
    el.style.setProperty('--sx', `${-textarea.scrollLeft}px`);
    el.style.setProperty('--sy', `${-textarea.scrollTop}px`);
  };

  const renderGutter = () => {
    const n = Math.max(1, textarea.value.split('\n').length);
    if (n === lineCount && !gutterInner.dataset.dirty) return;
    lineCount = n;
    delete gutterInner.dataset.dirty;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i += 1) {
      const sev = markers.get(i);
      frag.append(h('span', { class: ['gutter-line', sev && `has-${sev}`] }, sev ? h('span', { class: `gutter-dot sev-${sev}` }) : null, String(i)));
    }
    gutterInner.replaceChildren(frag);
    el.style.setProperty('--gutter-ch', String(Math.max(3, String(n).length + 2)));
  };

  const renderMarks = () => {
    const frag = document.createDocumentFragment();
    for (const [line, sev] of markers) {
      frag.append(h('span', { class: ['mark-line', `sev-${sev}`], dataset: { line }, css: { '--line': String(line - 1) } }));
    }
    marksLayer.replaceChildren(frag);
  };

  textarea.addEventListener('scroll', sync, { passive: true });
  textarea.addEventListener('input', () => {
    renderGutter();
    onInput?.(textarea.value);
  });

  renderGutter();

  return {
    el,
    textarea,
    getValue: () => textarea.value,
    setValue(text) {
      textarea.value = text;
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
      sync();
      renderGutter();
    },
    /** @param {'cobol-fixed' | 'fortran-fixed' | 'free'} mode */
    setMode(mode) {
      const key = GUIDES[mode] ? mode : 'free';
      el.dataset.mode = key;
      guidesLayer.replaceChildren(...GUIDES[key].map((g) => h('span', { class: ['guide', g.cls], css: { '--col': String(g.after) } })));
    },
    /** @param {{ line: number, severity: string }[]} findings */
    setFindings(findings) {
      const next = new Map();
      for (const f of findings) {
        const current = next.get(f.line);
        if (!current || SEVERITY_RANK[f.severity] > SEVERITY_RANK[current]) next.set(f.line, f.severity);
      }
      markers = next;
      gutterInner.dataset.dirty = '1';
      renderGutter();
      renderMarks();
    },
    /** Select a finding's span and bring its line into view. */
    focusLine(line, column = 1, endColumn = column + 1) {
      const lines = textarea.value.split('\n');
      const index = Math.max(0, Math.min(lines.length - 1, line - 1));
      let offset = 0;
      for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
      const text = lines[index] ?? '';
      const start = offset + Math.max(0, Math.min(text.length, column - 1));
      const end = offset + Math.max(0, Math.min(text.length, endColumn - 1));
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, Math.max(start, end));
      textarea.scrollTop = Math.max(0, index * LINE - textarea.clientHeight / 2 + LINE);
      sync();
      const band = marksLayer.querySelector(`[data-line="${index + 1}"]`) ?? h('span', { class: 'mark-line sev-info', dataset: { line: index + 1 }, css: { '--line': String(index) } });
      if (!band.isConnected) marksLayer.append(band);
      band.classList.remove('is-flash');
      void band.getBoundingClientRect();
      band.classList.add('is-flash');
    },
  };
}
