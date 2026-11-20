import type {
  ModelClient,
  ModelReply,
  ModelSnapshot,
} from "@/domain/models/contracts";
import { ApiError, type ErrorCode } from "../errors";
import type { ModelRouter } from "./router";

export type ModelTierId = "gdufs" | "stepfun" | "deepseek";

// DeepSeek is the platform primary and StepFun the backup. The owner can flip
// the order per environment: MODEL_PRIORITY=stepfun restores the previous
// Step-first chain, MODEL_PRIORITY=gdufs leads with the campus gateway.
export function modelPriorityOrder(
  priority: string | undefined,
): ModelTierId[] {
  if (priority === "gdufs") return ["gdufs", "deepseek", "stepfun"];
  if (priority === "stepfun") return ["stepfun", "deepseek"];
  return ["deepseek", "stepfun"];
}

// Only availability failures switch tiers: a rejected key or a configuration
// error stays visible instead of silently pinning every run to the backup
// provider and spending its credit.
const FALLBACK_CODES = new Set<ErrorCode>([
  "MODEL_QUOTA_EXHAUSTED",
  "MODEL_RATE_LIMITED",
  "MODEL_SERVICE_UNAVAILABLE",
  "MODEL_NETWORK_ERROR",
  "MODEL_TIMEOUT",
]);

// Each tier may be tried at most once, in order; a tier already reached is never
// re-entered, so a three-tier chain cannot oscillate.
export type PriorityEvent = {
  event: "fallback" | "failed";
  provider: string;
  model?: string;
  from?: string;
  code?: string;
};

export class PriorityModelRouter {
  constructor(
    private readonly primary: ModelRouter,
    private readonly fallback: ModelRouter | ModelRouter[],
    // The console reports which provider actually served traffic, so a swap is
    // recorded at the moment it happens rather than inferred afterwards.
    private readonly onEvent?: (event: PriorityEvent) => void | Promise<void>,
  ) {
    this.#tiers = [
      primary,
      ...(Array.isArray(fallback) ? fallback : [fallback]),
    ];
  }
  readonly #tiers: ModelRouter[];
  // A tier whose configuration was never verified (no receipt yet, or a
  // rotated key) is skipped instead of taking the whole assistant offline:
  // resolving it sends no request and spends no credit.
  static readonly #CONFIG_CODES = new Set([
    "MODEL_TEST_REQUIRED",
    "MODEL_SELECTION_REQUIRED",
  ]);
  async resolve() {
    let tier = 0;
    while (true) {
      try {
        const first = await this.#tiers[tier].resolve();
        const snapshot = { ...first.snapshot };
        const selected = first.client;
        return this.#chain(tier, selected, snapshot);
      } catch (error) {
        if (
          tier + 1 < this.#tiers.length &&
          error instanceof ApiError &&
          PriorityModelRouter.#CONFIG_CODES.has(error.code)
        ) {
          tier++;
          continue;
        }
        throw error;
      }
    }
  }
  async #notify(event: PriorityEvent) {
    try {
      await this.onEvent?.(event);
    } catch {
      // Reporting must never take the assistant down with it.
    }
  }
  #chain(tier: number, selected: ModelClient, snapshot: ModelSnapshot) {
    const call = async <T>(
      run: (client: ModelClient) => Promise<T>,
      partial: () => boolean,
    ) => {
      while (true) {
        try {
          return await run(selected);
        } catch (error) {
          const code = error instanceof ApiError ? error.code : undefined;
          const unavailable =
            error instanceof ApiError && FALLBACK_CODES.has(error.code);
          if (!unavailable || partial() || tier + 1 >= this.#tiers.length) {
            // Availability failures with nowhere left to go are what the health
            // board has to show; deterministic errors stay out of that count.
            if (unavailable)
              await this.#notify({
                event: "failed",
                provider: snapshot.provider,
                model: snapshot.model,
                code,
              });
            throw error;
          }
          const from = snapshot.provider;
          const next = await this.#tiers[++tier].resolve();
          selected = next.client;
          Object.assign(snapshot, next.snapshot);
          await this.#notify({
            event: "fallback",
            provider: next.snapshot.provider,
            model: next.snapshot.model,
            from,
            code,
          });
        }
      }
    };
    const client: ModelClient = {
      generateWithTools: async (request) => {
        let partial = false;
        return call<ModelReply>(
          (c) =>
            c.generateWithTools({
              ...request,
              ...(request.onText
                ? {
                    onText: (text) => {
                      partial = true;
                      request.onText!(text);
                    },
                  }
                : {}),
            }),
          () => partial,
        );
      },
      generateStructured: (request, schema) =>
        call(
          (c) => c.generateStructured(request, schema),
          () => false,
        ),
    };
    return { client, snapshot: snapshot as ModelSnapshot };
  }
  async status() {
    // Report the first tier that would actually serve traffic, not the first
    // one that happens to be configured.
    for (const tier of this.#tiers) {
      const value = await tier.status();
      if (value.ready) return value;
      if (!PriorityModelRouter.#CONFIG_CODES.has(value.code)) return value;
    }
    return this.#tiers[this.#tiers.length - 1].status();
  }
}
