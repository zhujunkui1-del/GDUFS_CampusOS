import {
  RouteOutputSchema,
  type RouteSnapshot,
} from "@/domain/maps/skill-contracts";
import { ApiError } from "../errors";

export interface RouteSnapshotStore {
  save(owner: string, route: RouteSnapshot): Promise<void>;
  get(
    owner: string,
    routeId: string,
    versions: { mapVersion: string; networkVersion: string },
  ): Promise<RouteSnapshot>;
}

// Short-lived, bounded, isolate-local storage. No device position or route is written to D1/logs.
// S2-C must supply shared session/route storage before relying on cross-isolate continuity.
export class MemoryRouteSnapshotStore implements RouteSnapshotStore {
  #routes = new Map<string, { owner: string; route: RouteSnapshot }>();
  constructor(
    private readonly now = () => Date.now(),
    private readonly maxRoutes = 100,
  ) {}
  async save(owner: string, value: RouteSnapshot) {
    const route = RouteOutputSchema.parse(value);
    for (const [id, item] of this.#routes)
      if (Date.parse(item.route.expiresAt) <= this.now())
        this.#routes.delete(id);
    if (!this.#routes.has(route.routeId) && this.#routes.size >= this.maxRoutes)
      this.#routes.delete(this.#routes.keys().next().value!);
    this.#routes.set(route.routeId, { owner, route: structuredClone(route) });
  }
  async get(
    owner: string,
    routeId: string,
    versions: { mapVersion: string; networkVersion: string },
  ) {
    const item = this.#routes.get(routeId);
    if (!item || item.owner !== owner)
      throw new ApiError("NOT_FOUND", "路线不存在或已失效，请重新规划。");
    if (Date.parse(item.route.expiresAt) <= this.now()) {
      this.#routes.delete(routeId);
      throw new ApiError("NOT_FOUND", "路线不存在或已失效，请重新规划。");
    }
    if (
      item.route.mapVersion !== versions.mapVersion ||
      item.route.networkVersion !== versions.networkVersion
    )
      throw new ApiError(
        "ROUTE_UNAVAILABLE",
        "地图数据版本已变化，请重新规划。",
      );
    return structuredClone(item.route);
  }
}
