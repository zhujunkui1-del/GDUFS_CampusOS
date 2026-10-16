import { beforeAll, describe, it, expect } from "vitest";
import {
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  SignJWT,
  type CryptoKey,
} from "jose";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import {
  verifyConsoleAccess,
  createConsoleSession,
  requireConsole,
  closeConsoleSession,
  type ConsoleBindings,
} from "@/lib/server/console/auth";
import { ConsoleStore } from "@/lib/server/console/store";
import { SafeUrlSchema } from "@/domain/console/contracts";
const team = "console-test.cloudflareaccess.com",
  audience = "a".repeat(64);
let privateKey: CryptoKey, resolver: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  resolver = createLocalJWKSet({
    keys: [
      {
        ...(await exportJWK(keys.publicKey)),
        kid: "isolated-test",
        alg: "RS256",
        use: "sig",
      },
    ],
  });
});
function config(db: ConsoleBindings["db"]): ConsoleBindings {
  return {
    db,
    environment: "preview",
    mode: "access",
    team,
    audience,
    secret: "test-only-console-session-secret-64-characters-long",
    localKey: "local-only-key-longer-than-forty-characters-not-public",
    emails: ["a@example.invalid", "b@example.invalid"],
  };
}
async function token(
  email = "a@example.invalid",
  options: { aud?: string; iss?: string; expired?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email, type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "isolated-test" })
    .setIssuer(options.iss || "https://" + team)
    .setAudience(options.aud || audience)
    .setSubject("subject:" + email)
    .setIssuedAt(now - 10)
    .setExpirationTime(options.expired ? now - 100 : now + 3600)
    .sign(privateKey);
}
describe("signed Access identity boundary", () => {
  it("verifies signature, issuer, audience, expiry and explicit email grants", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db);
      expect(
        (await verifyConsoleAccess(await token(), c, resolver)).email,
      ).toBe("a@example.invalid");
      for (const bad of [
        await token("outsider@example.invalid"),
        await token("a@example.invalid", { aud: "b".repeat(64) }),
        await token("a@example.invalid", {
          iss: "https://wrong.cloudflareaccess.com",
        }),
        await token("a@example.invalid", { expired: true }),
        "eyJhbGciOiJub25lIn0.e30.",
      ])
        await expect(
          verifyConsoleAccess(bad, c, resolver),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      f.close();
    }
  });
  it("rejects forged email headers, a student's cookie and a public local-key bypass", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db);
      const request = new Request("https://console.invalid/api/admin/sources", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "a@example.invalid",
          "X-User-Role": "admin",
          Cookie: "campusos_session=student-session-not-console",
        },
      });
      await expect(
        requireConsole(request, false, c, Date.now(), resolver),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        createConsoleSession(
          new Request("https://console.invalid/api/console-auth", {
            method: "POST",
          }),
          { key: c.localKey },
          { ...c, mode: "local_key" },
          Date.now(),
          resolver,
        ),
      ).rejects.toBeDefined();
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM console_sessions").get(),
      ).toMatchObject({ n: 0 });
    } finally {
      f.close();
    }
  });
  it("binds sessions to the verified administrator and revokes JWT replay on logout", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db),
        jwt = await token();
      const authRequest = new Request(
        "https://console.invalid/api/console-auth",
        {
          method: "POST",
          headers: {
            Origin: "https://console.invalid",
            "Cf-Access-Jwt-Assertion": jwt,
          },
        },
      );
      const session = await createConsoleSession(
          authRequest,
          {},
          c,
          Date.now(),
          resolver,
        ),
        cookie = session.cookie.split(";")[0];
      expect(session.cookie).toContain("HttpOnly; SameSite=Strict");
      expect(session.cookie).toContain("Secure");
      const request = new Request("https://console.invalid/api/admin/sources", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://console.invalid",
          "X-Console-CSRF": session.csrf,
          "Cf-Access-Jwt-Assertion": jwt,
        },
      });
      const context = await requireConsole(
        request,
        true,
        c,
        Date.now(),
        resolver,
      );
      await expect(
        requireConsole(
          new Request(request.url, {
            headers: {
              Cookie: cookie,
              "Cf-Access-Jwt-Assertion": await token("b@example.invalid"),
            },
          }),
          false,
          c,
          Date.now(),
          resolver,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await closeConsoleSession(request, context);
      await expect(
        createConsoleSession(authRequest, {}, c, Date.now(), resolver),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      f.close();
    }
  });
  it("rejects a write whose session was revoked after authentication", async () => {
    const f = sqliteD1();
    try {
      const c = config(f.db),
        jwt = await token();
      const req = new Request("https://console.invalid/api/console-auth", {
          method: "POST",
          headers: {
            Origin: "https://console.invalid",
            "Cf-Access-Jwt-Assertion": jwt,
          },
        }),
        login = await createConsoleSession(req, {}, c, Date.now(), resolver);
      const write = new Request("https://console.invalid/api/admin/sources", {
          method: "POST",
          headers: {
            Origin: "https://console.invalid",
            Cookie: login.cookie.split(";")[0],
            "X-Console-CSRF": login.csrf,
            "Cf-Access-Jwt-Assertion": jwt,
          },
        }),
        context = await requireConsole(write, true, c, Date.now(), resolver),
        store = new ConsoleStore(
          f.db,
          context.actor,
          undefined,
          context.sessionHash,
        );
      await closeConsoleSession(write, context);
      await expect(
        store.createSource({
          commandId: crypto.randomUUID(),
          displayName: "隔离夹具",
          sourceType: "manual_import",
          campusScope: "unknown",
          websiteUrl: null,
          wechatId: null,
          evidenceUrls: [],
          priority: 3,
          connectorType: "disabled",
          fetchPolicy: { mode: "disabled", maxRequests: 0 },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      f.close();
    }
  });
  it("treats malformed or active-content URLs as validation errors", () => {
    for (const value of [
      "not-a-url",
      "javascript:alert(1)",
      "data:text/html,evil",
      "https://name:password@example.invalid/",
      "https://example.invalid/?token=secret",
    ])
      expect(SafeUrlSchema.safeParse(value).success).toBe(false);
  });
});
