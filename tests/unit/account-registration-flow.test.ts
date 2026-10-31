import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
const body = (extra: Record<string, unknown> = {}) => ({
  username: "NewUser",
  password: "12345678",
  email: "owner@example.com",
  ...extra,
});
it("creates no account until registration mailbox code is proven and then binds it immediately", async () => {
  const f = accountFixture();
  try {
    await expect(f.store.register(body(), f.request(), "ip")).rejects.toThrow();
    const c = await f.store.registrationCode(
      { username: "NewUser", email: "Owner@Example.com" },
      "ip",
    );
    const code = f.lastCode();
    expect(f.sqlite.prepare("SELECT count(*) n FROM users").get()?.n).toBe(0);
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(
      f.store.register(
        body({ challenge: c.challenge, code: wrong }),
        f.request(),
        "ip",
      ),
    ).rejects.toThrow("验证码");
    expect(f.sqlite.prepare("SELECT count(*) n FROM users").get()?.n).toBe(0);
    const a = await f.store.register(
      body({ challenge: c.challenge, code }),
      f.request(),
      "ip",
    );
    expect(a.profile.email).toBe("owner@example.com");
    expect(a.profile.pendingEmail).toBeNull();
    expect(
      (
        await f.store.login(
          { identifier: "owner@example.com", password: "12345678" },
          f.request(),
          "login",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    await expect(
      f.store.register(
        body({ challenge: c.challenge, code }),
        f.request(),
        "ip",
      ),
    ).rejects.toThrow("验证码");
    expect(f.sqlite.prepare("SELECT count(*) n FROM users").get()?.n).toBe(1);
  } finally {
    f.close();
  }
});
it("rejects invalid and already bound email before sending registration codes", async () => {
  const f = accountFixture();
  try {
    await expect(
      f.store.registrationCode({ username: "Alice", email: "bad@" }, "ip"),
    ).rejects.toThrow();
    expect(f.sent).toHaveLength(0);
    const c = await f.store.registrationCode(
      { username: "NewUser", email: "owner@example.com" },
      "ip",
    );
    await f.store.register(
      body({ challenge: c.challenge, code: f.lastCode() }),
      f.request(),
      "ip",
    );
    const count = f.sent.length;
    await expect(
      f.store.registrationCode(
        { username: "OtherUser", email: "owner@example.com" },
        "ip",
      ),
    ).rejects.toThrow("邮箱");
    expect(f.sent).toHaveLength(count);
    await expect(
      f.store.registrationCode(
        { username: "NewUser", email: "other@example.com" },
        "ip",
      ),
    ).rejects.toThrow("用户名");
  } finally {
    f.close();
  }
});
it("binds registration proof to username and email and permits exactly one concurrent consumption", async () => {
  const f = accountFixture();
  try {
    const c = await f.store.registrationCode(
        { username: "NewUser", email: "owner@example.com" },
        "ip",
      ),
      code = f.lastCode();
    await expect(
      f.store.register(
        body({ username: "OtherName", challenge: c.challenge, code }),
        f.request(),
        "ip",
      ),
    ).rejects.toThrow("验证码");
    await expect(
      f.store.register(
        body({ email: "other@example.com", challenge: c.challenge, code }),
        f.request(),
        "ip",
      ),
    ).rejects.toThrow("验证码");
    const r = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        f.store.register(
          body({ challenge: c.challenge, code }),
          f.request(),
          "ip",
        ),
      ),
    );
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(f.sqlite.prepare("SELECT count(*) n FROM users").get()?.n).toBe(1);
  } finally {
    f.close();
  }
});
it("locks registration after five incorrect codes, rejects expiry, and allows repeated renames without passwords", async () => {
  const f = accountFixture();
  try {
    const c = await f.store.registrationCode(
        { username: "NewUser", email: "owner@example.com" },
        "ip",
      ),
      code = f.lastCode(),
      wrong = code === "000000" ? "111111" : "000000";
    await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        f.store.register(
          body({ challenge: c.challenge, code: wrong }),
          f.request(),
          "ip",
        ),
      ),
    );
    expect(
      f.sqlite.prepare("SELECT attempts FROM user_auth_tokens").get()?.attempts,
    ).toBe(5);
    await expect(
      f.store.register(
        body({ challenge: c.challenge, code }),
        f.request(),
        "ip",
      ),
    ).rejects.toThrow("验证码");
    f.advance(3600001);
    const n = await f.store.registrationCode(
      { username: "NewUser", email: "owner@example.com" },
      "ip",
    );
    const next = f.lastCode();
    f.advance(600001);
    await expect(
      f.store.register(
        body({ challenge: n.challenge, code: next }),
        f.request(),
        "ip",
      ),
    ).rejects.toThrow("验证码");
    const a = await f.register("Alice");
    await f.store.rename({ username: "AliceNew" }, f.request(a.token));
    expect(
      (await f.store.rename({ username: "AliceAgain" }, f.request(a.token))).id,
    ).toBe(a.profile.id);
  } finally {
    f.close();
  }
});
it("mail unlink proof cannot be consumed by a different user or replaced by a password", async () => {
  const f = accountFixture();
  try {
    const a = await f.legacyPending("Alice", "owner@example.com"),
      b = await f.register("Bobby");
    const bind = await f.bindingCode(a);
    await f.store.verifyEmail(
      { challenge: bind, code: f.lastCode() },
      f.request(a.token),
    );
    const c = await f.store.requestUnbind(f.request(a.token)),
      code = f.lastCode();
    await expect(
      f.store.unbindEmail({ challenge: c.challenge, code }, f.request(b.token)),
    ).rejects.toThrow("验证码");
    await expect(
      f.store.unbindEmail(
        { currentPassword: "Fixture-Password-Only" },
        f.request(a.token),
      ),
    ).rejects.toThrow();
    expect((await f.store.row(a.profile.id))!.verified_email).toBe(
      "owner@example.com",
    );
    await f.store.unbindEmail(
      { challenge: c.challenge, code },
      f.request(a.token),
    );
    expect((await f.store.row(a.profile.id))!.verified_email).toBeNull();
  } finally {
    f.close();
  }
});
