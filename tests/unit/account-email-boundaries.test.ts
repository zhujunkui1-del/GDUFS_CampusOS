import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
import { createAccountApi } from "@/lib/server/account/api";
import { OtpSchema } from "@/domain/account/contracts";
it("lets a shared mailbox use one password then establishes a one-time session for the selected account", async () => {
  const f = accountFixture();
  try {
    const email = "shared@example.com";
    const register = async (username: string, password: string) => {
      const { challenge } = await f.store.registrationCode(
        { username, email },
        username,
      );
      return f.store.register(
        { username, email, password, challenge, code: f.lastCode() },
        f.request(),
        username,
      );
    };
    const a = await register("Alice", "Alice-Fixture-Password");
    f.advance(60001);
    const b = await register("Bobby", "Bobby-Fixture-Password");
    const api = createAccountApi({
      store: f.store,
      enabled: true,
      defer: () => {},
    });
    const post = (path: string, data: unknown) =>
      api(
        new Request(`https://campus.example/api/auth/login${path}`, {
          method: "POST",
          headers: {
            Origin: "https://campus.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        }),
      );
    const bad = await post("", {
      identifier: email,
      password: "wrong",
      selectAccount: true,
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).not.toHaveProperty("data");
    const first = await post("", {
      identifier: email,
      password: "Alice-Fixture-Password",
      selectAccount: true,
    });
    expect(first.headers.get("Set-Cookie")).toBeNull();
    const { choiceToken, accounts } = (await first.json()).data;
    expect(accounts).toEqual(["Alice", "Bobby"]);
    const picks = await Promise.all([
      post("/select", { choiceToken, index: 1 }),
      post("/select", { choiceToken, index: 0 }),
    ]);
    expect(picks.map((r) => r.status).sort()).toEqual([200, 401]);
    const selected =
      (await picks[0].json()).data?.user ?? (await picks[1].json()).data?.user;
    expect(selected.id).toBe(picks[0].ok ? b.profile.id : a.profile.id);
    const second = await post("", {
      identifier: email,
      password: "Bobby-Fixture-Password",
      selectAccount: true,
    });
    const other = (await second.json()).data.choiceToken;
    const pick = await post("/select", { choiceToken: other, index: 0 });
    expect((await pick.json()).data.user.id).toBe(a.profile.id);
    expect(pick.headers.get("Set-Cookie")).toContain("campusos_session=");
    const third = await post("", {
      identifier: email,
      password: "Alice-Fixture-Password",
      selectAccount: true,
    });
    const stale = (await third.json()).data.choiceToken;
    const unlink = await f.store.requestUnbind(f.request(a.token));
    await f.store.unbindEmail(
      { challenge: unlink.challenge, code: f.lastCode() },
      f.request(a.token),
    );
    expect(
      (await post("/select", { choiceToken: stale, index: 1 })).status,
    ).toBe(401);
    const username = await post("", {
      identifier: "Bobby",
      password: "Bobby-Fixture-Password",
    });
    expect((await username.json()).data.user.id).toBe(b.profile.id);
    expect(username.headers.get("Set-Cookie")).toContain("campusos_session=");
  } finally {
    f.close();
  }
});
it("exposes the Console shortcut for the marked account even after a rename", async () => {
  const f = accountFixture();
  try {
    const marked = await f.register("Console01");
    const ordinary = await f.register("OrdinaryUser");
    f.sqlite
      .prepare(
        "UPDATE user_password_identities SET show_console_entry=1 WHERE user_id=?",
      )
      .run(marked.profile.id);
    const api = createAccountApi({
      store: f.store,
      enabled: true,
      defer: () => {},
    });
    async function session(token: string) {
      const response = await api(
        new Request("https://campus.example/api/auth/session", {
          headers: { Cookie: `campusos_session=${token}` },
        }),
      );
      return (await response.json()).data.user;
    }
    expect(await session(marked.token)).toMatchObject({
      showConsoleEntry: true,
    });
    expect(await session(ordinary.token)).toMatchObject({
      showConsoleEntry: false,
    });
    await f.store.rename(
      { username: "RenamedConsole" },
      f.request(marked.token),
    );
    await f.store.rename({ username: "Console01" }, f.request(ordinary.token));
    expect(await session(marked.token)).toMatchObject({
      username: "RenamedConsole",
      showConsoleEntry: true,
    });
    expect(await session(ordinary.token)).toMatchObject({
      username: "Console01",
      showConsoleEntry: false,
    });
  } finally {
    f.close();
  }
});
it("accepts exactly six digits including leading zeroes, never eight digits", () => {
  for (const code of ["000001", "123456", "999999"])
    expect(OtpSchema.safeParse(code).success).toBe(true);
  for (const code of ["12345", "12345678", "１２３４５６", "12 456"])
    expect(OtpSchema.safeParse(code).success).toBe(false);
});
it("bind API exposes challenge at the documented level, never the code", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice"),
      api = createAccountApi({
        store: f.store,
        enabled: true,
        defer: (p) => {
          void p;
        },
      });
    const r = await api(
      new Request("https://campus.example/api/auth/email/bind", {
        method: "POST",
        headers: {
          Origin: "https://campus.example",
          "Content-Type": "application/json",
          Cookie: "campusos_session=" + a.token,
        },
        body: JSON.stringify({
          email: "one@example.com",
        }),
      }),
    );
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(j.data.user.id).toBe(a.profile.id);
    expect(j.data).not.toHaveProperty("code");
  } finally {
    f.close();
  }
});
it("requires the old mailbox code before replacing or unlinking it", async () => {
  const f = accountFixture();
  try {
    const a = await f.legacyPending("Alice", "one@example.com");
    const first = await f.bindingCode(a);
    await f.store.verifyEmail(
      { challenge: first, code: f.lastCode() },
      f.request(a.token),
    );
    await expect(
      f.store.requestEmail({ email: "two@example.com" }, f.request(a.token)),
    ).rejects.toThrow("先解绑");
    await expect(
      f.store.unbindEmail(
        { currentPassword: "Fixture-Password-Only" },
        f.request(a.token),
      ),
    ).rejects.toThrow();
    expect((await f.store.row(a.profile.id))!.verified_email).toBe(
      "one@example.com",
    );
    const unlink = await f.store.requestUnbind(f.request(a.token));
    const code = f.lastCode();
    await f.store.unbindEmail(
      { challenge: unlink.challenge, code },
      f.request(a.token),
    );
    await expect(
      f.store.unbindEmail(
        { challenge: unlink.challenge, code },
        f.request(a.token),
      ),
    ).rejects.toThrow("验证码");
    await expect(
      f.store.login(
        { identifier: "one@example.com", password: "Fixture-Password-Only" },
        f.request(),
        "old",
      ),
    ).rejects.toThrow("不匹配");
    const next = await f.store.requestEmail(
      { email: "two@example.com" },
      f.request(a.token),
    );
    await f.store.verifyEmail(
      { challenge: next.challenge, code: f.lastCode() },
      f.request(a.token),
    );
    expect(
      (
        await f.store.login(
          { identifier: "two@example.com", password: "Fixture-Password-Only" },
          f.request(),
          "new",
        )
      ).profile.id,
    ).toBe(a.profile.id);
  } finally {
    f.close();
  }
});
it("verifies the same mailbox concurrently for distinct accounts and rejects cross-account codes", async () => {
  const f = accountFixture();
  try {
    const a = await f.legacyPending("Alice", "shared@example.com"),
      b = await f.legacyPending("Bobby", "shared@example.com");
    const ca = await f.bindingCode(a),
      codeA = f.lastCode();
    await expect(
      f.store.verifyEmail({ challenge: ca, code: codeA }, f.request(b.token)),
    ).rejects.toThrow("验证码");
    f.advance(60001);
    const cb = await f.bindingCode(b),
      codeB = f.lastCode();
    const results = await Promise.allSettled([
      f.store.verifyEmail({ challenge: ca, code: codeA }, f.request(a.token)),
      f.store.verifyEmail({ challenge: cb, code: codeB }, f.request(b.token)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) n FROM user_password_identities WHERE verified_email=?",
        )
        .get("shared@example.com")?.n,
    ).toBe(2);
  } finally {
    f.close();
  }
});
it("registers multiple accounts with one mailbox and resets only the named account", async () => {
  const f = accountFixture();
  try {
    const email = "shared@example.com",
      password = "Shared-Fixture-Password";
    async function register(username: string) {
      const { challenge } = await f.store.registrationCode(
        { username, email },
        username,
      );
      return f.store.register(
        { username, email, password, challenge, code: f.lastCode() },
        f.request(),
        username,
      );
    }
    const alice = await register("Alice");
    f.advance(60001);
    const bobby = await register("Bobby");
    expect(alice.profile.id).not.toBe(bobby.profile.id);
    await expect(
      f.store.login({ identifier: email, password }, f.request(), "ip"),
    ).rejects.toThrow("使用用户名");
    const mailCount = f.sent.length;
    const ambiguous = await f.store.requestReset({ email }, "ip", () => {});
    expect(ambiguous.challenge).toBeTruthy();
    expect(f.sent).toHaveLength(mailCount);
    f.advance(60001);
    const reset = await f.store.requestReset(
      { email, username: "ALICE" },
      "ip",
      () => {},
    );
    expect(f.sent).toHaveLength(mailCount + 1);
    await f.store.confirmReset({
      challenge: reset.challenge,
      code: f.lastCode(),
      newPassword: "Reset-Fixture-Password",
    });
    await expect(f.store.require(f.request(alice.token))).rejects.toThrow();
    expect((await f.store.require(f.request(bobby.token))).row.user_id).toBe(
      bobby.profile.id,
    );
    expect(
      (
        await f.store.login(
          { identifier: "Bobby", password },
          f.request(),
          "ip",
        )
      ).profile.id,
    ).toBe(bobby.profile.id);
    const a = await f.store.login(
      { identifier: "Alice", password: "Reset-Fixture-Password" },
      f.request(),
      "ip",
    );
    expect(a.profile.id).toBe(alice.profile.id);
    const unlink = await f.store.requestUnbind(f.request(a.token));
    await f.store.unbindEmail(
      { challenge: unlink.challenge, code: f.lastCode() },
      f.request(a.token),
    );
    expect(
      (await f.store.login({ identifier: email, password }, f.request(), "ip"))
        .profile.id,
    ).toBe(bobby.profile.id);
  } finally {
    f.close();
  }
});
it("allows exactly one concurrent password reset and no reset for a pending mailbox", async () => {
  const f = accountFixture();
  try {
    const a = await f.legacyPending("Alice", "one@example.com");
    const first = await f.bindingCode(a);
    await f.store.verifyEmail(
      { challenge: first, code: f.lastCode() },
      f.request(a.token),
    );
    const c = await f.store.requestReset(
      { email: "one@example.com" },
      "ip",
      (p) => {
        void p;
      },
    );
    const code = f.lastCode();
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        f.store.confirmReset({
          challenge: c.challenge,
          code,
          newPassword: "New-Fixture-Password",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await f.legacyPending("Bobby", "pending@example.com");
    const count = f.sent.length;
    const unknown = await f.store.requestReset(
      { email: "pending@example.com" },
      "other",
      (p) => {
        void p;
      },
    );
    expect(unknown.message).toBe(c.message);
    expect(f.sent).toHaveLength(count);
  } finally {
    f.close();
  }
});
