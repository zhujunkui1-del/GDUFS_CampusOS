import { z } from "zod";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import { readJson } from "../assistant/http-context";
import type { ConsoleSyncStore } from "./v2-sync";
export async function consoleV2Api(
  store: ConsoleSyncStore,
  request: Request,
  path: string[],
  query: unknown,
) {
  const [section, id, action] = path;
  if (
    ["recheck", "attest", "checks"].includes(section) ||
    (section === "sources" && action === "auto-policy")
  )
    throw new ApiError(
      "FORBIDDEN",
      "人工审核已关闭，采集结果由同步程序校验并发布。",
    );
  if (path.length > 3) throw new ApiError("NOT_FOUND", "未找到管理接口。");
  if (id) ConsoleIdSchema.parse(id);
  const read = () => readJson(request, 262144);
  if (request.method === "GET") {
    if (section === "date-gate")
      return id === "history"
        ? store.gateHistory(query)
        : id
          ? store.gateDetail(id, query)
          : store.gateSettings();
    if (section === "operations" && (id === "jobs" || id === "history"))
      return store.operationRecords(undefined, id, query);
    if (
      section === "sources" &&
      id &&
      (action === "jobs" || action === "history")
    )
      return store.operationRecords(id, action, query);
    if (section === "runner-tokens") return store.runnerTokens();
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
    if (section === "date-gate")
      return id
        ? store.actGate(id, await read())
        : store.previewGate(await read());
    if (section === "classify" && id)
      return store.classifyArticlePlacement(id, await read());
    if (section === "whitelist" && id === "batch") {
      const { ProtectionSchema } = await import("@/domain/console/retention");
      const items = z
        .array(ProtectionSchema)
        .min(1)
        .max(5)
        .refine(
          (rows) =>
            new Set(rows.map((r) => r.type + ":" + r.targetId)).size ===
            rows.length,
        )
        .parse(await read());
      const results = [];
      for (const item of items)
        try {
          results.push({ ok: true, ...(await store.protection(item)) });
        } catch (e) {
          results.push({
            ok: false,
            id: item.targetId,
            error: e instanceof ApiError ? e.message : "保存失败，请刷新重试。",
          });
        }
      return { items: results };
    }
    if (section === "sources" && id && action === "operator-scope")
      return store.assignOperator(id, await read());
    if (section === "permits" && id) return store.permit(id, await read());
    if (section === "runner-tokens")
      return id
        ? store.revokeRunnerToken(id, await read())
        : store.createRunnerToken(await read());
    if (section === "sync") return store.syncNow(await read());
    if (section === "recheck") return store.recheckPending();
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
