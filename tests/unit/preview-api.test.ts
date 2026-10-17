import { it, expect } from "vitest";
import {
  previewApiHandler,
  withPreviewSecurityHeaders,
} from "@/lib/server/preview-api";
import {
  sessionGet,
  routePost,
  claimPost,
  historyGet,
  conversationsGet,
  conversationDelete,
} from "@/lib/server/assistant/api";
import { executeMapSkillHttp } from "@/lib/server/maps/http";
import { consoleAdministration } from "@/lib/server/console/api";
it("keeps bounded ingestion APIs on the existing authenticated lightweight dispatcher", () => {
  for (const path of [
    "/api/admin/jobs/job-fixture",
    "/api/admin/jobs/job-fixture/claim",
    "/api/admin/jobs/job-fixture/commit",
    "/api/admin/jobs/job-fixture/pause",
    "/api/admin/jobs/job-fixture/resume",
    "/api/admin/sources/source-fixture/collection-policy",
  ])
    expect(previewApiHandler(path, "POST")?.handle).toBe(consoleAdministration);
  expect(previewApiHandler("/api/admin/jobs/job-fixture/sql")).toBeNull();
});
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
it("dispatches conversation listing, read and delete to authenticated shared handlers", () => {
  expect(previewApiHandler("/api/agent/conversations")?.handle).toBe(
    conversationsGet,
  );
  expect(
    previewApiHandler("/api/agent/conversations/test", "GET")?.handle,
  ).toBe(historyGet);
  expect(
    previewApiHandler("/api/agent/conversations/test", "DELETE")?.handle,
  ).toBe(conversationDelete);
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
