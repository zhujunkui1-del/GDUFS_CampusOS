import { expect, it } from "vitest";
import {
  ASSISTANT_WELCOME,
  ASSISTANT_WELCOME_EXAMPLES,
} from "@/lib/assistant/welcome";
it("keeps a short introduction and six unique examples, only the original one concerns navigation", () => {
  expect(ASSISTANT_WELCOME.length).toBeLessThan(50);
  expect(new Set(ASSISTANT_WELCOME_EXAMPLES).size).toBe(6);
  expect(
    ASSISTANT_WELCOME_EXAMPLES.slice(2).every(
      (q) => !/路线|地图|导航|带我去|在哪/.test(q),
    ),
  ).toBe(true);
});
