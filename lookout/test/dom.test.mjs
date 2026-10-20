// Lookout · tests for the pure modules (no DOM, no network) plus a static
// lint that keeps the shipped sources compatible with the gateway's CSP and
// Trusted Types policy.  Run: node --test lookout/test/

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  escapeInvisible, formatBytes, formatCentsPlain, formatCountdown, formatMoney, formatTimestamp, hasInvisible, maskIban, maskPan,
  parseTimestamp, shortHash, splitCents, splitInvisible,
} from '../js/format.mjs';
import { STRINGS, t } from '../js/strings.mjs';
import {
  ACCEPTED_LAYOUT, LEDGER_LAYOUT, LEDGER_LENGTH, LEDGER_MAC_INPUT, REJECTED_LAYOUT, acceptedRecord, diffRanges, layoutWidth, ledgerSegments,
  rejectedRecord, ruler,
} from '../js/records.mjs';
import { parseBatchText, projectInput } from '../js/batch.mjs';
import { buildRows, filterRows, histogramEdgesInUnits, reasonCounts, topRisk, totals } from '../js/jobmodel.mjs';
import {
  LEDGER_REASONS, SEVERITIES, SIGNALS, STAGES, TAMPER_MODES, VERDICTS, VERIFIERS, normalizeJob, normalizePosture, normalizeReport,
} from '../js/api.mjs';
import { ROUTES } from '../js/router.mjs';
import { safeUrl } from '../js/dom.mjs';
import { SCENARIOS, LAYERS } from '../../shared/lab.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function files(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, exts));
    else if (exts.includes(extname(name))) out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------
describe('format: money is exact (no floating point)', () => {
  test('splits cents with BigInt', () => {
    assert.deepEqual(splitCents('17524009'), { negative: false, major: 175240n, minor: '09' });
    assert.deepEqual(splitCents('000000000000589'), { negative: false, major: 5n, minor: '89' });
    assert.deepEqual(splitCents('-5'), { negative: true, major: 0n, minor: '05' });
    assert.deepEqual(splitCents('-0'), { negative: false, major: 0n, minor: '00' });
    assert.equal(splitCents('12.50'), null);
    assert.equal(splitCents('1e5'), null);
    assert.equal(splitCents(0.1), null);
    assert.equal(splitCents({}), null);
  });

  test('formats by currency in en-GB', () => {
    assert.equal(formatMoney('17524009', 'EUR'), '€175,240.09');
    assert.equal(formatMoney('566561', 'GBP'), '£5,665.61');
    assert.equal(formatMoney('589', 'EUR'), '€5.89');
    assert.equal(formatMoney('5', 'EUR'), '€0.05');
    assert.equal(formatMoney('0', 'EUR'), '€0.00');
    assert.match(formatMoney('1450129', 'CHF'), /^CHF\s14,501\.29$/u);
  });

  test('keeps every digit beyond float precision', () => {
    // 2^63 cents would round as a double; the cents must survive verbatim.
    assert.equal(formatMoney('922337203685477580799', 'EUR'), '€9,223,372,036,854,775,807.99');
    assert.equal(formatMoney(12345678901234567n, 'EUR'), '€123,456,789,012,345.67');
  });

  test('plain cents keep exact digits without a currency', () => {
    assert.equal(formatCentsPlain(19876), '198.76');
    assert.equal(formatCentsPlain('2500000'), '25,000.00');
    assert.equal(formatCentsPlain('922337203685477580799'), '9,223,372,036,854,775,807.99');
  });

  test('negative and odd inputs', () => {
    assert.equal(formatMoney('-50000', 'EUR'), '-€500.00');
    assert.equal(formatMoney('-5', 'EUR'), '-€0.05');
    assert.equal(formatMoney('125', 'eur!'), '1.25');
    assert.equal(formatMoney('not-cents', 'EUR'), 'not-cents');
  });
});

