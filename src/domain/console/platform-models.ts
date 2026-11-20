import { z } from "zod";

// Tiers are addressed by provider id so the console, the runtime chain and the
// audit log all name the same thing.
export const ModelTierIdSchema = z.enum(["deepseek", "stepfun", "gdufs"]);
export type ModelTierId = z.infer<typeof ModelTierIdSchema>;

export const modelTierIds: readonly ModelTierId[] = [
  "deepseek",
  "stepfun",
  "gdufs",
];

// Stored as JSON in console_engine_settings.platform_models_json. An empty or
// unreadable value means "use the Worker variables", so a bad edit cannot take
// the assistant offline.
export const PlatformModelPolicySchema = z
  .object({
    order: z.array(ModelTierIdSchema).min(1).max(3),
    tiers: z
      .object({
        deepseek: z.boolean(),
        stepfun: z.boolean(),
        gdufs: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type PlatformModelPolicy = z.infer<typeof PlatformModelPolicySchema>;

export const defaultPlatformModelPolicy: PlatformModelPolicy = {
  order: ["deepseek", "stepfun"],
  tiers: { deepseek: true, stepfun: true, gdufs: false },
};

// Console admins may always change the chain. Additional accounts are named by
// the deployment (`PLATFORM_MODEL_OPERATORS`, comma separated, mailbox name or
// full address) so the allowlist is configuration, never a literal in the client
// bundle — the release scan rejects any secret-shaped string in generated code.
export function parsePlatformModelOperators(value: string | undefined | null) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
export function mayManagePlatformModels(
  actor: { email: string; role: string },
  operators: readonly string[] = [],
) {
  if (actor.role === "admin") return true;
  const email = actor.email.trim().toLowerCase();
  const local = email.includes("@")
    ? email.slice(0, email.indexOf("@"))
    : email;
  return operators.some((entry) => {
    const value = entry.trim().toLowerCase();
    return value === email || value === local;
  });
}

export const PlatformModelsSaveSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    enabled: z.boolean(),
    order: z.array(ModelTierIdSchema).min(1).max(3),
    tiers: z
      .object({
        deepseek: z.boolean(),
        stepfun: z.boolean(),
        gdufs: z.boolean(),
      })
      .strict(),
    note: z.string().trim().max(1000).default("管理员更新平台模型设置"),
  })
  .strict()
  .refine((value) => new Set(value.order).size === value.order.length, {
    message: "模型顺序不能重复。",
  })
  .refine(
    (value) =>
      !value.enabled || Object.values(value.tiers).some((enabled) => enabled),
    { message: "启用平台模型时至少要开启一个层级。" },
  );
