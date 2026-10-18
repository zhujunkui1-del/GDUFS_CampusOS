import { dispatchDue } from "./scheduler";
import { withApi } from "../http";
import { readJson } from "../assistant/http-context";
import { consoleBindings } from "./auth";
import { ConsoleSyncStore, runnerActor } from "./v2-sync";
import { tokenHash } from "../assistant/crypto";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";
export const consoleRunnerApi = withApi(async (request) => {
  const config = consoleBindings(),
    header = request.headers.get("Authorization") || "",
    origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError("FORBIDDEN", "执行器来源无效。");
  if (!/^Bearer [\w-]{40,100}$/.test(header))
    throw new ApiError("UNAUTHORIZED", "需要有效的执行器凭据。");
  const token = await config.db
    .prepare(
      "SELECT t.id,t.source_ids_json FROM console_runner_tokens t JOIN console_admins issuer ON issuer.id=t.admin_id WHERE issuer.status='active' AND issuer.role='admin' AND issuer.principal_type='human' AND t.token_hash=? AND t.revoked_at_ms IS NULL AND t.expires_at_ms>?",
    )
    .bind(await tokenHash(header.slice(7)), Date.now())
    .first<{ id: string; source_ids_json: string }>();
  if (!token) throw new ApiError("UNAUTHORIZED", "执行器凭据已失效。");
  const scopes: string[] = JSON.parse(token.source_ids_json),
    store = new ConsoleSyncStore(config.db, runnerActor);
  store.runnerId = token.id;
  const path = new URL(request.url).pathname
    .replace(/^\/api\/console-runner\//, "")
    .split("/");
  const [section, id, action] = path;
  if (path.length > 3 || (id && !ConsoleIdSchema.safeParse(id).success))
    throw new ApiError("NOT_FOUND", "未找到执行接口。");
  const check = (source: string) => {
    if (!scopes.includes(source))
      throw new ApiError("FORBIDDEN", "此来源不在执行器授权范围。");
  };
  if (section === "dispatch" && request.method === "POST")
    return dispatchDue(config.db, { allowedIds: scopes });
  if (section === "jobs" && !id && request.method === "GET") {
    const rows = await config.db
      .prepare(
        `SELECT id,source_id,status,phase,control_state,next_run_after_ms,lease_until_ms FROM ingestion_jobs WHERE source_id IN(${scopes.map(() => "?").join(",")}) AND job_kind='web' AND control_state='active' AND phase<>'complete' AND status IN('queued','running') AND ((SELECT auto_sync_enabled FROM console_engine_settings WHERE id='console-v2-settings')=1 OR run_key NOT LIKE 'scheduled:%') ORDER BY created_at,id LIMIT 5`,
      )
      .bind(...scopes)
      .all();
    await config.db.batch([
      config.db
        .prepare("UPDATE console_runner_tokens SET last_seen_at=? WHERE id=?")
        .bind(new Date().toISOString(), token.id),
      config.db
        .prepare(
          "UPDATE console_engine_settings SET runner_last_at=? WHERE id='console-v2-settings'",
        )
        .bind(new Date().toISOString()),
    ]);
    return { items: rows.results };
  }
  if (section === "sources" && id && request.method === "GET") {
    check(id);
    if (action === "collection-policy") return store.policy(id);
    if (!action) return store.source(id);
  }
  if (section === "jobs" && id) {
    const job = await store.job(id);
    check(String(job.source_id));
    if (request.method === "GET" && !action) return job;
    if (request.method === "POST") {
      const raw = await readJson(request, 262144);
      if (action === "claim") return store.claim(id, raw);
      if (action === "commit") return store.commit(id, raw);
      if (action === "permit") return store.permit(id, raw);
      if (action === "pause" || action === "cancel")
        return store.control(id, raw, action);
    }
  }
  throw new ApiError("NOT_FOUND", "未找到执行接口。");
});
