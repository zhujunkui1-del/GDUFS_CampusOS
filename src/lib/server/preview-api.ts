import {
  sessionGet,
  historyGet,
  challengePost,
  cancelPost,
  routePost,
  claimPost,
  receiptPost,
  conversationsGet,
  conversationDelete,
} from "./assistant/api";
import { chatResponse } from "./assistant/chat";
import { executeMapSkillHttp } from "./maps/http";
import { GET as agentStatus } from "@/app/api/agent/status/route";
import { GET as health } from "@/app/api/health/route";
import { consoleAdministration, consoleAuthentication } from "./console/api";
import { publicContent } from "./console/public-content";

type Handler = (request: Request) => Promise<Response>;
const fixed: Record<string, { method: string; handle: Handler }> = {
  "/api/health": { method: "GET", handle: health },
  "/api/public/content": { method: "GET", handle: publicContent },
  "/api/agent/session": { method: "GET", handle: sessionGet },
  "/api/agent/conversations": { method: "GET", handle: conversationsGet },
  "/api/agent/status": { method: "GET", handle: agentStatus },
  "/api/agent/chat": { method: "POST", handle: chatResponse },
  "/api/agent/cancel": { method: "POST", handle: cancelPost },
  "/api/agent/location/challenge": { method: "POST", handle: challengePost },
};
// Delegate unchanged public handlers. They retain their own identity, Origin,
// quota, schema, ownership and error checks; no alternative implementation.
export function previewApiHandler(
  path: string,
  method = "GET",
): { method: string; handle: Handler } | null {
  if (path === "/api/console-auth")
    return { method, handle: consoleAuthentication };
  if (/^\/api\/admin\/v2(?:\/[a-zA-Z0-9_-]+){1,3}$/.test(path))
    return { method, handle: consoleAdministration };
  if (
    /^\/api\/admin\/(?:overview|audit|admins|sources(?:\/[^/]+(?:\/(?:verify|enabled|collection-policy|import-policy))?)?|content(?:\/[^/]+(?:\/(?:review|publish|withdraw|restore|versions\/\d{1,4}))?)?|jobs(?:\/[^/]+(?:\/(?:claim|commit|pause|resume|cancel))?)?|admins\/[^/]+\/revoke)$/.test(
      path,
    )
  )
    return { method, handle: consoleAdministration };
  if (Object.hasOwn(fixed, path)) return fixed[path];
  if (/^\/api\/agent\/conversations\/[^/]+$/.test(path))
    return method === "DELETE"
      ? { method: "DELETE", handle: conversationDelete }
      : { method: "GET", handle: historyGet };
  if (/^\/api\/agent\/routes\/[^/]+$/.test(path))
    return { method: "POST", handle: routePost };
  if (/^\/api\/agent\/actions\/[^/]+\/claim$/.test(path))
    return { method: "POST", handle: claimPost };
  if (/^\/api\/agent\/actions\/[^/]+\/receipt$/.test(path))
    return { method: "POST", handle: receiptPost };
  if (/^\/api\/map\/skills\/[^/]+$/.test(path))
    return { method: "POST", handle: executeMapSkillHttp };
  return null;
}
export function withPreviewSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
