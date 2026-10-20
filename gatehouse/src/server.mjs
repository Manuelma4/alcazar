#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Gatehouse entry point.
//
//   node gatehouse/src/server.mjs
//   npm start   (same, under the Node.js permission model)

import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';

const logLine = (stream, fields) => stream.write(`${JSON.stringify({ time: new Date().toISOString(), ...fields })}\n`);

let config;
let app;
try {
  config = loadConfig();
  app = await createApp(config);
} catch (error) {
  // A configuration or key-file error: one log line, not a stack trace.
  logLine(process.stderr, { level: 'error', message: 'Gatehouse cannot start', error: error.message });
  process.exit(1);
}
const address = await app.listen();
const health = app.health();
logLine(process.stdout, {
  level: 'info',
  message: 'Gatehouse listening',
  url: `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}/`,
  selftest: health.selftest.status,
  demo: config.demo,
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    app.close().finally(() => process.exit(0));
  });
}
