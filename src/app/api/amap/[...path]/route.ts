import { proxyAMap } from "@/lib/server/amap-proxy";
import { ApiError, ERROR_STATUS } from "@/lib/server/errors";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    return await proxyAMap(request, (await context.params).path);
  } catch (error) {
    const controlled =
      error instanceof ApiError
        ? error
        : new ApiError("INTERNAL_ERROR", "地图服务暂时不可用。");
    return Response.json(
      { status: "0", info: controlled.code, message: controlled.message },
      {
        status: ERROR_STATUS[controlled.code],
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
