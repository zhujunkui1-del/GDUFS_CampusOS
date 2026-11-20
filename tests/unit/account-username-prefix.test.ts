import { afterEach, describe, expect, it } from "vitest";
import { accountFixture } from "../fixtures/account";

const owner = "3287390083@qq.com";
const saved = process.env.OWNER_MAILBOXES;

afterEach(() => {
  if (saved === undefined) delete process.env.OWNER_MAILBOXES;
  else process.env.OWNER_MAILBOXES = saved;
});

function requestCode(
  f: ReturnType<typeof accountFixture>,
  username: string,
  email: string,
) {
  return f.store.registrationCode({ username, email }, "probe");
}

describe("admin-prefixed usernames belong to the owner mailbox", () => {
  it("refuses the prefix when no mailbox is configured", async () => {
    delete process.env.OWNER_MAILBOXES;
    const f = accountFixture();
    try {
      await expect(
        requestCode(f, "admin01", "someone@example.com"),
      ).rejects.toMatchObject({ code: "USERNAME_RESERVED" });
    } finally {
      f.close();
    }
  });

  it("still refuses the prefix for an unrelated mailbox once the owner is configured", async () => {
    process.env.OWNER_MAILBOXES = owner;
    const f = accountFixture();
    try {
      await expect(
        requestCode(f, "Admin01", "someone@example.com"),
      ).rejects.toMatchObject({ code: "USERNAME_RESERVED" });
    } finally {
      f.close();
    }
  });

  it("accepts the prefix for the owner mailbox", async () => {
    process.env.OWNER_MAILBOXES = owner;
    const f = accountFixture();
    try {
      const challenge = await requestCode(f, "Admin01", owner);
      expect(challenge.challenge).toBeTruthy();
    } finally {
      f.close();
    }
  });

  it("applies the same rule to a rename", async () => {
    process.env.OWNER_MAILBOXES = owner;
    const f = accountFixture();
    try {
      const ordinary = await f.register("ordinary_one");
      await expect(
        f.store.rename({ username: "admin02" }, f.request(ordinary.token)),
      ).rejects.toMatchObject({ code: "USERNAME_RESERVED" });

      const holder = await f.register("bound_holder");
      f.sqlite
        .prepare(
          "UPDATE user_password_identities SET verified_email=?, email_verified_at_ms=? WHERE user_id=?",
        )
        .run(owner, 1750000000000, holder.profile.id);
      await f.store.rename({ username: "admin02" }, f.request(holder.token));
      const row = f.sqlite
        .prepare(
          "SELECT username FROM user_password_identities WHERE user_id=?",
        )
        .get(holder.profile.id) as { username: string };
      expect(row.username).toBe("admin02");
    } finally {
      f.close();
    }
  });
});
