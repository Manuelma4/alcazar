// SPDX-License-Identifier: Apache-2.0
// Token-bucket rate limiting per client, with a bounded table so the limiter
// itself cannot be used to exhaust memory.

export class RateLimiter {
  /**
   * @param {{ capacity: number, refillPerSecond: number, maxClients?: number, now?: () => number }} options
   */
  constructor({ capacity, refillPerSecond, maxClients = 10000, now = () => Date.now() }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSecond / 1000;
    this.maxClients = maxClients;
    this.now = now;
    /** @type {Map<string, { tokens: number, at: number }>} */
    this.buckets = new Map();
  }

  /**
   * Take `cost` tokens for `client`.
   * @returns {{ allowed: boolean, retryAfterS: number }}
   */
  take(client, cost = 1) {
    const now = this.now();
    let bucket = this.buckets.get(client);
    if (bucket) {
      this.buckets.delete(client);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) * this.refillPerMs);
      bucket.at = now;
    } else {
      bucket = { tokens: this.capacity, at: now };
      if (this.buckets.size >= this.maxClients) {
        // Evict the least recently seen client (Map keeps insertion order).
        this.buckets.delete(this.buckets.keys().next().value);
      }
    }
    this.buckets.set(client, bucket);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true, retryAfterS: 0 };
    }
    return { allowed: false, retryAfterS: Math.ceil((cost - bucket.tokens) / this.refillPerMs / 1000) };
  }
}
