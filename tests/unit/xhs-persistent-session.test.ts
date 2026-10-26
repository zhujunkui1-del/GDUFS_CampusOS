import { it, expect } from "vitest";
import {
  parseSavedCookies,
  sessionFromState,
} from "../../services/external-search/persistent-browser.mjs";
it("accepts the existing saved v2 session without exposing extra fields", () => {
  const cookies = parseSavedCookies({
    version: 2,
    seed: 1,
    cookies: [
      {
        name: "session",
        value: "fixture-only",
        domain: ".xiaohongshu.com",
        path: "/",
        expires: 1900000000,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        extra: "ignored",
      },
      { name: "other", value: "not-ours", domain: ".example.test" },
    ],
  });
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).not.toHaveProperty("extra");
  expect(cookies[0].name).toBe("session");
});
it("does not turn missing page data into a false logout", () => {
  expect(sessionFromState(null)).toBe("unknown");
  expect(sessionFromState({ guest: false })).toBe("unknown");
  expect(sessionFromState({ guest: false, userId: "fixture-user" })).toBe(
    "logged_in",
  );
  expect(sessionFromState(null, true)).toBe("login_required");
  expect(sessionFromState(null, false, true)).toBe("verification_required");
});
