import { ApiError } from "../errors";

export const RUN_LIMITS = {
  rounds: 6,
  toolCalls: 12,
  completionTokens: 4096,
  tokensPerRequest: 1024,
  timeoutMs: 90000,
} as const;

// Isolate-local guard. Public paid chat stays disabled until a shared quota/session store is wired in S2-B/C.
export class RunLimiter {
  #active = new Set<string>();
  #windows = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly now = () => Date.now(),
    private readonly maxConcurrent = 2,
  ) {}
  acquire(subject: string) {
    const now = this.now();
    for (const [key, window] of this.#windows)
      if (window.resetAt <= now) this.#windows.delete(key);
    const window = this.#windows.get(subject) || {
      count: 0,
      resetAt: now + 600000,
    };
    if (
      this.#active.has(subject) ||
      this.#active.size >= this.maxConcurrent ||
      window.count >= 8 ||
      (!this.#windows.has(subject) && this.#windows.size >= 1000)
    )
      throw new ApiError(
        "RATE_LIMITED",
        "对话请求过于频繁，请稍后重试。",
        true,
      );
    window.count++;
    this.#windows.set(subject, window);
    this.#active.add(subject);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.#active.delete(subject);
      }
    };
  }
}
