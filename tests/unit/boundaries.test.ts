import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requireAdmin,
  requireOwner,
  requireUser,
  type VerifiedSession,
} from "@/lib/server/auth";
import { withApi } from "@/lib/server/http";
import { readServerEnv } from "@/lib/server/env";
import { MapActionSchema } from "@/domain/maps/contracts";

const now = 1000;
const session: VerifiedSession = {
  user: { id: "test-user", role: "user" },
  expiresAt: 2000,
  revokedAt: null,
};
afterEach(() => vi.restoreAllMocks());

describe("server-owned authorization boundary", () => {
  it("rejects anonymous, expired and revoked sessions", () => {
    expect(() => requireUser(null, now)).toThrow(/登录会话/);
    expect(() => requireUser({ ...session, expiresAt: now }, now)).toThrow();
    expect(() => requireUser({ ...session, revokedAt: 999 }, now)).toThrow();
  });
  it("does not let an admin role read another account's private data", () => {
    const admin: VerifiedSession = {
      ...session,
      user: { ...session.user, role: "admin" },
    };
    expect(() => requireOwner(admin, "other-user", now)).toThrow(/其他账号/);
    expect(requireOwner(session, "test-user", now).id).toBe("test-user");
    expect(() => requireAdmin(session, now)).toThrow(/管理员/);
  });
});

describe("API errors and audit fields", () => {
  it("hides upstream secrets in error responses and logs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = withApi(() => {
      throw new Error("MODEL_API_KEY=secret-test-value");
    });
    const response = await handler(
      new Request("https://example.invalid/api/test", {
        headers: { "X-Request-Id": "untrusted" },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.requestId).not.toBe("untrusted");
    expect(JSON.stringify(body)).not.toContain("secret-test-value");
    expect(log.mock.calls.flat().join()).not.toContain("secret-test-value");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not disclose invalid environment values", () => {
    expect(() =>
      readServerEnv({ MODEL_BASE_URL: "private-secret-invalid-url" }),
    ).toThrow("MODEL_BASE_URL");
    try {
      readServerEnv({ MODEL_BASE_URL: "private-secret-invalid-url" });
    } catch (error) {
      expect(String(error)).not.toContain("private-secret-invalid-url");
    }
  });
});

describe("declarative map-action contract", () => {
  it("rejects arbitrary JS, unknown actions and extra executable fields", () => {
    expect(
      MapActionSchema.safeParse({ type: "EVAL", code: "alert(1)" }).success,
    ).toBe(false);
    expect(
      MapActionSchema.safeParse({
        type: "FOCUS_PLACE",
        placeId: "test-only",
        eval: "alert(1)",
      }).success,
    ).toBe(false);
    expect(
      MapActionSchema.safeParse({
        type: "SET_LAYER",
        layer: "private-users",
        visible: true,
      }).success,
    ).toBe(false);
  });
  it("bounds action payloads and retains known actions", () => {
    expect(
      MapActionSchema.safeParse({
        type: "SHOW_PLACES",
        placeIds: Array(101).fill("test-only"),
      }).success,
    ).toBe(false);
    expect(
      MapActionSchema.safeParse({
        type: "FOCUS_PLACE",
        placeId: "test-only",
        zoom: 21,
      }).success,
    ).toBe(false);
    expect(
      MapActionSchema.safeParse({
        type: "FOCUS_PLACE",
        placeId: "test-only",
        zoom: 16,
      }).success,
    ).toBe(true);
  });
});
