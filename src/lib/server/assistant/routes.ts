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
  #runId?: string;
  constructor(
    private readonly db: SqlDatabase,
    private readonly secret: string,
    private readonly now = () => Date.now(),
    private readonly conversationId?: string,
  ) {}
  forConversation(id: string) {
    return new SharedRouteStore(this.db, this.secret, this.now, id);
  }
  requireRun(id: string) {
    this.#runId = id;
  }
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
    const insert = this.db
      .prepare(
        "INSERT INTO assistant_route_refs(id,owner_key,expires_at_ms,map_version,network_version,payload_json) SELECT ?,?,?,?,?,?" +
          (this.conversationId
            ? " WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND owner_key=? AND deleted_at_ms IS NULL AND expires_at_ms>?)"
            : "") +
          (this.#runId
            ? " AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND owner_key=? AND status='running' AND lease_until_ms>?)"
            : ""),
      )
      .bind(
        route.routeId,
        owner,
        Date.parse(route.expiresAt),
        route.mapVersion,
        route.networkVersion,
        json,
        ...(this.conversationId
          ? [this.conversationId, owner, this.now()]
          : []),
        ...(this.#runId ? [this.#runId, owner, this.now()] : []),
      );
    const results = await this.db.batch([
      insert,
      ...(this.conversationId
        ? [
            this.db
              .prepare(
                "INSERT INTO assistant_conversation_routes(conversation_id,route_id,owner_key) SELECT ?,id,owner_key FROM assistant_route_refs WHERE id=? AND owner_key=?",
              )
              .bind(this.conversationId, route.routeId, owner),
          ]
        : []),
    ]);
    if (
      !z
        .object({ meta: z.object({ changes: z.number() }).passthrough() })
        .passthrough()
        .parse(results[0]).meta.changes
    )
      throw new ApiError("CANCELLED", "对话已停止或已删除。");
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
    await this.get(owner, value.route.routeId, {
      mapVersion: value.route.mapVersion,
      networkVersion: value.route.networkVersion,
    });
  }
  async get(
    owner: string,
    routeId: string,
    versions: { mapVersion: string; networkVersion: string },
  ) {
    const query = () =>
      this.db
        .prepare(
          "SELECT owner_key,expires_at_ms,map_version,network_version,payload_json FROM assistant_route_refs WHERE id=? AND owner_key=? AND expires_at_ms>?" +
            (this.conversationId
              ? " AND EXISTS(SELECT 1 FROM assistant_conversation_routes cr JOIN conversations c ON c.id=cr.conversation_id WHERE cr.route_id=assistant_route_refs.id AND cr.conversation_id=? AND cr.owner_key=? AND c.owner_key=? AND c.deleted_at_ms IS NULL AND c.expires_at_ms>?)"
              : ""),
        )
        .bind(
          routeId,
          owner,
          this.now(),
          ...(this.conversationId
            ? [this.conversationId, owner, owner, this.now()]
            : []),
        )
        .first<{
          owner_key: string;
          expires_at_ms: number;
          map_version: string;
          network_version: string;
          payload_json: string | null;
        }>();
    let row = await query();
    if (!row && this.conversationId) {
      // Compatibility for a legitimate old-client route completed during the
      // migration/deploy interval: derive association only from owned DB cards.
      await this.db
        .prepare(
          "INSERT OR IGNORE INTO assistant_conversation_routes(conversation_id,route_id,owner_key) SELECT c.id,r.id,c.owner_key FROM conversations c JOIN assistant_route_refs r ON r.owner_key=c.owner_key WHERE c.id=? AND c.owner_key=? AND c.deleted_at_ms IS NULL AND c.expires_at_ms>? AND r.id=? AND (c.active_route_id=r.id OR EXISTS(SELECT 1 FROM conversation_messages m,json_each(m.artifacts_json) a WHERE m.conversation_id=c.id AND json_extract(a.value,'$.kind')='route' AND json_extract(a.value,'$.routeId')=r.id))",
        )
        .bind(this.conversationId, owner, this.now(), routeId)
        .run();
      row = await query();
    }
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