describe('format: timestamps, hashes, masks', () => {
  test('parses only real calendar instants (UTC)', () => {
    assert.equal(parseTimestamp('20251020031757').toISOString(), '2025-10-20T03:17:57.000Z');
    assert.equal(parseTimestamp('20250230101500'), null, '30 February');
    assert.equal(parseTimestamp('20251020240000'), null, 'hour 24');
    assert.equal(parseTimestamp('2025102003175'), null, '13 digits');
    assert.equal(parseTimestamp('2025-10-20T03'), null);
  });

  test('formats timestamps readably and falls back to the raw text', () => {
    assert.equal(formatTimestamp('20251020031757'), '20 Oct 2025, 03:17:57 UTC');
    assert.equal(formatTimestamp('20250230101500'), '20250230101500');
  });

  test('short hashes and countdowns', () => {
    assert.equal(shortHash('a92d04eb57c27dea2598ca99d97519f2a6efa8ed0de7d57b4a04b56e9889ba79'), 'a92d\u{2026}ba79');
    assert.equal(shortHash('abcd'), 'abcd');
    assert.equal(formatCountdown(14 * 60 * 1000 + 32 * 1000), '14:32');
    assert.equal(formatCountdown(-1), '0:00');
    assert.equal(formatBytes(4194304), '4 MiB');
    assert.equal(formatBytes(1536), '1.5 KiB');
  });

  test('masks like Gatehouse: IBAN first4+last4, PAN BIN+last4', () => {
    assert.equal(maskIban('FR76 3000 6000 0112 3456 7890 189'), 'FR76*******************0189');
    assert.equal(maskPan('4111 1111 1111 1111'), '411111******1111');
    assert.equal(maskPan(''), '');
  });
});

describe('format: invisible and bidi characters are shown, never obeyed', () => {
  const rlo = String.fromCodePoint(0x202e);
  const pdf = String.fromCodePoint(0x202c);
  const zwsp = String.fromCodePoint(0x200b);

  test('escapes controls, bidi and zero-width characters', () => {
    assert.equal(escapeInvisible(`Refund ${rlo}etouq${pdf}`), 'Refund \\u{202E}etouq\\u{202C}');
    assert.equal(escapeInvisible('ok\nLAB'), 'ok\\nLAB');
    assert.equal(escapeInvisible(`a${zwsp}b`), 'a\\u{200B}b');
    assert.equal(escapeInvisible('plain ASCII ok'), 'plain ASCII ok');
    assert.equal(hasInvisible(`x${rlo}`), true);
    assert.equal(hasInvisible('café'), false, 'visible non-ASCII is fine');
  });

  test('splits into plain and escaped runs for rendering', () => {
    assert.deepEqual(splitInvisible(`a${rlo}b`), [
      { text: 'a', escaped: false },
      { text: '\\u{202E}', escaped: true },
      { text: 'b', escaped: false },
    ]);
  });
});

// ---------------------------------------------------------------------
describe('records: fixed-width layouts from ARCHITECTURE §2', () => {
  test('layout widths', () => {
    assert.equal(layoutWidth(ACCEPTED_LAYOUT), 206);
    assert.equal(layoutWidth(REJECTED_LAYOUT), 64);
    assert.equal(layoutWidth(LEDGER_LAYOUT, '|'), LEDGER_LENGTH);
  });

  test('rebuilds ACCEPTED and REJECTED records', () => {
    const accepted = acceptedRecord({
      id: 'TX-00000001', timestamp: '20251020031757', fromToken: 'fd5c282ff9ddb9db', toToken: '87ce219dd851d99c',
      fromMasked: 'PT63*****************2070', toMasked: 'BE59********3066', amountCents: '589', currency: 'EUR',
      channel: 'POS', panMasked: '400005******8474', memo: 'Rent October',
    });
    assert.equal(accepted.length, 206);
    assert.equal(accepted.slice(126, 141), '000000000000589');
    assert.equal(accepted.slice(0, 12), 'TX-00000001 ');
    const rejected = rejectedRecord({ line: 4, legacyId: 'TX-00000004', code: 'E403', field: 'AMOUNT', detail: 'NOT-POSITIVE' });
    assert.equal(rejected.length, 64);
    assert.equal(rejected.slice(0, 6), '000004');
    assert.equal(rejected.slice(18, 22), 'E403');
  });

  test('cuts a real ledger line into its fields', () => {
    const raw = '000001|A|TX-0001     |20251020101500|A000|+000000000012500|EUR|FR76*******************0189       |                   |be7ff1b952683e31d0af582d6cc0928ecb1fcf0a5ae9c324c4d7bdfc8035733c|efcdc5e78127afd1ccf2b144135f697b733d1060a94f38e36936cc6c6ef03f73|6a0b3914f84974087f6762fc621dff29d9f41e91a3577300b0eae6c81c1dfe21';
    assert.equal(raw.length, LEDGER_LENGTH);
    const fields = ledgerSegments(raw).filter((s) => !s.separator);
    assert.equal(fields.length, 12);
    assert.equal(fields.find((f) => f.name === 'CODE').text, 'A000');
    assert.equal(fields.find((f) => f.name === 'AMOUNT').text, '+000000000012500');
    assert.equal(fields.find((f) => f.name === 'RECORD-MAC').start, 118);
    assert.equal(fields.find((f) => f.name === 'MAC').start, 248);
    assert.equal(raw.lastIndexOf('|'), LEDGER_MAC_INPUT, 'MAC input is the first 247 bytes');
  });

  test('3270 ruler and diffs', () => {
    assert.equal(ruler(20), '----+----1----+----2');
    assert.deepEqual(diffRanges('000000000021937', '000000000121937'), [[9, 10]]);
    assert.deepEqual(diffRanges('abc', 'abc'), []);
  });
});

