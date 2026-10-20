#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Regenerate the README screenshots of Lookout (docs/assets/lookout-*.png).
//
//   npm start            # Gatehouse on http://localhost:8080 (another terminal)
//   node scripts/screenshots.mjs [--base http://localhost:8080] [--chrome PATH]
//
// Drives a headless Chrome through the DevTools Protocol with nothing but
// Node.js built-ins, in a throw-away profile (never the user's own).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = option('--base', 'http://localhost:8080');
const CHROME = option('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const OUT = fileURLToPath(new URL('../docs/assets/', import.meta.url));
const PORT = 9333;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'alcazar-shots-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (version.webSocketDebuggerUrl) return { chrome, profile };
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

/** A minimal CDP client over one page target. */
async function connect() {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}

async function main() {
  const { chrome, profile } = await launchChrome();
  const page = await connect();
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  // Views re-render after every action: look the control up again, for a while.
  const clickText = (text) => evaluate(`(async () => {
    for (let i = 0; i < 50; i += 1) {
      const el = [...document.querySelectorAll('button, a')]
        .find((b) => !b.disabled && b.textContent.trim().startsWith(${JSON.stringify(text)}));
      if (el) {
        el.click();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('no element: ' + ${JSON.stringify(text)});
  })()`);
  const waitFor = async (expression, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await sleep(150);
    }
    throw new Error(`timeout waiting for ${expression}`);
  };
  const view = async (hash) => {
    await evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(900);
  };
  const scrollTo = (selectorText) => evaluate(`(() => {
    const el = [...document.querySelectorAll('h2, h3')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(selectorText)}));
    if (el) el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -16);
    return !!el;
  })()`);
  const shoot = async (name) => {
    await sleep(500);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `lookout-${name}.png`), Buffer.from(data, 'base64'));
    console.log(`docs/assets/lookout-${name}.png`);
  };
  const viewport = async (width, height, scheme) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  };

  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await viewport(1440, 900, 'dark');
    await page.send('Page.navigate', { url: `${BASE}/#/overview` });
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('main h1')`);
    await sleep(1200);
    await clickText('Run demo batch');
    await waitFor(`/through all four layers/.test(document.body.innerText)`);
    await shoot('overview');
    await scrollTo('The fortress');
    await shoot('fortress');
    await evaluate('window.scrollTo(0, 0)');

    await view('#/transactions');
    await scrollTo('Why transfers were rejected');
    await evaluate('window.scrollBy(0, -130)');
    await shoot('transactions');

    await view('#/seal');
    await evaluate(`(() => { const i = document.querySelector('input[type=number]'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clickText('Tamper');
    await waitFor(`/changed since it was last verified/.test(document.body.innerText)`);
    await clickText('Verify now');
    await waitFor(`/Chain broken at entry 5/.test(document.body.innerText)`);
    await evaluate('window.scrollTo(0, 0)');
    await shoot('seal');
    await scrollTo('1–40 of');
    await evaluate('window.scrollBy(0, -40)');
    await shoot('seal-chain');

    await view('#/siege');
    await clickText('Launch full siege');
    await waitFor(`/28\\/28 contained/.test(document.body.innerText)`, 60000);
    await evaluate('window.scrollTo(0, 0)');
    await shoot('siege');

    await view('#/watchtower');
    await scrollTo('Scanner');
    await shoot('watchtower');

    await view('#/defenses');
    await shoot('defenses');

    await viewport(390, 844, 'light');
    await page.send('Page.reload');
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('main h1')`);
    await view('#/overview');
    await shoot('mobile-light');
  } finally {
    page.close();
    chrome.kill('SIGTERM');
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`screenshots: ${error.message}`);
  process.exit(1);
});
