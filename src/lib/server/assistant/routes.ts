import { z } from "zod";
import {
  RouteOutputSchema,
  type RouteSnapshot,
} from "@/domain/maps/skill-contracts";
import type { RouteSnapshotStore } from "../maps/route-store";
import type { SqlDatabase } from "./database";
import { signData, verifyData } from "./crypto";
import { ApiError } from "../errors";

export class SharedRouteStore implements RouteSnapshotStore {
  #transient = new Map<string, RouteSnapshot>();
  constructor(
    private readonly db: SqlDatabase,
    private readonly secret: string,
    private readonly now = () => Date.now(),
  ) {}
  async save(owner: string, input: RouteSnapshot) {
    const route = RouteOutputSchema.parse(input);
    await this.db
      .prepare("DELETE FROM assistant_route_refs WHERE expires_at_ms<=?")
      .bind(this.now())
      .run();
    const json =
      route.start.source === "authorized_device_location"
        ? null
        : JSON.stringify(route);
    await this.db
      .prepare(
        "INSERT INTO assistant_route_refs(id,owner_key,expires_at_ms,map_version,network_version,payload_json) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        route.routeId,
        owner,
        Date.parse(route.expiresAt),
        route.mapVersion,
        route.networkVersion,
        json,
      )
      .run();
    this.#transient.set(route.routeId, structuredClone(route));
  }
  async ticket(owner: string, route: RouteSnapshot) {
    return signData({ owner, route }, this.secret);
  }
  async hydrate(owner: string, ticket: string) {
    const value = z
      .object({ owner: z.string(), route: RouteOutputSchema })
      .strict()
      .parse(await verifyData(ticket, this.secret));
    if (
      value.owner !== owner ||
      Date.parse(value.route.expiresAt) <= this.now()
    )
      throw new ApiError("FORBIDDEN", "路线凭证已失效，请重新规划。");
    this.#transient.set(value.route.routeId, value.route);
  }
  async get(
    owner: string,
    routeId: string,
    versions: { mapVersion: string; networkVersion: string },
  ) {
    const row = await this.db
      .prepare(
        "SELECT owner_key,expires_at_ms,map_version,network_version,payload_json FROM assistant_route_refs WHERE id=? AND owner_key=? AND expires_at_ms>?",
      )
      .bind(routeId, owner, this.now())
      .first<{
        owner_key: string;
        expires_at_ms: number;
        map_version: string;
        network_version: string;
        payload_json: string | null;
      }>();
    if (!row) throw new ApiError("NOT_FOUND", "路线已过期，请重新规划。");
    if (
      row.map_version !== versions.mapVersion ||
      row.network_version !== versions.networkVersion
    )
      throw new ApiError("ROUTE_UNAVAILABLE", "地图已更新，请重新规划路线。");
    const route =
      this.#transient.get(routeId) ||
      (row.payload_json
        ? RouteOutputSchema.parse(JSON.parse(row.payload_json))
        : null);
    if (!route)
      throw new ApiError("ROUTE_UNAVAILABLE", "请重新定位并规划路线。");
    return structuredClone(route);
  }
}