// ---------------------------------------------------------------------
describe('batch: parsing input and keeping only a masked projection', () => {
  test('accepts an object or an array, flags what Gatehouse will refuse', () => {
    assert.equal(parseBatchText('').ok, false);
    assert.equal(parseBatchText('{oops').error, 'json');
    assert.equal(parseBatchText('{"rows": []}').error, 'shape');
    assert.equal(parseBatchText('[]').error, 'none');
    const extra = parseBatchText('{"transactions":[{"id":"A"}],"__proto__":{"x":1}}');
    assert.equal(extra.ok, true);
    assert.deepEqual(extra.warnings, ['extra-keys']);
    const many = parseBatchText(JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ id: `T${i}` }))));
    assert.ok(many.warnings.includes('too-many'));
  });

  test('never keeps a card number or a full IBAN', () => {
    const [row] = projectInput([{ id: 'X', from: 'FR7630006000011234567890189', to: 'DE89370400440532013000', pan: '4111111111111111', amount: '1.00', currency: 'EUR', channel: 'POS' }]);
    assert.equal(row.card, '411111******1111');
    assert.equal(row.from, 'FR76*******************0189');
    assert.ok(!JSON.stringify(row).includes('4111111111111111'));
    assert.ok(!JSON.stringify(row).includes('30006000011234567890'));
  });
});

// ---------------------------------------------------------------------
function fakeJob() {
  return normalizeJob({
    job: 'j-0123456789abcdef01234567',
    stages: [{ name: 'gatehouse', status: 'ok', ms: 2, detail: { in: 4 } }],
    summary: { received: 4, accepted: 3, rejected: 1, flagged: 1, totalsByCurrency: { EUR: '1000', GBP: '250000', __proto__x: '1' } },
    rejections: [{ line: 2, id: 'B', legacyId: 'B', code: 'E403', field: 'AMOUNT', detail: 'NOT-POSITIVE', message: 'Amount is zero or negative' }],
    accepted: [
      { id: 'A', timestamp: '20251020101500', amountCents: '500', currency: 'EUR', memo: 'one' },
      { id: 'C', timestamp: '20251020101501', amountCents: '500', currency: 'EUR', memo: 'two' },
      { id: 'D', timestamp: '20251020101502', amountCents: '250000', currency: 'GBP', memo: 'three' },
    ],
    risk: {
      transactions: [
        { id: 'A', score: 0, z: 0.1, entropy: null, signals: [] },
        { id: 'C', score: 0, z: 0.2, entropy: null, signals: [] },
        { id: 'D', score: 51, z: 11.3, entropy: null, signals: ['ZSCORE', 'NOT-A-SIGNAL'] },
      ],
      amounts: { minCents: 500, histogram: { log10Edges: [0, 0.25, 0.5, 0.75, 1], counts: [0, 0, 0, 2] } },
    },
    ledger: { entries: [1, 2, 3, 4].map((seq) => ({ seq, type: seq === 2 ? 'R' : 'A', mac: 'ab'.repeat(32) })), verification: { valid: true, verifiedBy: ['cobol-fortran', 'node-openssl', 'anchor', 'nobody'] } },
  });
}

describe('jobmodel: joining a job back into input order', () => {
  test('rejections by line, accepted in order, risk by id, entries by seq', () => {
    const rows = buildRows(fakeJob());
    assert.deepEqual(rows.map((r) => `${r.line}:${r.id}:${r.status}`), ['1:A:accepted', '2:B:rejected', '3:C:accepted', '4:D:flagged']);
    assert.equal(rows[1].entry.type, 'R');
    assert.deepEqual(filterRows(rows, { filter: 'flagged' }).map((r) => r.id), ['D']);
    assert.deepEqual(filterRows(rows, { query: 'e403' }).map((r) => r.id), ['B']);
  });

  test('reasons, top risk, totals', () => {
    const job = fakeJob();
    assert.deepEqual(reasonCounts(job).map((r) => [r.code, r.count]), [['E403', 1]]);
    assert.deepEqual(topRisk(job).map((r) => r.risk.id), ['D']);
    assert.deepEqual(totals(job).map(([ccy]) => ccy), ['GBP', 'EUR'], 'largest first, invalid codes dropped');
  });

  test('histogram edges are read as log10(units), with a cents guard', () => {
    const units = { minCents: 500, histogram: { log10Edges: [0, 0.25, 0.5, 0.75, 1], counts: [0, 0, 0, 2] } };
    assert.deepEqual(histogramEdgesInUnits(units), [0, 0.25, 0.5, 0.75, 1]);
    const cents = { minCents: 500, histogram: { log10Edges: [2, 2.5, 3], counts: [0, 1] } };
    assert.deepEqual(histogramEdgesInUnits(cents), [0, 0.5, 1]);
  });
});

