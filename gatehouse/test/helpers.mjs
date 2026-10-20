// SPDX-License-Identifier: Apache-2.0
// Shared test helpers: start a real Gatehouse on an ephemeral port.

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
import { ROOT, loadConfig } from '../src/config.mjs';

export const BINARIES_BUILT = ['txnguard', 'ledgerck', 'fraudscan', 'alzselftest']
  .every((name) => existsSync(join(ROOT, 'build', 'bin', name)));
export const SKIP_REASON = BINARIES_BUILT ? false : 'legacy binaries not built (run `make` first)';

/**
 * @param {Record<string, string>} [env]
 * @param {{ workDir?: string, log?: Function }} [options]  reuse an existing work directory; collect the log
 */
export async function startGatehouse(env = {}, options = {}) {
  const workDir = options.workDir ?? (await mkdtemp(join(tmpdir(), 'alcazar-test-')));
  // Tests run the showcase on a loopback address: demo mode on, and no
  // operator token unless the test brings one (auth.test.mjs covers sign-in).
  const token = env.ALCAZAR_API_TOKEN || env.ALCAZAR_API_TOKEN_FILE;
  const config = loadConfig({ ALCAZAR_PORT: '0', ALCAZAR_WORK_DIR: workDir, ALCAZAR_AUTH: token ? 'token' : 'none', ALCAZAR_DEMO: '1', ...env });
  const app = await createApp(config, { log: options.log ?? (() => {}) });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  return {
    app,
    base,
    async stop() {
      await app.close();
      await rm(workDir, { recursive: true, force: true });
    },
  };
}

export function postJson(base, path, body, headers = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const VALID = Object.freeze({
  id: 'T-0001',
  timestamp: '20251020101500',
  from: 'FR76 3000 6000 0112 3456 7890 189',
  to: 'DE89370400440532013000',
  amount: '125.00',
  currency: 'EUR',
  channel: 'WEB',
  memo: 'Invoice 2025-117',
});
