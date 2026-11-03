import { z } from "zod";
import type { ModelClient } from "@/domain/models/contracts";

/** A query plan contains evidence-search terms, never answers or invented entities. */
export const QueryUnderstandingSchema = z
  .object({
    subject: z
      .string()
      .min(1)
      .max(120)
      .describe(
        "原句中具体的活动、政策或人物名称；不要把贡献、情况、是否需要等提问目标当主题",
      ),
    entities: z
      .array(z.string().min(1).max(60))
      .max(4)
      .describe("明确的人名、学院全名或地点；学院、学生等泛称不算具体实体"),
    constraints: z
      .array(z.string().min(1).max(60))
      .max(4)
      .describe("原句明确的年份、校区、对象等限定，不添加原文不存在的词"),
    goal: z.enum([
      "facts",
      "procedure",
      "requirements",
      "discovery",
      "registration",
    ]),
  })
  .strict();
export type QueryUnderstanding = z.infer<typeof QueryUnderstandingSchema>;

export function verifiedQueryUnderstanding(raw: unknown, question: string) {
  const plan = QueryUnderstandingSchema.parse(raw);
  const normalized = question.normalize("NFKC").replace(/\s+/g, "");
  const terms = [plan.subject, ...plan.entities, ...plan.constraints];
  const fragments = (term: string) => {
    const literal = term.normalize("NFKC").replace(/\s+/g, "");
    if (normalized.includes(literal)) return [literal];
    // Models sometimes join two copied spans with 的/与. Accept only a complete
    // decomposition into verbatim spans; never accept a new noun or date.
    const parts: string[] = [];
    let remaining = literal;
    while (remaining) {
      if (/^[的和与及]/.test(remaining)) {
        remaining = remaining.slice(1);
        continue;
      }
      let end = remaining.length;
      while (end >= 2 && !normalized.includes(remaining.slice(0, end))) end--;
      if (end < 2)
        throw new Error("Planner introduced a term absent from the question");
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    return parts;
  };
  terms.forEach(fragments);
  // A semantic planner cannot silently drop an explicit year.
  const years = question.match(/\b20\d{2}\b/g) || [];
  const anchors = [
    ...new Set(
      [plan.subject, ...plan.entities, ...plan.constraints].flatMap(fragments),
    ),
  ];
  if (!anchors.length) throw new Error("Invalid query plan");
  return {
    ...plan,
    query: [
      ...anchors.map((term) => `“${term.replace(/[“”]/g, "")}”`),
      ...plan.constraints,
      ...years,
    ]
      .join(" ")
      .slice(0, 300),
  };
}

export async function understandQuery(
  client: ModelClient,
  question: string,
  signal: AbortSignal,
) {
  const started = performance.now();
  const reply = await client.generateWithTools({
    messages: [
      {
        role: "system",
        content:
          "为校园文章检索分离主题和问法，不回答问题。subject取用户所问的核心事项；entities取人物、机构、活动名；constraints保留年份、对象、材料等限定。每个字符串必须逐字摘自用户问题，不能创造词语。不要把请问、了解一下、是否需要、组织等提问动作当作主题。问题中的未知名称也可作为主题。只调用plan_campus_query。",
      },
      { role: "user", content: question },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "plan_campus_query",
          description: "提取查询主题及明确限定",
          parameters: z.toJSONSchema(QueryUnderstandingSchema),
        },
      },
    ],
    toolChoice: { type: "function", function: { name: "plan_campus_query" } },
    maxTokens: 512,
    signal,
  });
  const call = reply.toolCalls[0];
  if (
    reply.toolCalls.length !== 1 ||
    call?.function.name !== "plan_campus_query"
  )
    throw new Error("Invalid query plan");
  return {
    plan: verifiedQueryUnderstanding(
      JSON.parse(call.function.arguments),
      question,
    ),
    usage: reply.usage,
    durationMs: Math.round(performance.now() - started),
  };
}
