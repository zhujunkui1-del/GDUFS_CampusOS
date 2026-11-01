import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
import { createAccountApi } from "@/lib/server/account/api";
it("sends codes only, with no extra mail on verification, password change/reset or unlink", async () => {
  const f = accountFixture();
  try {
    const a = await f.legacyPending("BudgetUser", "owner@example.com");
    const c = await f.bindingCode(a);
    expect(f.sent).toHaveLength(1);
    await f.store.verifyEmail(
      { challenge: c, code: f.lastCode() },
      f.request(a.token),
    );
    expect(f.sent).toHaveLength(1);
    const tasks: Promise<unknown>[] = [];
    const api = createAccountApi({
      store: f.store,
      enabled: true,
      defer: (p) => tasks.push(p),
    });
    const response = await api(
      new Request("https://campus.example/api/auth/password/change", {
        method: "POST",
        headers: {
          Origin: "https://campus.example",
          "Content-Type": "application/json",
          Cookie: "campusos_session=" + a.token,
        },
        body: JSON.stringify({
          currentPassword: "Fixture-Password-Only",
          newPassword: "Changed-Only",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await Promise.all(tasks);
    expect(f.sent).toHaveLength(1);
    const reset = await f.store.requestReset(
      { email: "owner@example.com" },
      "ip",
      (p) => tasks.push(p),
    );
    await Promise.all(tasks);
    expect(f.sent).toHaveLength(2);
    await f.store.confirmReset({
      challenge: reset.challenge,
      code: f.lastCode(),
      newPassword: "Reset-Only",
    });
    expect(f.sent).toHaveLength(2);
    const login = await f.store.login(
      { identifier: "BudgetUser", password: "Reset-Only" },
      f.request(),
      "login",
    );
    const unlink = await f.store.requestUnbind(f.request(login.token));
    expect(f.sent).toHaveLength(3);
    await f.store.unbindEmail(
      { challenge: unlink.challenge, code: f.lastCode() },
      f.request(login.token),
    );
    expect(f.sent).toHaveLength(3);
  } finally {
    f.close();
  }
});
