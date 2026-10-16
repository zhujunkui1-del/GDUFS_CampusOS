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
import { ConsoleStore } from "./store";

export async function consoleAuthentication(request: Request) {
  let setCookie: string | undefined;
  const response = await withApi(async (req) => {
    const config = consoleBindings(),
      mode = consoleMode(req, config);
    if (req.method === "GET") {
      try {
        const session = await requireConsole(req, false, config);
        return {
          authenticated: true,
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
  const store = new ConsoleStore(
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
  if (id) ConsoleIdSchema.parse(id);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const read = () => readJson(request, 262144);
  if (request.method === "GET") {
    if (section === "overview" && !id)
      return {
        stats: await store.overview(),
        collectorEnabled: false,
        indexEnabled: false,
      };
    if (section === "sources")
      return id && !action
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
  }
  if (section === "content") {
    if (request.method === "POST" && !id)
      return store.writeContent(undefined, await read());
    if (request.method === "PATCH" && id && !action)
      return store.writeContent(id, await read());
    if (request.method === "POST" && id) {
      if (action === "review") return store.review(id, await read());
      if (action === "publish") return store.publish(id, await read());
      if (action === "withdraw") return store.publish(id, await read(), true);
      if (action === "restore") return store.restore(id, await read());
    }
  }
  if (
    request.method === "POST" &&
    section === "jobs" &&
    id &&
    action === "cancel"
  )
    return store.cancelJob(id, await read());
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
