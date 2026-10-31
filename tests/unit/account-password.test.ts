import { it, expect, vi } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  checkPassword,
} from "@/lib/server/account/password";
import { UsernameSchema, PasswordSchema } from "@/domain/account/contracts";
import { emailCode, codeDigest } from "@/lib/server/account/otp";
it.each(["admin", "ROOT", "ab", "x@y", "has space", "姓名", "bad\u200bname"])(
  "rejects invalid or reserved username %s",
  (s) => expect(UsernameSchema.safeParse(s).success).toBe(false),
);
it("keeps long special-character passwords, hashes with independent salts and matches PBKDF2 standard output", async () => {
  const password = "Synthetic!长密码 ".repeat(5);
  expect(PasswordSchema.safeParse(password).success).toBe(true);
  const a = await hashPassword(password),
    b = await hashPassword(password);
  expect(a).not.toBe(b);
  const [, iterations, salt, result] = a.split("$");
  expect(iterations).toBe("600000");
  expect(result).toBe(
    pbkdf2Sync(
      password,
      Buffer.from(salt, "hex"),
      600000,
      32,
      "sha256",
    ).toString("hex"),
  );
  expect(await verifyPassword(password, a)).toBe(true);
  expect(await verifyPassword("wrong", a)).toBe(false);
  expect(
    await verifyPassword(password, a.replace("$600000$", "$10000000$")),
  ).toBe(false);
}, 10000);
it("retains the same 600k PBKDF2 when a Workers native iteration cap is encountered", async () => {
  const spy = vi
    .spyOn(crypto.subtle, "deriveBits")
    .mockRejectedValueOnce(
      new Error("iteration counts above 100000 are not supported"),
    );
  try {
    const h = await hashPassword("Synthetic-native-cap-test");
    expect(await verifyPassword("Synthetic-native-cap-test", h)).toBe(true);
    expect(h).toContain("$600000$");
  } finally {
    spy.mockRestore();
  }
}, 10000);
it("rejects obvious passwords and fails closed on an invalid breach service response", async () => {
  await expect(checkPassword("password123", "someone")).rejects.toThrow("常见");
  await expect(
    checkPassword(
      "Synthetic-Long-Strong",
      "someone",
      async () => new Response("<html>blocked</html>"),
    ),
  ).rejects.toThrow("暂不可用");
});
it("generates six digit codes and binds the digest to challenge, purpose and server secret", async () => {
  for (let i = 0; i < 100; i++) expect(emailCode()).toMatch(/^\d{6}$/);
  const secret = "fixture".repeat(8);
  const a = await codeDigest(secret, "verify_email", "one", "012345");
  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(a).not.toContain("012345");
  expect(await codeDigest(secret, "reset_password", "one", "012345")).not.toBe(
    a,
  );
  expect(await codeDigest(secret, "verify_email", "two", "012345")).not.toBe(a);
});
it("uses Workers-compatible manual redirect handling and refuses redirects", async () => {
  const transport = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.invalid/" },
      }),
  );
  await expect(
    checkPassword("Synthetic-Long-Strong", "someone", transport),
  ).rejects.toThrow("暂不可用");
  expect(
    (transport.mock.calls[0] as unknown as [string, RequestInit])[1].redirect,
  ).toBe("manual");
});