describe('api: responses are projected onto the contract', () => {
  test('unknown values are dropped, maps are null-prototype', () => {
    const job = fakeJob();
    assert.deepEqual(job.risk.transactions[2].signals, ['ZSCORE']);
    assert.deepEqual(job.ledger.verification.verifiedBy, ['cobol-fortran', 'node-openssl', 'anchor']);
    assert.equal(Object.getPrototypeOf(job.summary.totalsByCurrency), null);
    assert.equal(job.risk.benford.counts.length, 9);
    assert.equal(job.risk.benford.verdict, 'insufficient');
  });

  test('a JSON __proto__ key cannot pollute anything', () => {
    const posture = normalizePosture(JSON.parse('{"headers":{"__proto__":{"polluted":"yes"},"x-frame-options":"DENY"}}'));
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.getPrototypeOf(posture.headers), null);
    assert.equal(posture.headers['x-frame-options'], 'DENY');
  });

  test('watchtower reports tolerate missing fields', () => {
    const report = normalizeReport({ groups: [{ name: 'production', results: [{ filename: 'A.cob', findings: [{ ruleId: 'R', severity: 'bogus', line: 0 }] }] }] });
    const finding = report.groups[0].results[0].findings[0];
    assert.equal(report.groups[0].results[0].file, 'A.cob');
    assert.equal(finding.severity, 'info');
    assert.equal(finding.line, 1);
  });
});

describe('dom: URLs are allow-listed', () => {
  test('javascript: and data: never reach an href', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#');
    assert.equal(safeUrl(' JaVaScRiPt:alert(1)'), '#');
    assert.equal(safeUrl('data:text/html,<b>x</b>'), '#');
    assert.equal(safeUrl('https://cwe.mitre.org/data/definitions/79.html'), 'https://cwe.mitre.org/data/definitions/79.html');
    assert.equal(safeUrl('#/seal/12'), '#/seal/12');
    assert.equal(safeUrl('/api/health'), '/api/health');
  });
});

