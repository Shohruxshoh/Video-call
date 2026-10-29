/** Fixed-window counter kept in memory; good enough for a single small server. */
export class RateLimiter {
  #limit: number;
  #windowMs: number;
  #hits = new Map<string, { count: number; reset: number }>();
  #sweeper: NodeJS.Timeout;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#sweeper = setInterval(() => this.#sweep(), windowMs).unref();
  }

  /** Returns false when `key` has used up its budget for the current window. */
  take(key: string): boolean {
    const now = Date.now();
    const entry = this.#hits.get(key);
    if (!entry || entry.reset <= now) {
      this.#hits.set(key, { count: 1, reset: now + this.#windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.#limit;
  }

  stop() {
    clearInterval(this.#sweeper);
  }

  #sweep() {
    const now = Date.now();
    for (const [key, entry] of this.#hits) if (entry.reset <= now) this.#hits.delete(key);
  }
}
