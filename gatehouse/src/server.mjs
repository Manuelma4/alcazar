#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Gatehouse entry point.
//
//   node gatehouse/src/server.mjs
//   npm start   (same, under the Node.js permission model)

import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const app = await createApp(config);
const address = await app.listen();
const health = app.health();
process.stdout.write(
  `${JSON.stringify({
    time: new Date().toISOString(),
    level: 'info',
    message: 'Gatehouse listening',
    url: `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}/`,
    selftest: health.selftest.status,
    demo: config.demo,
  })}\n`,
);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    app.close().finally(() => process.exit(0));
  });
}
