import type {
  ModelClient,
  ModelReply,
  ModelSnapshot,
} from "@/domain/models/contracts";
import { ApiError } from "../errors";
import type { ModelRouter } from "./router";

// The owner explicitly authorized quota-only fallback. Never retry network/auth errors.
// Each tier may be tried at most once, in order; a tier already reached is never
// re-entered, so a three-tier chain cannot oscillate.
export class PriorityModelRouter {
  constructor(
    private readonly primary: ModelRouter,
    private readonly fallback: ModelRouter | ModelRouter[],
  ) {
    this.#tiers = [primary, ...(Array.isArray(fallback) ? fallback : [fallback])];
  }
  readonly #tiers: ModelRouter[];
  // A tier whose configuration was never verified (no receipt yet, or a
  // rotated key) is skipped instead of taking the whole assistant offline:
  // resolving it sends no request and spends no credit.
  static readonly #CONFIG_CODES = new Set(["MODEL_TEST_REQUIRED", "MODEL_SELECTION_REQUIRED"]);
  async resolve() {
    let tier = 0;
    while (true) {
      try {
        const first = await this.#tiers[tier].resolve();
        const snapshot = { ...first.snapshot };
        let selected = first.client;
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
  #chain(
    tier: number,
    selected: ModelClient,
    snapshot: ModelSnapshot,
  ) {
    const call = async <T>(
      run: (client: ModelClient) => Promise<T>,
      partial: () => boolean,
    ) => {
      while (true) {
        try {
          return await run(selected);
        } catch (error) {
          if (
            tier + 1 >= this.#tiers.length ||
            partial() ||
            !(error instanceof ApiError) ||
            error.code !== "MODEL_QUOTA_EXHAUSTED"
          )
            throw error;
          const next = await this.#tiers[++tier].resolve();
          selected = next.client;
          Object.assign(snapshot, next.snapshot);
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
