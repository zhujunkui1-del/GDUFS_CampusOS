import { it, expect, vi } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/server/account/password";
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
it.each([
  "12345678",
  "password",
  "aaaaaaaa",
  "plainpass",
  "含有汉字的密码一",
  "a b c d!",
])(
  "accepts length-valid password %s without content blacklists",
  (password) => {
    expect(PasswordSchema.safeParse(password).success).toBe(true);
  },
);
it("still rejects fewer than eight characters", () => {
  expect(PasswordSchema.safeParse("1234567").success).toBe(false);
});
