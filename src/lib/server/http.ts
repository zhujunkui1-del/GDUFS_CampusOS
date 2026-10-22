import { ZodError } from "zod";
import { ApiError, ERROR_STATUS } from "./errors";

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean };
      requestId: string;
    };

export type ApiContext = { requestId: string };

function databaseDailyLimit(error: unknown): ApiError | undefined {
  // The D1 SDK can put the platform message on either the error or its cause.
  // Match only the published quota signature; never expose raw SQL or bindings.
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    const value = current as { message?: unknown; cause?: unknown };
    const match =
      typeof value.message === "string"
        ? value.message.match(
            /exceeded D1['’]?s free tier daily row (read|write) limit/i,
          )
        : null;
    if (match)
      return new ApiError(
        "SERVICE_UNAVAILABLE",
        `数据库今日${match[1].toLowerCase() === "read" ? "读取" : "写入"}额度已用尽，请在下次北京时间08:00后重试。`,
        true,
      );
    current = value.cause;
  }
}

export function withApi<T>(
  handler: (request: Request, context: ApiContext) => Promise<T> | T,
) {
  return async (request: Request): Promise<Response> => {
    // An incoming request ID is untrusted; generate a server-owned ID.
    const requestId = crypto.randomUUID();
    const start = performance.now();
    let status = 200;
    let code: string | undefined;
    let body: ApiResult<T>;
    try {
      const data = await handler(request, { requestId });
      body = { ok: true, data, requestId };
    } catch (error) {
      const controlled =
        error instanceof ApiError
          ? error
          : (databaseDailyLimit(error) ??
            (error instanceof ZodError || error instanceof SyntaxError
              ? new ApiError("INVALID_ARGUMENT", "请求参数格式不正确。")
              : new ApiError(
                  "INTERNAL_ERROR",
                  "服务暂时遇到问题，请稍后重试。",
                  true,
                )));
      code = controlled.code;
      status = ERROR_STATUS[controlled.code];
      body = {
        ok: false,
        error: {
          code,
          message: controlled.message,
          retryable: controlled.retryable,
        },
        requestId,
      };
    }
    // Explicit fields only: never log bodies, cookies, phone numbers or keys.
    console.info(
      JSON.stringify({
        event: "api.request",
        requestId,
        method: request.method,
        status,
        code,
        durationMs: Math.round(performance.now() - start),
      }),
    );
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  };
}
