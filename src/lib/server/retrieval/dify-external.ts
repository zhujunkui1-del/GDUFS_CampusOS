import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z, ZodError } from "zod";
import { ApiError, ERROR_STATUS } from "../errors";
import { readJson } from "../assistant/http-context";
import {
  primaryDatabase,
  type SqlDatabase,
} from "../assistant/database";
import { searchContent } from "./skills";

const RequestSchema = z
  .object({
    knowledge_id: z.string().max(128).default(""),
    query: z.string().trim().max(300).default(""),
    retrieval_setting: z
      .object({
        top_k: z.number().int().min(1).max(100),
        score_threshold: z.number().finite().min(0).max(1),
      })
      .strict(),
    metadata_condition: z
      .object({
        logical_operator: z.enum(["and", "or"]).optional(),
        conditions: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .strict();

type DifyRecord = {
  content: string;
  score: number;
  title: string;
  metadata: Record<string, string | number | boolean>;
};

function difyScore(value: number) {
  const positive = Math.max(0, value);
  return Math.round((1 - Math.exp(-positive / 40)) * 10000) / 10000;
}

async function authorized(request: Request, token: string) {
  const incoming = request.headers.get("Authorization") || "";
  if (!incoming.startsWith("Bearer ") || incoming.length > 512) return false;
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [actual, expected] = await Promise.all([
    digest(incoming),
    digest("Bearer " + token),
  ]);
  let different = 0;
  for (let index = 0; index < actual.length; index++)
    different |= actual[index] ^ expected[index];
  return different === 0;
}

function mapFailure(error: unknown) {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    const value = current as { message?: unknown; cause?: unknown };
    if (
      typeof value.message === "string" &&
      /exceeded D1['’]?s free tier daily row (read|write) limit/i.test(
        value.message,
      )
    )
      return {
        status: 503,
        errorCode: 2003,
        message: "校园知识服务暂不可用。",
      };
    current = value.cause;
  }
  if (error instanceof ApiError)
    return {
      status: ERROR_STATUS[error.code],
      errorCode:
        error.code === "UNAUTHORIZED"
          ? 1002
          : error.code === "NOT_FOUND"
            ? 2001
            : error.code === "RATE_LIMITED"
              ? 2002
              : 2003,
      message: error.message,
    };
  if (error instanceof ZodError || error instanceof SyntaxError)
    return {
      status: 400,
      errorCode: 1001,
      message: "检索请求参数无效。",
    };
  return {
    status: 500,
    errorCode: 2003,
    message: "校园知识服务暂不可用。",
  };
}

function recordContent(
  hit: {
    title: string;
    sourceName: string;
    originalUrl: string;
    publishedAt: string | null;
    evidenceType: "full_text" | "excerpt" | "metadata";
    contentSnippet: string;
    validity: string;
    official: boolean;
  },
  activities: Array<{
    name: string;
    kind: "event" | "opportunity" | "notice";
    startsAt: { raw: string; date: string | null; at: string | null } | null;
    endsAt: { raw: string; date: string | null; at: string | null } | null;
    placeRaw: string | null;
    organizer: string | null;
    eventStatus: string;
    historical: boolean;
    registrationState: string;
    registrationWindows: Array<{
      roundLabel: string | null;
      start: { raw: string; date: string | null; at: string | null; evidence: string } | null;
      end: { raw: string; date: string | null; at: string | null; evidence: string } | null;
      deadlineSemantics: string;
      capacityLimited: boolean;
      state: string;
      evidence: string[];
    }>;
  }>,
) {
  const content = [
    "标题：" + hit.title,
    "来源：" + hit.sourceName,
    ...(hit.publishedAt ? ["发布日期：" + hit.publishedAt] : []),
    "原文链接：" + hit.originalUrl,
  ];
  if (hit.evidenceType === "metadata") {
    content.push("正文未向检索服务开放；只能确认标题与来源元数据，不能据此概括文章事实。");
  } else {
    const label =
      hit.evidenceType === "full_text" ? "正文检索片段" : "许可范围内的摘录";
    content.push(label + "：" + hit.contentSnippet);
  }
  content.push("资料有效性：" + hit.validity + "；官方来源：" + (hit.official ? "是" : "否"));
  if (activities.length) {
    const activityEvidence = activities.map((activity) => ({
      name: activity.name,
      kind: activity.kind,
      startsAt: activity.startsAt
        ? { raw: activity.startsAt.raw, date: activity.startsAt.date, at: activity.startsAt.at }
        : null,
      endsAt: activity.endsAt
        ? { raw: activity.endsAt.raw, date: activity.endsAt.date, at: activity.endsAt.at }
        : null,
      placeRaw: activity.placeRaw,
      organizer: activity.organizer,
      eventStatus: activity.eventStatus,
      historical: activity.historical,
      registrationState: activity.registrationState,
      registrationWindows: activity.registrationWindows.map((window) => ({
        roundLabel: window.roundLabel,
        start: window.start
          ? { raw: window.start.raw, date: window.start.date, at: window.start.at, evidence: window.start.evidence }
          : null,
        end: window.end
          ? { raw: window.end.raw, date: window.end.date, at: window.end.at, evidence: window.end.evidence }
          : null,
        deadlineSemantics: window.deadlineSemantics,
        capacityLimited: window.capacityLimited,
        state: window.state,
        evidence: window.evidence,
      })),
    }));
    content.push("已提取的活动证据：" + JSON.stringify(activityEvidence));
  }
  return content.join("\n");
}

export async function difyExternalKnowledgePost(request: Request) {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  let status = 200;
  let resultCount = 0;
  try {
    const env = getCloudflareContext().env as unknown as Record<
      string,
      unknown
    >;
    const expectedOrigin =
      typeof env.ACCOUNT_ORIGIN === "string" ? env.ACCOUNT_ORIGIN : "";
    const expectedHost = expectedOrigin ? new URL(expectedOrigin).host : "";
    const allowedHosts = new Set([expectedHost]);
    const allowedOrigins =
      typeof env.ACCOUNT_ALLOWED_ORIGINS === "string"
        ? env.ACCOUNT_ALLOWED_ORIGINS.split(",").map((value) => value.trim())
        : [];
    for (const origin of allowedOrigins) {
      if (!origin) continue;
      try {
        const url = new URL(origin);
        if (url.protocol === "https:") allowedHosts.add(url.host);
      } catch {
        continue;
      }
    }
    if (
      env.APP_ENV !== "preview" ||
      !expectedHost ||
      !allowedHosts.has(new URL(request.url).host)
    )
      throw new ApiError("NOT_FOUND", "知识源不存在。");

    const token =
      typeof env.DIFY_EXTERNAL_KB_TOKEN === "string"
        ? env.DIFY_EXTERNAL_KB_TOKEN
        : "";
    if (token.length < 32)
      throw new ApiError("SERVICE_UNAVAILABLE", "知识服务尚未配置。");
    if (!(await authorized(request, token)))
      throw new ApiError("UNAUTHORIZED", "知识服务认证失败。");

    const limiter = env.MAP_RATE_LIMITER as
      | { limit(value: { key: string }): Promise<{ success: boolean }> }
      | undefined;
    if (
      limiter &&
      !(
        await limiter.limit({
          key:
            "dify-external-knowledge:" +
            (request.headers.get("CF-Connecting-IP") || "dify-service"),
        })
      ).success
    )
      throw new ApiError("RATE_LIMITED", "知识检索请求较多，请稍后重试。");

    // Dify validates a saved External Knowledge API with an authenticated,
    // empty POST to `/retrieval` before it has a knowledge_id or query.
    // Treat that request as a connectivity probe; do not send it through the
    // normal retrieval schema or touch D1.
    const rawBody = await readJson(request, 4096, true);
    if (rawBody === undefined)
      return Response.json(
        { records: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    const body = RequestSchema.parse(rawBody);
    if (body.metadata_condition?.conditions?.length)
      throw new ApiError("INVALID_ARGUMENT", "当前知识源不支持元数据筛选。");
    if (
      !body.query ||
      ![
        "campusos-public-knowledge-v1",
        "campusos-public-events-v1",
      ].includes(body.knowledge_id)
    )
      return Response.json(
        { records: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (!env.DB)
      throw new ApiError("SERVICE_UNAVAILABLE", "知识服务暂不可用。");

    const purpose =
      body.knowledge_id === "campusos-public-events-v1"
        ? "events"
        : "knowledge";
    const topK = Math.min(body.retrieval_setting.top_k, 4);
    const result = await searchContent(
      primaryDatabase(env.DB as SqlDatabase),
      purpose,
      { query: body.query, limit: topK },
      new Date().toISOString(),
      request.signal,
    );
    const activitiesByDocument = new Map<string, typeof result.activities>();
    for (const activity of result.activities) {
      const items = activitiesByDocument.get(activity.documentId) || [];
      items.push(activity);
      activitiesByDocument.set(activity.documentId, items);
    }
    const records: DifyRecord[] = result.hits.map((hit) => {
      const activityFacts = activitiesByDocument.get(hit.documentId) || [];
      const score = difyScore(hit.relevanceScore);
      return {
        content: recordContent(hit, activityFacts),
        score,
        title: hit.title,
        metadata: {
          documentId: hit.documentId,
          sourceName: hit.sourceName,
          sourceUrl: hit.originalUrl,
          evidenceType: hit.evidenceType,
          bodyAvailable: hit.bodyAvailable,
          bodyPartial: hit.bodyPartial,
          validity: hit.validity,
          official: hit.official,
          documentVersion: hit.documentVersion,
          contentRevision: hit.contentRevision,
          classificationState: hit.classificationState,
          relevanceScore: hit.relevanceScore,
          ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
          ...(hit.radarCategory ? { radarCategory: hit.radarCategory } : {}),
          ...(hit.knowledgeCategory
            ? { knowledgeCategory: hit.knowledgeCategory }
            : {}),
        },
      };
    });
    const recordsFiltered = records.filter(
      (record) => record.score >= body.retrieval_setting.score_threshold,
    );
    resultCount = recordsFiltered.length;
    return Response.json(
      { records: recordsFiltered },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = mapFailure(error);
    status = failure.status;
    return Response.json(
      { error_code: failure.errorCode, error_msg: failure.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    console.info(
      JSON.stringify({
        event: "dify.external_knowledge",
        requestId,
        status,
        records: resultCount,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
}
