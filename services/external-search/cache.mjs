// Short-lived public snippets only, never login state or browser cookies.
export class PublicNoteCache {
  #entries = new Map();
  constructor(now = Date.now, ttlMs = 120000, capacity = 32) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.capacity = capacity;
  }
  get(key, limit) {
    const found = this.#entries.get(key);
    if (!found) return null;
    if (this.now() - found.at >= this.ttlMs) {
      this.#entries.delete(key);
      return null;
    }
    return found.items.slice(0, limit);
  }
  put(key, items) {
    if (!items.some((item) => item.evidenceKind === "page_excerpt")) return;
    this.#entries.delete(key);
    this.#entries.set(key, { at: this.now(), items });
    while (this.#entries.size > this.capacity)
      this.#entries.delete(this.#entries.keys().next().value);
  }
}
