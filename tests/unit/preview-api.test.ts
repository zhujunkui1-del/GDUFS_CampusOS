import { it, expect } from "vitest";
import {
  previewApiHandler,
  withPreviewSecurityHeaders,
} from "@/lib/server/preview-api";
import { sessionGet, routePost, claimPost } from "@/lib/server/assistant/api";
import { executeMapSkillHttp } from "@/lib/server/maps/http";
it("delegates to the exact existing authenticated handlers", () => {
  expect(previewApiHandler("/api/agent/session")?.handle).toBe(sessionGet);
  expect(previewApiHandler("/api/agent/routes/test")?.handle).toBe(routePost);
  expect(previewApiHandler("/api/agent/actions/test/claim")?.handle).toBe(
    claimPost,
  );
  expect(previewApiHandler("/api/map/skills/search_places")?.handle).toBe(
    executeMapSkillHttp,
  );
});
it("does not open management, arbitrary SQL or prefix lookalike routes", () => {
  for (const path of [
    "/map",
    "/api/admin/sql",
    "/api/agent/session/extra",
    "/api/agent/routes/a/extra",
    "/api/agent/unknown",
  ])
    expect(previewApiHandler(path)).toBeNull();
});
it("keeps streaming bodies, private cache headers and secure cookies intact", async () => {
  const original = new Response("fixture", {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Set-Cookie": "fixture=1; Secure; HttpOnly",
    },
  });
  const response = withPreviewSecurityHeaders(original);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toContain("Secure; HttpOnly");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(await response.text()).toBe("fixture");
});
