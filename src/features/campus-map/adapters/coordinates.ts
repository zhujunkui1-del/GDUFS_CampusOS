import { z } from "zod";
import { CoordinateSchema, type Coordinate } from "../data/campus";

export async function convertCampusCoordinates(coordinates: Coordinate[]): Promise<Coordinate[]> {
  const response = await fetch("/api/map/coordinates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coordinates, crs: "WGS84" }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("高德校园坐标转换失败，请检查地图服务配置后重试。");
  const result = z.object({ ok: z.literal(true), data: z.object({ coordinatesGcj02: z.array(CoordinateSchema), crs: z.literal("GCJ-02") }) }).parse(await response.json());
  if (result.data.coordinatesGcj02.length !== coordinates.length) throw new Error("地图坐标转换响应不完整。");
  return result.data.coordinatesGcj02;
}
