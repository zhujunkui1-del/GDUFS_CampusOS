import { planLocalRoute } from "./local-routing";
import walkwayReview from "./walkway-review.json";
import { planOnlineRoute } from "../adapters/online-services";
import type { RoutePoint } from "../adapters/amap-adapter";
export async function planCampusRoute(start: RoutePoint, end: RoutePoint) {
  const local = planLocalRoute(start, end);
  if (
    !local &&
    (start.zone !== end.zone ||
      start.zone === "connection" ||
      end.zone === "connection")
  )
    throw Error(
      walkwayReview.approved
        ? "当前选点未连接步道，请重新选点。"
        : "跨区通道暂不可用。",
    );
  return local || (await planOnlineRoute(start, end));
}
