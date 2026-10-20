// SPDX-License-Identifier: Apache-2.0
// A counting semaphore with a bounded queue. Every legacy process Gatehouse
// starts — for a batch, a verification or a tamper demo — passes through one
// gate, so no request path can fan out into an unbounded number of
// processes; when the queue is full the caller is told to retry (503).

import { HttpError } from './http.mjs';

export class Gate {
  /**
   * @param {number} limit  processes allowed at once
   * @param {number} queue  callers allowed to wait for a slot
   */
  constructor(limit, queue) {
    this.limit = limit;
    this.queue = queue;
    this.active = 0;
    /** @type {Array<() => void>} */
    this.waiting = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= this.queue) {
      throw new HttpError(503, 'P-BUSY', 'The batch core is busy, retry shortly');
    }
    // The releasing caller hands its slot straight to us (see release()).
    await new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  /** Run `task` while holding a slot. */
  async run(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
