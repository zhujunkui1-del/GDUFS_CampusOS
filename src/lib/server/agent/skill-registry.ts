import { z } from "zod";
import type {
  SkillContext,
  SkillDefinition,
  SkillResult,
} from "@/domain/skills/contracts";
import type { ModelTool } from "@/domain/models/contracts";
import { ApiError } from "../errors";
import type { AgentDomain } from "./domains";

// Schema definitions are immutable server code. Share only frozen metadata;
// executors, permissions and business results remain request-scoped.
const inputParameters = new WeakMap<z.ZodType, Record<string, unknown>>();
function parametersFor(schema: z.ZodType) {
  const cached = inputParameters.get(schema);
  if (cached) return cached;
  const parameters = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  function freeze(value: unknown) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(parameters);
  inputParameters.set(schema, parameters);
  return parameters;
}
const sourcesSchema = z
  .array(
    z
      .object({
        title: z.string().max(200),
        url: z.url().refine((url) => /^https?:\/\//.test(url)),
        publishedAt: z.string().max(50).optional(),
      })
      .strict(),
  )
  .max(20)
  .optional();
const warningsSchema = z.array(z.string().max(200)).max(10).optional();

type RegisteredSkill = {
  name: string;
  version: string;
  domain: AgentDomain;
  tool: ModelTool;
  auth: SkillDefinition<unknown, unknown>["auth"];
  sideEffect: SkillDefinition<unknown, unknown>["sideEffect"];
  requiresConfirmation: boolean;
  timeoutMs: number;
  permissions: readonly string[];
  reuseResultMs: number;
  run(input: unknown, context: SkillContext): Promise<SkillResult<unknown>>;
};
export function canCall(
  skill: Pick<RegisteredSkill, "auth" | "permissions">,
  context: SkillContext,
) {
  if (skill.auth !== "public" && !context.user) return false;
  if (skill.auth === "admin" && context.user?.role !== "admin") return false;
  if (
    skill.auth === "school_authorized" &&
    !context.permissions.includes("school_authorized")
  )
    return false;
  return skill.permissions.every((permission) =>
    context.permissions.includes(permission),
  );
}
export class SkillRegistry {
  #skills = new Map<string, RegisteredSkill>();
  register<I, O>(domain: AgentDomain, definition: SkillDefinition<I, O>) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(definition.name) ||
      this.#skills.has(definition.name) ||
      this.#skills.size >= 16 ||
      !definition.version ||
      !definition.description ||
      definition.timeoutMs < 1 ||
      definition.timeoutMs > 15000
    )
      throw new Error("Invalid or duplicate Skill definition");
    const parameters = parametersFor(definition.inputSchema);
    if (
      definition.reuseResultMs !== undefined &&
      (!Number.isInteger(definition.reuseResultMs) ||
        definition.reuseResultMs < 1 ||
        definition.reuseResultMs > 5000 ||
        definition.auth !== "public" ||
        definition.sideEffect !== "none" ||
        definition.requiresConfirmation)
    )
      throw new Error(
        "Only explicitly approved public snapshot reads may reuse results",
      );
    if (
      parameters.type !== "object" ||
      parameters.additionalProperties !== false
    )
      throw new Error("Skill inputs must be strict object schemas");
    if (
      definition.sideEffect !== "none" &&
      (!definition.requiresConfirmation || definition.auth === "public")
    )
      throw new Error("Writes require authenticated confirmation");
    const skill: RegisteredSkill = {
      name: definition.name,
      version: definition.version,
      domain,
      tool: {
        type: "function",
        function: {
          name: definition.name,
          description: definition.description,
          parameters,
        },
      },
      auth: definition.auth,
      sideEffect: definition.sideEffect,
      requiresConfirmation: definition.requiresConfirmation,
      timeoutMs: definition.timeoutMs,
      permissions: definition.permissions || [],
      reuseResultMs: definition.reuseResultMs || 0,
      async run(input, context) {
        const parsed = definition.inputSchema.safeParse(input);
        if (!parsed.success)
          throw new ApiError("INVALID_ARGUMENT", "工具参数无效。");
        const result = await definition.execute(parsed.data, context);
        if (!result || typeof result.ok !== "boolean")
          throw new ApiError("UPSTREAM_ERROR", "工具结果格式无效。");
        if (result.ok) {
          const output = definition.outputSchema.safeParse(result.data);
          if (!output.success)
            throw new ApiError("UPSTREAM_ERROR", "工具结果未通过验证。");
          const sources = sourcesSchema.parse(result.sources);
          const warnings = warningsSchema.parse(result.warnings);
          return {
            ok: true,
            data: output.data,
            ...(sources ? { sources } : {}),
            ...(warnings ? { warnings } : {}),
          };
        }
        // Service errors are sanitized by the executor rather than forwarding arbitrary messages.
        throw new ApiError(
          result.error.code,
          "工具执行未完成。",
          result.error.retryable,
        );
      },
    };
    this.#skills.set(skill.name, skill);
    return this;
  }
  get(name: string) {
    return this.#skills.get(name);
  }
  tools(context: SkillContext) {
    return [...this.#skills.values()]
      .filter((skill) => canCall(skill, context))
      .map((skill) => skill.tool);
  }
  manifest() {
    return [...this.#skills.values()].map(
      ({ name, version, domain, auth, sideEffect }) => ({
        name,
        version,
        domain,
        auth,
        sideEffect,
      }),
    );
  }
}
