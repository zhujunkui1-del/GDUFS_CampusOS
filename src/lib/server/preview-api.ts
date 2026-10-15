import {
  sessionGet,
  historyGet,
  challengePost,
  cancelPost,
  routePost,
  claimPost,
  receiptPost,
} from "./assistant/api";
import { chatResponse } from "./assistant/chat";
import { executeMapSkillHttp } from "./maps/http";
import { GET as agentStatus } from "@/app/api/agent/status/route";

type Handler = (request: Request) => Promise<Response>;
// Delegate unchanged public handlers. They retain their own identity, Origin,
// quota, schema, ownership and error checks; no alternative implementation.
export function previewApiHandler(
  path: string,
): { method: string; handle: Handler } | null {
  const fixed: Record<string, { method: string; handle: Handler }> = {
    "/api/agent/session": { method: "GET", handle: sessionGet },
    "/api/agent/status": { method: "GET", handle: agentStatus },
    "/api/agent/chat": { method: "POST", handle: chatResponse },
    "/api/agent/cancel": { method: "POST", handle: cancelPost },
    "/api/agent/location/challenge": { method: "POST", handle: challengePost },
  };
  if (Object.hasOwn(fixed, path)) return fixed[path];
  if (/^\/api\/agent\/conversations\/[^/]+$/.test(path))
    return { method: "GET", handle: historyGet };
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
