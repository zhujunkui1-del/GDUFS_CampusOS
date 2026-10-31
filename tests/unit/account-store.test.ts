import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
import { createAccountApi } from "@/lib/server/account/api";
import { authLimit } from "@/lib/server/account/security";
import { AssistantStore } from "@/lib/server/assistant/store";
it("registers without email, normalises usernames, uses stable IDs and never trusts client user IDs", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice"),
      b = await f.register("Bobby");
    expect(a.profile.email).toBeNull();
    expect(
      (
        await f.store.login(
          { identifier: "ALICE", password: "Fixture-Password-Only" },
          f.request(),
          "ip",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    await expect(f.register("alice")).rejects.toThrow("用户名");
    const renamed = await f.store.rename(
      { username: "Alice_New", currentPassword: "Fixture-Password-Only" },
      f.request(a.token),
    );
    expect(renamed.id).toBe(a.profile.id);
    expect((await f.store.resolve(f.request(b.token)))?.row.user_id).toBe(
      b.profile.id,
    );
    await expect(
      f.store.rename(
        {
          username: "steal",
          currentPassword: "Fixture-Password-Only",
          userId: b.profile.id,
        },
        f.request(a.token),
      ),
    ).rejects.toThrow();
    await f.store.logout(f.request(a.token));
    expect(await f.store.resolve(f.request(a.token))).toBeNull();
  } finally {
    f.close();
  }
});
it("database uniqueness serialises concurrent case-insensitive registration without orphan users", async () => {
  const f = accountFixture();
  try {
    const r = await Promise.allSettled([
      f.register("RaceName"),
      f.register("racename"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM users").get()).toEqual({
      n: 1,
    });
  } finally {
    f.close();
  }
});
it("password changes revoke old devices, preserve user identity and reject a stale current password", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice"),
      other = await f.store.login(
        { identifier: "alice", password: "Fixture-Password-Only" },
        f.request(),
        "second",
      );
    const next = await f.store.changePassword(
      {
        currentPassword: "Fixture-Password-Only",
        newPassword: "New-Fixture-Password",
      },
      f.request(a.token),
    );
    expect(next.profile.id).toBe(a.profile.id);
    expect(await f.store.resolve(f.request(a.token))).toBeNull();
    expect(await f.store.resolve(f.request(other.token))).toBeNull();
    expect(await f.store.resolve(f.request(next.token))).not.toBeNull();
    await expect(
      f.store.login(
        { identifier: "alice", password: "Fixture-Password-Only" },
        f.request(),
        "wrong",
      ),
    ).rejects.toThrow("不匹配");
  } finally {
    f.close();
  }
});
it("verifies email by six digit code, enforces one use and uses one ID for email and username login", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice", "One@Example.com");
    await expect(
      f.store.login(
        { identifier: "one@example.com", password: "Fixture-Password-Only" },
        f.request(),
        "mail",
      ),
    ).rejects.toThrow("不匹配");
    const challenge = await f.store.registrationCode(a.profile.id, (p) => {
      void p;
    });
    const code = f.lastCode();
    await f.store.verifyEmail({ challenge, code }, f.request(a.token));
    expect(
      (
        await f.store.login(
          { identifier: "ONE@example.com", password: "Fixture-Password-Only" },
          f.request(),
          "mail",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    await expect(
      f.store.verifyEmail({ challenge, code }, f.request(a.token)),
    ).rejects.toThrow("验证码");
    const persisted = f.sqlite.prepare("SELECT * FROM user_auth_tokens").get()!;
    expect(persisted).not.toHaveProperty("code");
    expect(persisted.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(persisted)).not.toContain(code);
  } finally {
    f.close();
  }
});
it("locks a challenge after five guesses and rejects expiration without leaking the code", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice", "one@example.com");
    const challenge = await f.store.registrationCode(a.profile.id, (p) => {
      void p;
    });
    const code = f.lastCode(),
      wrong = code === "000000" ? "111111" : "000000";
    const r = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        f.store.verifyEmail({ challenge, code: wrong }, f.request(a.token)),
      ),
    );
    expect(r.every((x) => x.status === "rejected")).toBe(true);
    expect(
      f.sqlite.prepare("SELECT attempts FROM user_auth_tokens").get(),
    ).toEqual({ attempts: 5 });
    await expect(
      f.store.verifyEmail({ challenge, code }, f.request(a.token)),
    ).rejects.toThrow("验证码");
    f.advance(3600001);
    const next = await f.store.registrationCode(a.profile.id, (p) => {
      void p;
    });
    const value = f.lastCode();
    f.advance(600001);
    await expect(
      f.store.verifyEmail({ challenge: next, code: value }, f.request(a.token)),
    ).rejects.toThrow("验证码");
  } finally {
    f.close();
  }
});
it("password reset requires a verified mailbox code and atomically invalidates old passwords, sessions and codes", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice", "one@example.com");
    const challenge = await f.store.registrationCode(a.profile.id, (p) => {
      void p;
    });
    await f.store.verifyEmail(
      { challenge, code: f.lastCode() },
      f.request(a.token),
    );
    const reset = await f.store.requestReset(
      { email: "one@example.com" },
      "ip",
      (p) => {
        void p;
      },
    );
    const code = f.lastCode();
    await f.store.confirmReset({
      challenge: reset.challenge,
      code,
      newPassword: "Reset-Fixture-Password",
    });
    expect(await f.store.resolve(f.request(a.token))).toBeNull();
    await expect(
      f.store.confirmReset({
        challenge: reset.challenge,
        code,
        newPassword: "Again-Fixture-Password",
      }),
    ).rejects.toThrow("验证码");
    expect(
      (
        await f.store.login(
          { identifier: "alice", password: "Reset-Fixture-Password" },
          f.request(),
          "new",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    await expect(
      f.store.login(
        { identifier: "alice", password: "Fixture-Password-Only" },
        f.request(),
        "old",
      ),
    ).rejects.toThrow("不匹配");
  } finally {
    f.close();
  }
});
it("preserves an authenticated visitor conversation across registration, login and logout without claiming it", async () => {
  const f = accountFixture();
  try {
    const assistant = new AssistantStore(f.db);
    const guest = await assistant.identity(f.request());
    const cookie = guest.cookie.split(";")[0];
    const conversation = await assistant.conversation(guest);
    const a = await f.register("Alice");
    const logged = new Request("https://campus.example/api/agent/session", {
      headers: { Cookie: cookie + "; campusos_session=" + a.token },
    });
    const identity = await assistant.identity(logged);
    expect(identity.owner).toBe(guest.owner);
    expect(identity.user).toBeNull();
    expect((await assistant.conversation(identity, conversation.id)).id).toBe(
      conversation.id,
    );
    await f.store.logout(f.request(a.token));
    expect((await assistant.identity(logged)).owner).toBe(guest.owner);
  } finally {
    f.close();
  }
});
it("checks origin, strict personal schemas, cookie safety and keeps hashes and codes out of HTTP JSON", async () => {
  const f = accountFixture(false);
  try {
    const api = createAccountApi({
      store: f.store,
      enabled: true,
      defer: (p) => {
        void p;
      },
    });
    const make = (
      path: string,
      body: unknown,
      origin = "https://campus.example",
      cookie = "",
    ) =>
      new Request("https://campus.example" + path, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await api(
          make(
            "/api/auth/register",
            { username: "Alice", password: "Fixture-Password-Only" },
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    const response = await api(
      make("/api/auth/register", {
        username: "Alice",
        password: "Fixture-Password-Only",
      }),
    );
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(
      /password_hash|isolated:|token_hash/,
    );
    expect(response.headers.get("Set-Cookie")).toMatch(
      /HttpOnly; Secure; SameSite=Lax/,
    );
    expect(
      (await api(new Request("https://campus.example/api/me"))).status,
    ).toBe(401);
    expect(
      (
        await api(
          new Request("https://campus.example/api/auth/session", {
            headers: { Cookie: "campusos_console=some-admin-cookie" },
          }),
        )
      ).status,
    ).toBe(200);
    const current = await api(
      new Request("https://campus.example/api/auth/session", {
        headers: { Cookie: "campusos_console=some-admin-cookie" },
      }),
    );
    expect((await current.json()).data.user).toBeNull();
  } finally {
    f.close();
  }
});
it("rate limits atomically and revokes sessions when account state changes", async () => {
  const f = accountFixture();
  try {
    const r = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        authLimit(f.db, "fixture", "same", 3, 60000),
      ),
    );
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    const a = await f.register("Alice");
    f.sqlite
      .prepare("UPDATE users SET status='disabled' WHERE id=?")
      .run(a.profile.id);
    expect(await f.store.resolve(f.request(a.token))).toBeNull();
  } finally {
    f.close();
  }
});
