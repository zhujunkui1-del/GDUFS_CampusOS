import { getCloudflareContext } from "@opennextjs/cloudflare";
import { FeedbackInputSchema, type FeedbackItem } from "@/domain/feedback";
import { primaryDatabase, type SqlDatabase } from "./assistant/database";
import { readJson, sameOrigin } from "./assistant/http-context";
import { imageStatement } from "./building-media";
import { ApiError } from "./errors";
import { withApi } from "./http";

export async function submitFeedback(
  db: SqlDatabase,
  input: unknown,
  files: File[] = [],
) {
  const value = FeedbackInputSchema.parse(input);
  const id = crypto.randomUUID();
  const images = await Promise.all(
    files.map((file) => imageStatement(db, file, "feedback", id)),
  );
  const insert = db
    .prepare(
      "INSERT INTO project_feedback(id,nickname,content,submitted_at) VALUES(?,?,?,?)",
    )
    .bind(id, value.nickname, value.content, new Date().toISOString());
  await db.batch([insert, ...images.map((image) => image.statement)]);
  return { submitted: true };
}

export const feedbackPost = withApi(async (request) => {
  sameOrigin(request);
  const env = getCloudflareContext().env as unknown as {
    DB: SqlDatabase;
    MAP_RATE_LIMITER?: {
      limit(value: { key: string }): Promise<{ success: boolean }>;
    };
  };
  if (request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
    if (
      env.MAP_RATE_LIMITER &&
      !(
        await env.MAP_RATE_LIMITER.limit({
          key:
            "feedback-images:" +
            (request.headers.get("CF-Connecting-IP") || "local"),
        })
      ).success
    )
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试。", true);
    const form = await request.formData();
    return submitFeedback(
      primaryDatabase(env.DB),
      { nickname: form.get("nickname") || "", content: form.get("content") },
      form
        .getAll("images")
        .filter((file): file is File => file instanceof File),
    );
  }
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
    const images = await db
      .prepare(
        "SELECT id,feedback_id,name FROM project_images WHERE kind='feedback' ORDER BY created_at,id",
      )
      .all<{ id: string; feedback_id: string; name: string }>();
    for (const item of results)
      item.images = images.results
        .filter((image) => image.feedback_id === item.id)
        .map((image) => ({
          id: image.id,
          name: image.name,
          url: "/api/admin/feedback-image?id=" + image.id,
        }));
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
