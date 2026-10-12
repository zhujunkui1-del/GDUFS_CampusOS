import { z } from "zod";
import { CoordinateSchema } from "@/features/campus-map/data/campus";
import { withApi } from "@/lib/server/http";
import { ApiError } from "@/lib/server/errors";
import { mapRuntime } from "@/lib/server/map-env";
import { proxyAMap } from "@/lib/server/amap-proxy";

export const dynamic = "force-dynamic";
export const POST = withApi(async (request) => {
  const body = z.object({ coordinates: z.array(CoordinateSchema).min(1).max(40), crs: z.literal("WGS84") }).strict().parse(await request.json());
  if (body.coordinates.some(([lng,lat]) => lng < 113.38 || lng > 113.41 || lat < 23.05 || lat > 23.085)) throw new ApiError("OUT_OF_CAMPUS", "仅转换大学城校园研究范围坐标。");
  const { env } = mapRuntime();
  const url = new URL(request.url);
  url.pathname = "/_AMapService/v3/assistant/coordinate/convert";
  url.search = new URLSearchParams({ key: env.AMAP_WEB_KEY || "", platform: "JS", s: "rsv3", output: "json", coordsys: "gps", locations: body.coordinates.map((p) => p.join(",")).join(";") }).toString();
  const result = await proxyAMap(new Request(url, { headers: request.headers }), ["v3","assistant","coordinate","convert"]);
  const data = z.object({ status: z.string(), locations: z.string().optional() }).parse(await result.json());
  if (data.status !== "1" || !data.locations) throw new ApiError("UPSTREAM_ERROR", "高德坐标转换未成功，请检查服务配置。");
  const coordinatesGcj02 = data.locations.split(";").map((location) => CoordinateSchema.parse(location.split(",").map(Number)));
  if (coordinatesGcj02.length !== body.coordinates.length) throw new ApiError("UPSTREAM_ERROR", "地图坐标转换响应不完整。");
  return { coordinatesGcj02, crs: "GCJ-02", source: "AMap JS security proxy coordinate conversion" };
});
