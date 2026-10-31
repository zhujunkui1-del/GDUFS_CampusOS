import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
import { createAccountApi } from "@/lib/server/account/api";
import { OtpSchema } from "@/domain/account/contracts";
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
          currentPassword: "Fixture-Password-Only",
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
it("preserves old email until new verification, then disables old email login; unbind preserves username login", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice", "one@example.com");
    const first = await f.store.registrationCode(a.profile.id, (p) => {
      void p;
    });
    await f.store.verifyEmail(
      { challenge: first, code: f.lastCode() },
      f.request(a.token),
    );
    const next = await f.store.requestEmail(
      { email: "two@example.com", currentPassword: "Fixture-Password-Only" },
      f.request(a.token),
    );
    expect(next.user.email).toBe("one@example.com");
    await f.store.verifyEmail(
      { challenge: next.challenge, code: f.lastCode() },
      f.request(a.token),
    );
    await expect(
      f.store.login(
        { identifier: "one@example.com", password: "Fixture-Password-Only" },
        f.request(),
        "one",
      ),
    ).rejects.toThrow("不匹配");
    expect(
      (
        await f.store.login(
          { identifier: "two@example.com", password: "Fixture-Password-Only" },
          f.request(),
          "two",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    await f.store.unbindEmail(
      { currentPassword: "Fixture-Password-Only" },
      f.request(a.token),
    );
    await expect(
      f.store.login(
        { identifier: "two@example.com", password: "Fixture-Password-Only" },
        f.request(),
        "two",
      ),
    ).rejects.toThrow("不匹配");
    expect(
      (
        await f.store.login(
          { identifier: "Alice", password: "Fixture-Password-Only" },
          f.request(),
          "name",
        )
      ).profile.id,
    ).toBe(a.profile.id);
  } finally {
    f.close();
  }
});
it("rejects another user consuming a challenge and concurrent verified-mail ownership races", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice", "shared@example.com"),
      b = await f.register("Bobby", "shared@example.com");
    const ca = await f.store.registrationCode(a.profile.id, (p) => {
        void p;
      }),
      codeA = f.lastCode();
    await expect(
      f.store.verifyEmail({ challenge: ca, code: codeA }, f.request(b.token)),
    ).rejects.toThrow("验证码");
    f.advance(60001);
    const cb = await f.store.registrationCode(b.profile.id, (p) => {
        void p;
      }),
      codeB = f.lastCode();
    const results = await Promise.allSettled([
      f.store.verifyEmail({ challenge: ca, code: codeA }, f.request(a.token)),
      f.store.verifyEmail({ challenge: cb, code: codeB }, f.request(b.token)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) n FROM user_password_identities WHERE verified_email=?",
        )
        .get("shared@example.com")?.n,
    ).toBe(1);
  } finally {
    f.close();
  }
});
it("allows exactly one concurrent password reset and no reset for a pending mailbox", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("Alice", "one@example.com");
    const first = await f.store.registrationCode(a.profile.id, (p) => {
      void p;
    });
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
    await f.register("Bobby", "pending@example.com");
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
