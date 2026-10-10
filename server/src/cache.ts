// In-memory TTL cache that also collapses concurrent requests for the same key,
// so a burst of users in one area costs a single upstream Google call.
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  private inFlight = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 1000,
    private now: () => number = Date.now,
  ) {}

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    if (hit) this.entries.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private set(key: string, value: T) {
    if (this.entries.size >= this.maxEntries) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
