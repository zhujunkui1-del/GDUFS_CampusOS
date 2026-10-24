import { withApi } from "../http";
import { readJson } from "../assistant/http-context";
import { ApiError } from "../errors";
import { ConsoleIdSchema } from "@/domain/console/contracts";
import {
  consoleBindings,
  consoleMode,
  requireConsole,
  createConsoleSession,
  closeConsoleSession,
  consoleCookie,
} from "./auth";
import { ConsoleSyncStore } from "./v2-sync";
import { consoleV2Api } from "./v2-api";
import { collectorAdministration } from "./collector-api";

export async function consoleAuthentication(request: Request) {
  let setCookie: string | undefined;
  const response = await withApi(async (req) => {
    const config = consoleBindings(),
      mode = consoleMode(req, config);
    const credentialDerivation =
      config.mode === "admin_password"
        ? { version: "pbkdf2-sha256-v1" as const, salt: config.credentialSalt! }
        : undefined;
    if (req.method === "GET") {
      try {
        const session = await requireConsole(req, false, config);
        return {
          authenticated: true,
          credentialDerivation,
          mode,
          actor: session.actor,
          csrf: session.csrf,
          environment: config.environment,
        };
      } catch (error) {
        if (
          error instanceof ApiError &&
          ["UNAUTHORIZED", "FORBIDDEN"].includes(error.code)
        )
          return {
            authenticated: false,
            credentialDerivation,
            mode,
            environment: config.environment,
          };
        throw error;
      }
    }
    if (req.method === "POST") {
      const session = await createConsoleSession(
        req,
        await readJson(req, 4096),
        config,
      );
      setCookie = session.cookie;
      return {
        authenticated: true,
        credentialDerivation,
        mode,
        actor: session.actor,
        csrf: session.csrf,
        environment: config.environment,
      };
    }
    if (req.method === "DELETE") {
      const session = await requireConsole(
        req,
        true,
        config,
        Date.now(),
        undefined,
        true,
      );
      setCookie = await closeConsoleSession(req, session);
      return { authenticated: false, mode };
    }
    throw new ApiError("INVALID_ARGUMENT", "不支持此请求方法。");
  })(request);
  if (request.method === "DELETE") setCookie = consoleCookie(request, "", true);
  if (setCookie) response.headers.set("Set-Cookie", setCookie);
  response.headers.set("Vary", "Cookie, Cf-Access-Jwt-Assertion");
  return response;
}
export const consoleAdministration = withApi(async (request) => {
  const context = await requireConsole(
    request,
    !["GET", "HEAD"].includes(request.method),
  );
  const store = new ConsoleSyncStore(
    context.config.db,
    context.actor,
    undefined,
    context.sessionHash,
  );
  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const [section, id, action, version] = path;
  if (path.length > 4) throw new ApiError("NOT_FOUND", "未找到该管理接口。");
  if (section === "collector")
    return collectorAdministration(
      context.config.db,
      context.actor,
      request,
      path.slice(1),
    );
  if (
    section === "content" &&
    (action === "versions" || action === "restore" || action === "review")
  )
    throw new ApiError(
      "FORBIDDEN",
      "人工审核和版本管理已关闭，文章由采集程序同步。",
    );
  if (id) ConsoleIdSchema.parse(id);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const read = (maxBytes = 262144) => readJson(request, maxBytes);
  if (section === "v2")
    return consoleV2Api(store, request, path.slice(1), query);
  if (request.method === "GET") {
    if (section === "overview" && !id)
      return {
        stats: await store.overview(),
        collectorEnabled: true,
        indexEnabled: false,
      };
    if (section === "sources")
      return id && action === "import-policy"
        ? store.importPolicy(id)
        : id && action === "collection-policy"
          ? store.policy(id)
          : id && !action
            ? store.source(id)
            : !id
              ? store.sources(query)
              : unknownRoute();
    if (section === "content") {
      if (id && action === "versions" && version && /^\d{1,4}$/.test(version))
        return store.version(id, Number(version));
      if (id && !action) return store.document(id);
      if (!id) return store.content(query);
    }
    if (section === "jobs" && !id) return store.jobs(query);
    if (section === "jobs" && id && !action) {
      const row = await store.job(id);
      const { lease_hash: omitted, ...safe } = row;
      void omitted;
      return safe;
    }
    if (section === "audit" && !id) return store.audit(query);
    if (section === "admins" && !id) return { items: await store.admins() };
  }
  if (section === "sources") {
    if (request.method === "POST" && !id)
      return store.createSource(await read());
    if (request.method === "PATCH" && id && !action)
      return store.editSource(id, await read());
    if (request.method === "DELETE" && id && !action)
      return store.archiveSource(id, await read());
    if (request.method === "POST" && id && action === "verify")
      return store.verifySource(id, await read());
    if (request.method === "POST" && id && action === "enabled")
      return store.enableSource(id, await read());
    if (request.method === "POST" && id && action === "collection-policy")
      return store.setPolicy(id, await read());
    if (request.method === "POST" && id && action === "import-policy")
      return store.setImportPolicy(id, await read());
  }
  if (section === "content") {
    if (request.method === "POST" && id === "import" && !action)
      return store.importBatch(await read());
    if (request.method === "POST" && !id)
      throw new ApiError("INVALID_ARGUMENT", "请使用人工导入入口登记内容。");
    if (request.method === "PATCH" && id && !action) {
      if ((await store.document(id)).collectionManaged)
        throw new ApiError(
          "FORBIDDEN",
          "此文章由采集器维护，请更新原文后同步。",
        );
      return store.writeContent(id, await read(1800000));
    }
    if (request.method === "POST" && id) {
      if (action === "review") return store.review(id, await read());
      if (action === "publish") return store.publish(id, await read());
      if (action === "withdraw") return store.publish(id, await read(), true);
      if (action === "restore") return store.restore(id, await read());
    }
  }
  if (request.method === "POST" && section === "jobs") {
    if (!id) return store.createJob(await read());
    if (action === "claim") return store.claim(id, await read());
    if (action === "commit") return store.commit(id, await read());
    if (action === "cancel" || action === "pause" || action === "resume")
      return store.control(id, await read(), action);
  }
  if (
    request.method === "POST" &&
    section === "admins" &&
    id &&
    action === "revoke"
  )
    return store.revokeAdmin(id, await read());
  return unknownRoute();
});
function unknownRoute(): never {
  throw new ApiError("NOT_FOUND", "未找到该管理接口。");
}
