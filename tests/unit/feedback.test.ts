import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
const bindings = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => bindings,
}));
import { feedbackPost } from "@/lib/server/feedback";
import { consoleAdministration } from "@/lib/server/console/api";
import {
  consoleBindings,
  createConsoleSession,
} from "@/lib/server/console/auth";
import { previewApiHandler } from "@/lib/server/preview-api";

const origin = "https://feedback.example.invalid";
const key = "fixture-console-key-longer-than-forty-characters-only";
let fixture: ReturnType<typeof sqliteD1>;
beforeEach(() => {
  fixture = sqliteD1();
  bindings.env = {
    DB: fixture.db,
    APP_ENV: "preview",
    CONSOLE_AUTH_MODE: "admin_key",
    CONSOLE_ORIGIN: origin,
    CONSOLE_ADMIN_EMAILS: "admin@example.invalid",
    CONSOLE_ADMIN_ACCESS_KEY: key,
    CONSOLE_SESSION_SECRET:
      "fixture-console-secret-at-least-thirty-two-characters",
  };
});
afterEach(() => fixture.close());

const submit = (body: unknown, cookie = "") =>
  feedbackPost(
    new Request(origin + "/api/public/feedback", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
async function login() {
  const session = await createConsoleSession(
    new Request(origin + "/api/console-auth", {
      method: "POST",
      headers: { Origin: origin },
    }),
    { key },
    consoleBindings(),
  );
  return { cookie: session.cookie.split(";")[0], csrf: session.csrf };
}
const admin = (cookie: string, suffix = "", csrf?: string) =>
  consoleAdministration(
    new Request(origin + "/api/admin/v2/feedback" + suffix, {
      method: suffix ? "POST" : "GET",
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(csrf ? { "X-Console-CSRF": csrf } : {}),
      },
    }),
  );

it("accepts anonymous and named messages and returns no message, identifier or history", async () => {
  for (const [input, cookie] of [
    [{ content: "匿名建议" }, ""],
    [
      { nickname: " 同学 ", content: "补充信息源 https://example.invalid/" },
      "campusos_account=ordinary-user",
    ],
    [{ content: "长留言".repeat(400) }, ""],
  ] as const) {
    const response = await submit(input, cookie);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ submitted: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(
    fixture.sqlite
      .prepare("SELECT nickname FROM project_feedback ORDER BY rowid")
      .all(),
  ).toEqual([{ nickname: "" }, { nickname: "同学" }, { nickname: "" }]);
  expect(previewApiHandler("/api/public/feedback", "GET")?.method).toBe("POST");
});

it("keeps both inbox sections in submission order and archives without publishing", async () => {
  await submit({ content: "first" });
  await submit({
    nickname: "昵称",
    content: "<script>private marker</script>",
  });
  const rows = fixture.sqlite
    .prepare("SELECT id FROM project_feedback ORDER BY rowid")
    .all() as { id: string }[];
  fixture.sqlite
    .prepare("UPDATE project_feedback SET submitted_at=? WHERE id=?")
    .run("2026-11-13T01:00:00.000Z", rows[0].id);
  fixture.sqlite
    .prepare("UPDATE project_feedback SET submitted_at=? WHERE id=?")
    .run("2026-11-14T01:00:00.000Z", rows[1].id);
  const session = await login();
  let body = await (await admin(session.cookie)).json();
  expect(body.data.pending.map((item: { id: string }) => item.id)).toEqual([
    rows[1].id,
    rows[0].id,
  ]);
  expect(body.data.archived).toEqual([]);
  expect(
    (await admin(session.cookie, "/" + rows[1].id + "/archive", session.csrf))
      .status,
  ).toBe(200);
  body = await (await admin(session.cookie)).json();
  expect(body.data.pending.map((item: { id: string }) => item.id)).toEqual([
    rows[0].id,
  ]);
  expect(body.data.archived[0]).toMatchObject({
    id: rows[1].id,
    content: "<script>private marker</script>",
  });
  expect(
    (await admin(session.cookie, "/" + rows[0].id + "/archive", session.csrf))
      .status,
  ).toBe(200);
  body = await (await admin(session.cookie)).json();
  expect(body.data.archived.map((item: { id: string }) => item.id)).toEqual([
    rows[1].id,
    rows[0].id,
  ]);
});

it("rejects guests and ordinary account cookies from reading or archiving private messages", async () => {
  await submit({ content: "private feedback" });
  const row = fixture.sqlite
    .prepare("SELECT id FROM project_feedback")
    .get() as { id: string };
  for (const cookie of ["", "campusos_account=ordinary-user"]) {
    for (const suffix of ["", "/" + row.id + "/archive"]) {
      const response = await admin(cookie, suffix);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("private feedback");
    }
  }
  expect(
    fixture.sqlite.prepare("SELECT status FROM project_feedback").get(),
  ).toEqual({ status: "pending" });
});

it("requires the Console CSRF token for archiving and validates nonempty same-origin submissions", async () => {
  expect((await submit({ content: "  " })).status).toBe(400);
  const cross = await feedbackPost(
    new Request(origin + "/api/public/feedback", {
      method: "POST",
      headers: { Origin: "https://other.invalid" },
      body: JSON.stringify({ content: "cross-origin" }),
    }),
  );
  expect(cross.status).toBe(403);
  await submit({ content: "keep pending" });
  const row = fixture.sqlite
    .prepare("SELECT id FROM project_feedback")
    .get() as { id: string };
  const session = await login();
  expect((await admin(session.cookie, "/" + row.id + "/archive")).status).toBe(
    403,
  );
  expect(
    fixture.sqlite.prepare("SELECT status FROM project_feedback").get(),
  ).toEqual({ status: "pending" });
});
