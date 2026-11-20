import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";

const env: Record<string, string | undefined> = {};
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));
import {
  buildPlatformRuntime,
  envPlatformModelState,
  platformModelState,
} from "@/lib/server/models/runtime";

describe("platform model state", () => {
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    for (const key of Object.keys(env)) delete env[key];
  });
  afterEach(() => fixture.close());

  it("reads the saved switch and order, and reports an unparsable policy as fallback", async () => {
    const state = await platformModelState(fixture.db);
    expect(state.enabled).toBe(true);
    expect(state.policy.order).toEqual(["deepseek", "stepfun"]);
    expect(state.policy.tiers).toEqual({
      deepseek: true,
      stepfun: true,
      gdufs: false,
    });
    expect(state.fallback).toBe(false);

    fixture.sqlite
      .prepare(
        // Valid JSON that fails the policy schema: the chain must fall back to
        // the Worker variables instead of guessing.
        "UPDATE console_engine_settings SET platform_models_json='{\"order\":[]}' WHERE id='console-v2-settings'",
      )
      .run();
    const broken = await platformModelState(fixture.db);
    expect(broken.fallback).toBe(true);
    expect(broken.policy.order).toEqual(["deepseek", "stepfun"]);
  });

  it("stops the chain when the master switch is off", async () => {
    env.MODEL_API_KEY = "fixture-key";
    env.MODEL_NAME = "deepseek-flash";
    fixture.sqlite
      .prepare(
        "UPDATE console_engine_settings SET platform_model_enabled=0 WHERE id='console-v2-settings'",
      )
      .run();
    const state = await platformModelState(fixture.db);
    expect(() => buildPlatformRuntime(state)).toThrow(
      "平台模型已由管理员停用。",
    );
  });

  it("refuses a policy that enables the switch but leaves every tier off", async () => {
    fixture.sqlite
      .prepare(
        "UPDATE console_engine_settings SET platform_models_json=? WHERE id='console-v2-settings'",
      )
      .run(
        JSON.stringify({
          order: ["deepseek"],
          tiers: { deepseek: false, stepfun: false, gdufs: false },
        }),
      );
    const state = await platformModelState(fixture.db);
    expect(() => buildPlatformRuntime(state)).toThrow(
      "平台模型没有启用的层级。",
    );
  });

  it("keeps the Worker variables as the chain when no database handle is available", () => {
    env.MODEL_PRIORITY = "stepfun";
    const state = envPlatformModelState();
    expect(state.fallback).toBe(true);
    expect(state.policy.order).toEqual(["stepfun", "deepseek"]);
    expect(state.policy.tiers.stepfun).toBe(true);
  });
});
