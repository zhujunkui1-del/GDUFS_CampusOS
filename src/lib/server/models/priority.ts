import type {
  ModelClient,
  ModelReply,
  ModelSnapshot,
} from "@/domain/models/contracts";
import { ApiError } from "../errors";
import type { ModelRouter } from "./router";

// The owner explicitly authorized quota-only fallback. Never retry network/auth errors.
export class PriorityModelRouter {
  constructor(
    private readonly primary: ModelRouter,
    private readonly fallback: ModelRouter,
  ) {}
  async resolve() {
    const first = await this.primary.resolve(),
      snapshot = { ...first.snapshot };
    let selected = first.client,
      switched = false;
    const call = async <T>(
      run: (client: ModelClient) => Promise<T>,
      partial: () => boolean,
    ) => {
      try {
        return await run(selected);
      } catch (error) {
        if (
          switched ||
          partial() ||
          !(error instanceof ApiError) ||
          error.code !== "MODEL_QUOTA_EXHAUSTED"
        )
          throw error;
        const next = await this.fallback.resolve();
        selected = next.client;
        switched = true;
        Object.assign(snapshot, next.snapshot);
        return run(selected);
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
    return this.primary.status();
  }
}
