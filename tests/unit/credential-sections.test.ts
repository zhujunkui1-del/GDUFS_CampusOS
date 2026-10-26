import { it, expect } from "vitest";
import { stepPlanCredential } from "../../scripts/credential-sections.mjs";
it("reads the Step section and never reuses the DeepSeek key from the same file", () => {
  const deep = "sk-fixture-deepseek-key-with-enough-length",
    step = "fixture_step_plan_key_with_enough_length";
  const text = `DeepSeek API: ${deep}\n阶跃星辰开放平台：https://platform.stepfun.com/\nBase URL：https://api.stepfun.com/step_plan/v1\n接口密钥：${step}`;
  expect(stepPlanCredential(text).apiKey).toBe(step);
  expect(() =>
    stepPlanCredential(text.replace(`接口密钥：${step}`, "")),
  ).toThrow();
  expect(() => stepPlanCredential(`DeepSeek API: ${deep}`)).toThrow();
});
