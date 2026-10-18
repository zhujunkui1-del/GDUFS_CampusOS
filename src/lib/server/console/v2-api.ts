import { z } from "zod";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import { readJson } from "../assistant/http-context";
import type { ConsoleRetentionStore } from "./v2-retention";
export async function consoleV2Api(
  store: ConsoleRetentionStore,
  request: Request,
  path: string[],
  query: unknown,
) {
  const [section, id, action] = path;
  if (path.length > 3) throw new ApiError("NOT_FOUND", "未找到管理接口。");
  if (id) ConsoleIdSchema.parse(id);
  const read = () => readJson(request, 262144);
  if (request.method === "GET") {
    if (section === "retention" && id && action === "items")
      return store.planItems(id, query);
    if (section === "whitelist") return store.protections(query);
    if (section === "retention")
      return id ? store.plan(id) : store.plans(query);
    if (section === "overview") return store.dashboard(query);
    if (section === "settings") return store.engineSettings();
    if (section === "sources" && !action)
      return id ? store.sourceV2(id) : store.sourcesV2(query);
    if (section === "articles") return store.articlesV2(query);
    if (section === "sources" && id && action === "auto-policy")
      return store.autoPolicy(id);
    if (section === "checks" && id) return store.checkDetails(id);
  }
  if (request.method === "POST") {
    if (section === "whitelist") return store.protection(await read());
    if (section === "retention")
      return id
        ? store.actPlan(id, await read())
        : store.createPlan(await read());
    if (section === "tombstones" && id)
      return store.releaseTombstone(id, await read());
    if (section === "sources" && id && action === "auto-policy")
      return store.setAutoPolicy(id, await read());
    if (section === "checks" && id) return store.analyse(id);
    if (section === "attest" && id) return store.attest(id, await read());
    if (section === "settings" && !id)
      return store.saveEngineSettings(await read());
    if (section === "sources" && !id)
      return store.createGovernedSource(await read());
    if (section === "sources" && id === "batch") {
      const v = z
        .object({
          action: z.enum(["enable", "pause", "archive"]),
          items: z
            .array(
              z
                .object({
                  id: ConsoleIdSchema,
                  version: z.number().int().positive(),
                  commandId: z.string().uuid(),
                })
                .strict(),
            )
            .min(1)
            .max(5),
        })
        .strict()
        .parse(await read());
      const results = [];
      for (const item of v.items)
        try {
          const value = {
            commandId: item.commandId,
            expectedVersion: item.version,
          };
          const outcome =
            v.action === "archive"
              ? await store.archiveSource(item.id, value)
              : await store.enableSource(item.id, {
                  ...value,
                  enabled: v.action === "enable",
                });
          results.push({ ok: true, ...outcome });
        } catch (e) {
          results.push({
            id: item.id,
            ok: false,
            error: e instanceof ApiError ? e.message : "操作未完成，请重试。",
          });
        }
      return { items: results };
    }
    if (section === "sources" && id && action === "governance")
      return store.governSource(id, await read());
    if (section === "sources" && id && action === "restore")
      return store.restoreSource(id, await read());
    if (section === "sources" && id && action === "sync-settings")
      return store.saveSourceSync(id, await read());
  }
  throw new ApiError("NOT_FOUND", "未找到管理接口。");
}
