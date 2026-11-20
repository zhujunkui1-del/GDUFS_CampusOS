import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ConsoleGovernanceStore } from "@/lib/server/console/v2-governance";
import { ApiError } from "@/lib/server/errors";
import {
  PlatformModelPolicySchema,
  PlatformModelsSaveSchema,
  mayManagePlatformModels,
  parsePlatformModelOperators,
} from "@/domain/console/platform-models";

const admin = {
  id: "test-admin",
  email: "test-admin@example.invalid",
  role: "admin" as const,
};
const operator = {
  id: "test-operator",
  email: "test-operator@example.invalid",
  role: "operator" as const,
};
const owner = {
  id: "test-owner",
  email: "3287390083@qq.com",
  role: "operator" as const,
};
const command = () => ({ commandId: crypto.randomUUID(), expectedVersion: 1 });

describe("platform model controls", () => {
  let fixture: ReturnType<typeof sqliteD1>, store: ConsoleGovernanceStore;
  beforeEach(() => {
    fixture = sqliteD1();
    for (const row of [admin, operator, owner])
      fixture.sqlite
        .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,?)")
        .run(row.id, row.email, row.role);
    store = new ConsoleGovernanceStore(fixture.db, admin);
  });
  afterEach(() => fixture.close());

  it("lets admins and the owner's accounts manage the chain, not operators", () => {
    const operators = parsePlatformModelOperators(
      "admin01, 3287390083, 3287390083@qq.com",
    );
    expect(operators).toEqual(["admin01", "3287390083", "3287390083@qq.com"]);
    expect(mayManagePlatformModels(admin, operators)).toBe(true);
    expect(mayManagePlatformModels(owner, operators)).toBe(true);
    // The mailbox name is enough: the owner named accounts that way.
    expect(
      mayManagePlatformModels(
        { email: "3287390083", role: "operator" },
        operators,
      ),
    ).toBe(true);
    expect(
      mayManagePlatformModels(
        { email: "admin01@example.invalid", role: "operator" },
        operators,
      ),
    ).toBe(true);
    expect(mayManagePlatformModels(operator, operators)).toBe(false);
    expect(mayManagePlatformModels(owner, [])).toBe(false);
  });

  it("rejects a duplicate order and an all-disabled chain while enabled", () => {
    expect(() =>
      PlatformModelsSaveSchema.parse({
        ...command(),
        enabled: true,
        order: ["deepseek", "deepseek"],
        tiers: { deepseek: true, stepfun: false, gdufs: false },
      }),
    ).toThrow("模型顺序不能重复。");
    expect(() =>
      PlatformModelsSaveSchema.parse({
        ...command(),
        enabled: true,
        order: ["deepseek"],
        tiers: { deepseek: false, stepfun: false, gdufs: false },
      }),
    ).toThrow("启用平台模型时至少要开启一个层级。");
  });

  it("stores the switch, the order and the enabled tiers with an audit command", async () => {
    const saved = await store.savePlatformModels({
      ...command(),
      enabled: false,
      order: ["stepfun", "deepseek"],
      tiers: { deepseek: false, stepfun: true, gdufs: false },
      note: "测试停用",
    });
    expect(saved.version).toBe(2);
    const row = fixture.sqlite
      .prepare(
        "SELECT platform_model_enabled,platform_models_json,version FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .get() as {
      platform_model_enabled: number;
      platform_models_json: string;
      version: number;
    };
    expect(row.platform_model_enabled).toBe(0);
    expect(
      PlatformModelPolicySchema.parse(JSON.parse(row.platform_models_json)),
    ).toEqual({
      order: ["stepfun", "deepseek"],
      tiers: { deepseek: false, stepfun: true, gdufs: false },
    });
    const audit = fixture.sqlite
      .prepare(
        "SELECT action,target_id FROM console_commands ORDER BY created_at DESC",
      )
      .get() as { action: string; target_id: string };
    expect(audit.action).toBe("platform.models");
    expect(audit.target_id).toBe("console-v2-settings");
  });

  it("refuses the write for an operator and for a stale version", async () => {
    const payload = {
      ...command(),
      enabled: true,
      order: ["deepseek", "stepfun"],
      tiers: { deepseek: true, stepfun: true, gdufs: false },
    };
    const asOperator = new ConsoleGovernanceStore(fixture.db, operator);
    await expect(asOperator.savePlatformModels(payload)).rejects.toThrow(
      "没有执行此操作的管理权限。",
    );
    const asOwner = new ConsoleGovernanceStore(fixture.db, owner);
    await expect(
      asOwner.savePlatformModels({ ...payload, expectedVersion: 42 }),
    ).rejects.toThrow(ApiError);
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS n FROM console_commands WHERE action='platform.models'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("lets an operator bound to the owner mailbox manage the chain", async () => {
    const previous = {
      mailboxes: process.env.OWNER_MAILBOXES,
      operators: process.env.PLATFORM_MODEL_OPERATORS,
    };
    process.env.OWNER_MAILBOXES = "3287390083@qq.com";
    process.env.PLATFORM_MODEL_OPERATORS = "";
    try {
      const bound = {
        id: "test-admin01",
        email: "admin01@ops.invalid",
        role: "operator" as const,
      };
      fixture.sqlite
        .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,?)")
        .run(bound.id, bound.email, bound.role);
      const unbound = new ConsoleGovernanceStore(fixture.db, bound);
      expect((await unbound.platformModels()).canManage).toBe(false);
      fixture.sqlite
        .prepare(
          "INSERT INTO users(id,display_name,role,status) VALUES('u-admin01','admin01','user','active')",
        )
        .run();
      fixture.sqlite
        .prepare(
          "INSERT INTO user_password_identities(user_id,username,username_norm,password_hash,verified_email,email_verified_at_ms,mutation_id,updated_at_ms) VALUES('u-admin01','admin01','admin01','x','3287390083@qq.com',0,'m',0)",
        )
        .run();
      const asBound = new ConsoleGovernanceStore(fixture.db, bound);
      expect((await asBound.platformModels()).canManage).toBe(true);
      const saved = await asBound.savePlatformModels({
        ...command(),
        enabled: true,
        order: ["stepfun", "deepseek"],
        tiers: { deepseek: true, stepfun: true, gdufs: false },
      });
      expect(saved).toMatchObject({ id: "console-v2-settings" });
      expect(
        fixture.sqlite
          .prepare(
            "SELECT count(*) AS n FROM console_commands WHERE action='platform.models'",
          )
          .get(),
      ).toEqual({ n: 1 });
    } finally {
      if (previous.mailboxes === undefined) delete process.env.OWNER_MAILBOXES;
      else process.env.OWNER_MAILBOXES = previous.mailboxes;
      if (previous.operators === undefined)
        delete process.env.PLATFORM_MODEL_OPERATORS;
      else process.env.PLATFORM_MODEL_OPERATORS = previous.operators;
    }
  });

  it("reports the chain and the routing health it observed", async () => {
    await store.savePlatformModels({
      ...command(),
      enabled: true,
      order: ["deepseek", "stepfun"],
      tiers: { deepseek: true, stepfun: true, gdufs: false },
    });
    const now = Date.now();
    const insert = fixture.sqlite.prepare(
      "INSERT INTO agent_model_events(id,conversation_id,event,provider,model,from_provider,reason_code,created_at_ms) VALUES(?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "e1",
      "c1",
      "resolved",
      "deepseek",
      "deepseek-flash",
      null,
      null,
      now - 2000,
    );
    insert.run(
      "e2",
      "c1",
      "fallback",
      "stepfun",
      "step-3.5-flash",
      "deepseek",
      "MODEL_QUOTA_EXHAUSTED",
      now - 1000,
    );
    insert.run(
      "e3",
      "c2",
      "failed",
      "stepfun",
      "step-3.5-flash",
      null,
      "MODEL_TIMEOUT",
      now - 500,
    );
    const state = await store.platformModels({ hours: 24 });
    expect(state.enabled).toBe(true);
    expect(state.order).toEqual(["deepseek", "stepfun"]);
    expect(state.canManage).toBe(true);
    const deepseek = state.health.providers.find(
      (row) => row.provider === "deepseek",
    );
    const stepfun = state.health.providers.find(
      (row) => row.provider === "stepfun",
    );
    expect(deepseek).toMatchObject({
      resolved: 1,
      fallbacksIn: 0,
      fallbacksOut: 1,
    });
    expect(stepfun).toMatchObject({ resolved: 0, fallbacksIn: 1, failures: 1 });
    expect(state.health.failures).toEqual([
      expect.objectContaining({
        provider: "stepfun",
        code: "MODEL_TIMEOUT",
        count: 1,
      }),
    ]);
    // Health only reads what was recorded; an empty window must say so.
    fixture.sqlite.prepare("DELETE FROM agent_model_events").run();
    const empty = await store.platformModels({ hours: 24 });
    expect(empty.health.providers).toEqual([]);
    expect(empty.health.failures).toEqual([]);
  });
});
