import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FeedbackInputSchema, type FeedbackItem } from "@/domain/feedback";
import { primaryDatabase, type SqlDatabase } from "./assistant/database";
import { readJson, sameOrigin } from "./assistant/http-context";
import { ApiError } from "./errors";
import { withApi } from "./http";

export async function submitFeedback(db: SqlDatabase, input: unknown) {
  const value = FeedbackInputSchema.parse(input);
  await db
    .prepare(
      "INSERT INTO project_feedback(id,nickname,content,submitted_at) VALUES(?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      value.nickname,
      value.content,
      new Date().toISOString(),
    )
    .run();
  return { submitted: true };
}

export const feedbackPost = withApi(async (request) => {
  sameOrigin(request);
  const env = getCloudflareContext().env as unknown as { DB: SqlDatabase };
  return submitFeedback(primaryDatabase(env.DB), await readJson(request));
});

export async function feedbackAdministration(
  db: SqlDatabase,
  request: Request,
  path: string[],
) {
  if (request.method === "GET" && path.length === 0) {
    const { results } = await db
      .prepare(
        "SELECT id,nickname,content,status,submitted_at AS submittedAt FROM project_feedback ORDER BY submitted_at DESC,id DESC",
      )
      .all<FeedbackItem>();
    return {
      pending: results.filter((item) => item.status === "pending"),
      archived: results.filter((item) => item.status === "archived"),
    };
  }
  if (request.method === "POST" && path.length === 2 && path[1] === "archive") {
    await db
      .prepare("UPDATE project_feedback SET status='archived' WHERE id=?")
      .bind(path[0])
      .run();
    return { archived: true };
  }
  throw new ApiError("NOT_FOUND", "未找到该反馈接口。");
}
