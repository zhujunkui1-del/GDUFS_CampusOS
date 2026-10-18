import { dispatchDue } from "./src/lib/server/console/scheduler";
import type { SqlDatabase } from "./src/lib/server/assistant/database";
import handler from "./.open-next/worker.js";
import { runWithCloudflareRequestContext } from "./.open-next/cloudflare/init.js";
import {
  previewApiHandler,
  withPreviewSecurityHeaders,
} from "./src/lib/server/preview-api";

// The existing OpenNext ALS supplies exactly the same request-scoped bindings.
// A thin preview-only dispatcher avoids Next routing overhead on small APIs.
const previewWorker = {
  async scheduled(_event: unknown, env: Record<string, unknown>) {
    if (env.APP_ENV !== "preview" || !env.DB) return;
    await dispatchDue(env.DB as SqlDatabase);
  },
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: { waitUntil(work: Promise<unknown>): void },
  ) {
    const route =
      env.APP_ENV === "preview"
        ? previewApiHandler(new URL(request.url).pathname, request.method)
        : null;
    if (!route) return handler.fetch(request, env, ctx);
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      const response =
        request.method === route.method
          ? await route.handle(request)
          : Response.json(
              {
                ok: false,
                error: {
                  code: "INVALID_ARGUMENT",
                  message: "请求方法不受支持。",
                  retryable: false,
                },
                requestId: crypto.randomUUID(),
              },
              {
                status: 405,
                headers: { Allow: route.method, "Cache-Control": "no-store" },
              },
            );
      return withPreviewSecurityHeaders(response);
    });
  },
};
export default previewWorker;
