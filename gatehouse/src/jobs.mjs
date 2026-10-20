// SPDX-License-Identifier: Apache-2.0
// In-memory job store: bounded (oldest evicted first) and time-limited, so
// neither memory nor the job workspaces on disk can grow without bound.

import { rm } from 'node:fs/promises';

export class JobStore {
  /**
   * @param {{ maxJobs: number, ttlMs: number, now?: () => number }} options
   */
  constructor({ maxJobs, ttlMs, now = () => Date.now() }) {
    this.maxJobs = maxJobs;
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, { job: object, state: object, expiresAt: number }>} */
    this.entries = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  add(job, state) {
    while (this.entries.size >= this.maxJobs) this.remove(this.entries.keys().next().value);
    const expiresAt = this.now() + this.ttlMs;
    job.expiresAt = new Date(expiresAt).toISOString();
    this.entries.set(job.job, { job, state, expiresAt });
  }

  get(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.remove(id);
      return null;
    }
    return entry;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    rm(entry.state.dir, { recursive: true, force: true }).catch(() => {});
  }

  sweep() {
    for (const id of [...this.entries.keys()]) this.get(id);
  }

  async close() {
    clearInterval(this.sweeper);
    await Promise.all([...this.entries.values()].map((e) => rm(e.state.dir, { recursive: true, force: true })));
    this.entries.clear();
  }
}
