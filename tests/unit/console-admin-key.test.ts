import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import {
  createConsoleSession,
  requireConsole,
  closeConsoleSession,
  consoleMode,
  type ConsoleBindings,
} from "@/lib/server/console/auth";

const origin = "https://console-test.invalid";
const key = "isolated-unit-test-only-admin-key-not-a-real-credential";
function config(db: ConsoleBindings["db"]): ConsoleBindings {
  return {
    db,
    environment: "preview",
    mode: "admin_key",
    origin,
    secret: "isolated-console-signing-secret-for-unit-tests-only",
    adminKey: key,
    localKey: "different-local-only-credential-more-than-forty-characters",
    emails: ["operator@example.invalid"],
    team: "",
    audience: "",
  };
}
const loginRequest = () =>
  new Request(origin + "/api/console-auth", {
    method: "POST",
    headers: { Origin: origin },
  });
const sessionRequest = (cookie: string, csrf?: string) =>
  new Request(origin + "/api/admin/sources", {
    method: csrf ? "POST" : "GET",
    headers: {
      Origin: origin,
      Cookie: cookie.split(";")[0],
      ...(csrf ? { "X-Console-CSRF": csrf } : {}),
    },
  });

describe("explicit HTTPS administrator key mode", () => {
  it("authenticates only the configured operator and issues a revocable secure cookie", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db),
        login = await createConsoleSession(loginRequest(), { key }, c);
      expect(consoleMode(loginRequest(), c)).toBe("key");
      expect(login.cookie).toContain(
        "HttpOnly; SameSite=Strict; Max-Age=3600; Secure",
      );
      expect(
        await requireConsole(sessionRequest(login.cookie, login.csrf), true, c),
      ).toMatchObject({ actor: { email: c.emails[0], role: "admin" } });
      await expect(
        createConsoleSession(
          loginRequest(),
          { key, role: "admin", email: "forged@example.invalid" },
          c,
        ),
      ).rejects.toThrow();
      await expect(
        requireConsole(sessionRequest(login.cookie), true, c),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      f.close();
    }
  });
  it("refuses HTTP, forged forwarded protocol, another origin and incomplete/shared configuration", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db);
      for (const url of [
        origin.replace("https:", "http:"),
        "https://another.invalid",
      ]) {
        const request = new Request(url + "/api/console-auth", {
          method: "POST",
          headers: { Origin: url, "X-Forwarded-Proto": "https" },
        });
        await expect(
          createConsoleSession(request, { key }, c),
        ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      }
      for (const changed of [
        { adminKey: "" },
        { origin: "" },
        { emails: ["a@example.invalid", "b@example.invalid"] },
      ])
        expect(() =>
          consoleMode(loginRequest(), { ...c, ...changed }),
        ).toThrow();
      await expect(
        createConsoleSession(loginRequest(), { key: "wrong-key".repeat(8) }, c),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM console_sessions").get(),
      ).toMatchObject({ n: 0 });
    } finally {
      f.close();
    }
  });
  it("invalidates old cookies after key rotation/logout and blocks revoked operators", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db),
        login = await createConsoleSession(loginRequest(), { key }, c);
      await expect(
        requireConsole(sessionRequest(login.cookie), false, {
          ...c,
          adminKey: key + "-rotated",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const request = sessionRequest(login.cookie, login.csrf);
      await closeConsoleSession(
        request,
        await requireConsole(request, true, c),
      );
      await expect(
        requireConsole(sessionRequest(login.cookie), false, c),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const next = await createConsoleSession(loginRequest(), { key }, c);
      f.sqlite.prepare("UPDATE console_admins SET status='revoked'").run();
      await expect(
        requireConsole(sessionRequest(next.cookie), false, c),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        createConsoleSession(loginRequest(), { key }, c),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      f.close();
    }
  });
  it("cannot reuse a local-development session in public key mode", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db),
        local = {
          ...c,
          environment: "local",
          mode: "local_key",
          localKey: key,
        };
      const request = new Request("http://127.0.0.1:8787/api/console-auth", {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:8787" },
      });
      const login = await createConsoleSession(request, { key }, local);
      await expect(
        requireConsole(sessionRequest(login.cookie), false, c),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      f.close();
    }
  });
});
