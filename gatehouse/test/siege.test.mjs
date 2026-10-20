// SPDX-License-Identifier: Apache-2.0
// The Siege: every attack in shared/lab.mjs — the same list the dashboard
// shows — must be contained by exactly the layer it claims.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SCENARIOS, runScenario } from '../../shared/lab.mjs';
import { SKIP_REASON, startGatehouse } from './helpers.mjs';

// ALCAZAR_SIEGE_URL runs the same Siege against an already running
// Gatehouse — CI uses it on the production container image — as the
// operator whose token is ALCAZAR_SIEGE_TOKEN.
const REMOTE = process.env.ALCAZAR_SIEGE_URL;
const TOKEN = process.env.ALCAZAR_SIEGE_TOKEN;
const asOperator = TOKEN
  ? (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}` } })
  : fetch;

describe('Siege', { skip: REMOTE ? false : SKIP_REASON }, () => {
  let gh;
  before(async () => {
    gh = REMOTE ? { base: REMOTE.replace(/\/$/, ''), stop: async () => {} } : await startGatehouse();
  });
  after(async () => {
    await gh.stop();
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id} is contained by ${scenario.expected.layer}`, async () => {
      const outcome = await runScenario(scenario, { base: gh.base, fetch: asOperator });
      assert.equal(outcome.contained, true, `${scenario.id} was not contained: ${outcome.detail}`);
      assert.equal(outcome.layer, scenario.expected.layer, outcome.detail);
      assert.equal(outcome.asExpected, true, `${scenario.id}: got ${outcome.layer} ${outcome.code} (${outcome.detail})`);
    });
  }
});
