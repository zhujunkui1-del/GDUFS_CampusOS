import { z } from "zod";
import { CoordinateSchema, type Coordinate } from "../data/campus";

export async function convertCampusCoordinates(
  coordinates: Coordinate[],
  signal?: AbortSignal,
): Promise<Coordinate[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("/api/map/coordinates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates, crs: "WGS84" }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(body);
      if (
        error.success &&
        error.data.error.code === "RATE_LIMITED" &&
        attempt < 2
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, 800 * (attempt + 1)),
        );
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        continue;
      }
      throw new Error("高德校园坐标转换失败，请检查地图服务配置后重试。");
    }
    const result = z
      .object({
        ok: z.literal(true),
        data: z.object({
          coordinatesGcj02: z.array(CoordinateSchema),
          crs: z.literal("GCJ-02"),
        }),
      })
      .parse(body);
    if (result.data.coordinatesGcj02.length !== coordinates.length)
      throw new Error("地图坐标转换响应不完整。");
    return result.data.coordinatesGcj02;
  }
  throw new Error("地图转换服务正在限流，请稍后重试。");
}
