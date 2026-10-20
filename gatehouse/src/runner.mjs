// SPDX-License-Identifier: Apache-2.0
// Sandboxed execution of the legacy batch programs.
//
// * spawn() with an argv array and shell: false — no shell ever parses input.
// * A fixed, allow-listed environment: nothing from Gatehouse's environment
//   leaks in, and nothing an attacker could set (COB_LIBRARY_PATH, DD_*
//   file-name mappings, LD_PRELOAD...) can redirect the program.
// * Secrets travel on stdin only (never argv, visible in `ps`, or env).
// * Hard wall-clock timeout (SIGKILL) and bounded stdout/stderr.
// * On Linux, prlimit adds CPU, memory, file-size and core-dump limits.

import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

const CHILD_ENV = Object.freeze({ PATH: '/usr/bin:/bin', LC_ALL: 'C' });

const PRLIMIT = findPrlimit();

function findPrlimit() {
  if (process.platform !== 'linux') return null;
  for (const candidate of ['/usr/bin/prlimit', '/bin/prlimit']) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not installed here
    }
  }
  return null;
}

/** Whether OS resource limits are applied to child processes. */
export const RLIMITS_AVAILABLE = PRLIMIT !== null;

/**
 * @param {string} file     absolute path of the program
 * @param {string[]} args
 * @param {{ cwd: string, stdin?: string, timeoutMs: number, maxOutputBytes: number }} options
 * @returns {Promise<{ code: number | null, signal: string | null, stdout: string, stderr: string, ms: number, timedOut: boolean }>}
 */
export function runLegacy(file, args, { cwd, stdin = '', timeoutMs, maxOutputBytes }) {
  const started = performance.now();
  const command = PRLIMIT ?? file;
  const argv = PRLIMIT
    ? ['--cpu=10', '--as=1073741824', '--fsize=16777216', '--nofile=64', '--core=0', '--', file, ...args]
    : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd,
      // A fresh copy every time: under the permission model Node adds
      // NODE_OPTIONS to the object it is given (a frozen one throws).
      env: { ...CHILD_ENV },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    const err = [];
    let outBytes = 0;
    let timedOut = false;
    let overflow = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const collect = (sink) => (chunk) => {
      outBytes += chunk.length;
      if (outBytes > maxOutputBytes) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      sink.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.stdin.on('error', () => {
      // The program may exit before reading stdin; its exit status decides.
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: overflow ? null : code,
        signal,
        stdout: Buffer.concat(out).toString('latin1'),
        stderr: Buffer.concat(err).toString('latin1'),
        ms: Math.round(performance.now() - started),
        timedOut,
      });
    });
    child.stdin.end(stdin);
  });
}