// ---------------------------------------------------------------------
describe('strings: one complete English table', () => {
  const sources = files(join(ROOT, 'js'), ['.mjs']);

  test('every literal key used by the code exists', () => {
    const missing = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt(?:\.has)?\(\s*'([^'`$]+)'/g)) {
        if (!Object.hasOwn(STRINGS, m[1])) missing.push(`${relative(ROOT, file)}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test('every key built at run time exists', () => {
    const keys = [
      ...ROUTES.flatMap((r) => [`nav.${r.id}`, `nav.${r.id}.sub`, `nav.${r.id}.short`]),
      ...[...LAYERS, 'watchtower'].map((l) => `layer.${l}`),
      ...SEVERITIES.map((s) => `severity.${s}`),
      ...VERDICTS.map((v) => `verdict.${v}`),
      ...['chi2', 'mad', 'none'].flatMap((b) => [`verdict.basis.${b}`, `verdict.explain.${b}`]),
      ...LEDGER_REASONS.map((r) => `reason.${r}`),
      ...VERIFIERS.flatMap((v) => [`verifier.${v}`, `verifier.${v}.desc`]),
      ...TAMPER_MODES.flatMap((m) => [`seal.mode.${m}`, `seal.mode.${m}.desc`]),
      ...SIGNALS.flatMap((s) => [`signal.${s}`, `signal.${s}.desc`]),
      ...STAGES.map((s) => `tx.stage.${s}`),
      ...['gatehouse', 'txnguard', 'fraudscan', 'seal'].flatMap((s) => [`overview.stage.${s}`, `overview.stage.${s}.idle`]),
      ...['production', 'vulnerable', 'hardened'].flatMap((g) => [`wt.group.${g}`, `wt.group.${g}.desc`]),
      ...['P-METHOD', 'P-MEDIA', 'P-ORIGIN', 'P-SIZE', 'P-JSON', 'P-SCHEMA', 'P-LENGTH', 'P-CHARSET', 'P-LIMIT', 'P-RATE', 'P-BUSY',
        'P-AUTH', 'P-NOTFOUND', 'P-TIMEOUT', 'P-LEGACY', 'P-DEMO', 'P-HOST', 'P-UNAVAILABLE', 'P-INTERNAL'].map((c) => `perror.${c}`),
      ...['sha256-fips180-4', 'hmac-sha256-rfc4231', 'constant-time-compare', 'hex-codec', 'cobol-validation',
        'ledger-cross-check-openssl', 'token-cross-check-openssl'].map((c) => `selftest.${c}`),
      ...[...new Set(SCENARIOS.map((s) => s.category))].map((c) => `siege.cat.${c}`),
      ...['empty', 'json', 'shape', 'none'].map((e) => `tx.parse.${e}`),
      ...['extra-keys', 'non-object', 'too-many', 'too-big'].map((w) => `tx.warn.${w}`),
      ...['system', 'dark', 'light'].map((m) => `theme.${m}`),
      ...['document', 'script', 'style', 'image', 'data'].map((k) => `def.inventory.${k}`),
    ];
    assert.deepEqual(keys.filter((k) => !Object.hasOwn(STRINGS, k)), []);
  });

  test('no empty strings, balanced placeholders, no invisible characters', () => {
    for (const [key, value] of Object.entries(STRINGS)) {
      assert.ok(value.trim().length > 0, `${key} is empty`);
      assert.equal((value.match(/\{/g) ?? []).length, (value.match(/\}/g) ?? []).length, `${key} has unbalanced braces`);
      assert.equal(hasInvisible(value), false, `${key} contains an invisible character`);
    }
  });

  test('templates fill parameters and pick plurals', () => {
    assert.equal(t('tx.loaded', { n: 1, source: 'x' }), '1 transfer ready — x');
    assert.equal(t('tx.loaded', { n: '1,000', source: 'x' }), '1,000 transfers ready — x');
    assert.equal(t('no.such.key'), 'no.such.key');
    assert.equal(t.has('nav.overview'), true);
  });
});

// ---------------------------------------------------------------------
describe('CSP + Trusted Types lint of the shipped sources', () => {
  const js = files(join(ROOT, 'js'), ['.mjs', '.js']);
  const css = files(join(ROOT, 'css'), ['.css']);
  const svgs = files(join(ROOT, 'assets'), ['.svg']);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  test('no HTML-parsing or code-evaluating sinks in JavaScript', () => {
    const banned = [
      /\.(?:inner|outer)HTML\s*[=+]/, /insertAdjacentHTML\s*\(/, /document\.write(?:ln)?\s*\(/, /\beval\s*\(/,
      /new\s+Function\s*\(/, /setTimeout\s*\(\s*['"`]/, /setInterval\s*\(\s*['"`]/, /setAttribute\(\s*['"]style['"]/,
      /setAttribute\(\s*['"]on\w+['"]/, /\.style\.cssText\s*=/, /createContextualFragment/, /new\s+DOMParser/, /\.srcdoc\s*=/,
    ];
    const hits = [];
    for (const file of js) {
      const text = readFileSync(file, 'utf8');
      for (const re of banned) if (re.test(text)) hits.push(`${relative(ROOT, file)} matches ${re}`);
    }
    assert.deepEqual(hits, []);
  });

  test('index.html has no inline script, style or handler, and no third-party URL', () => {
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script>');
    assert.doesNotMatch(html, /<style/i, 'inline <style>');
    assert.doesNotMatch(html, /\sstyle=/i, 'style attribute');
    assert.doesNotMatch(html, /\son[a-z]+=/i, 'inline event handler');
    assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//i, 'third-party URL');
  });

  test('CSS and SVG load nothing from elsewhere (no data: URIs, no remote URLs)', () => {
    for (const file of [...css, ...svgs]) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /url\(\s*['"]?(?:data:|https?:|\/\/)/i, `${relative(ROOT, file)} loads a foreign URL`);
      assert.doesNotMatch(text, /@import\s+url\(\s*['"]?https?:/i);
    }
    for (const file of svgs) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /<script|<style|\sstyle=|\son[a-z]+=|<foreignObject/i, `${relative(ROOT, file)} is not inert`);
    }
  });

  test('imports stay on this origin', () => {
    for (const file of js) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bimport\s*(?:[^'"]*from\s*)?\(?\s*['"]([^'"]+)['"]/g)) {
        assert.match(m[1], /^(?:\.{1,2}\/|\/(?:shared|watchtower)\/)/, `${relative(ROOT, file)} imports ${m[1]}`);
      }
    }
  });
});
