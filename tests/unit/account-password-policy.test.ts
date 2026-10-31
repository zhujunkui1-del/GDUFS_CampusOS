import { it, expect, vi } from "vitest";
import { accountFixture } from "../fixtures/account";
import { AccountService } from "@/lib/server/account/email";
it("registers, changes and resets length-valid passwords without any external lookup", async () => {
  const f = accountFixture();
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("No external password lookup allowed"));
  try {
    const service = new AccountService(f.db, {
      origin: f.store.origin,
      otpSecret: f.store.otpSecret,
      now: f.store.now,
      mailer: f.store.mailer,
    });
    const signup = await service.registrationCode(
      { username: "password", email: "fixture@example.com" },
      "fixture-ip",
    );
    const a = await service.register(
      {
        username: "password",
        password: "password",
        email: "fixture@example.com",
        challenge: signup.challenge,
        code: f.lastCode(),
      },
      f.request(),
      "fixture-ip",
    );
    expect(a.profile.username).toBe("password");
    const changed = await service.changePassword(
      { currentPassword: "password", newPassword: "11111111" },
      f.request(a.token),
    );
    expect(
      (
        await service.login(
          { identifier: "password", password: "11111111" },
          f.request(),
          "login-one",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    const reset = await service.requestReset(
      { email: "fixture@example.com" },
      "reset-ip",
      (p) => {
        void p;
      },
    );
    await service.confirmReset({
      challenge: reset.challenge,
      code: f.lastCode(),
      newPassword: "12345678",
    });
    expect(
      (
        await service.login(
          { identifier: "password", password: "12345678" },
          f.request(),
          "login-two",
        )
      ).profile.id,
    ).toBe(a.profile.id);
    expect(await service.resolve(f.request(changed.token))).toBeNull();
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    f.close();
  }
}, 15000);
