import { z } from "zod";
import type { SqlDatabase } from "./database";
import { randomToken, tokenHash } from "./crypto";
import { ApiError } from "../errors";
import {
  AssistantCardSchema,
  type AssistantCard,
  type StoredMessage,
} from "@/domain/agent/assistant-contracts";
import { MapActionSchema, type MapAction } from "@/domain/maps/contracts";
import type { AgentChatRequest } from "@/domain/agent/contracts";

export type AssistantIdentity = {
  owner: string;
  user: { id: string; role: "user" | "admin" } | null;
  cookie: string;
};
export type Conversation = {
  id: string;
  owner_key: string;
  selected_place_id: string | null;
  active_route_id: string | null;
  expires_at_ms: number;
};
const cookie = (request: Request, name: string) =>
  request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
export class AssistantStore {
  constructor(
    readonly db: SqlDatabase,
    readonly now = () => Date.now(),
  ) {}
  async identity(request: Request): Promise<AssistantIdentity> {
    const loginToken = cookie(request, "campusos_session");
    const login =
      loginToken && /^[A-Za-z0-9_-]{20,200}$/.test(loginToken)
        ? await this.db
            .prepare(
              "SELECT u.id,u.role FROM login_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.status='active'",
            )
            .bind(
              await tokenHash(loginToken),
              new Date(this.now()).toISOString(),
            )
            .first<{ id: string; role: "user" | "admin" }>()
        : null;
    let token = cookie(request, "campusos_assistant");
    const hash =
      token && /^[A-Za-z0-9_-]{40,100}$/.test(token)
        ? await tokenHash(token)
        : "";
    const row = hash
      ? await this.db
          .prepare(
            "SELECT owner_key,user_id FROM assistant_sessions WHERE token_hash=? AND expires_at_ms>?",
          )
          .bind(hash, this.now())
          .first<{ owner_key: string; user_id: string | null }>()
      : null;
    if (
      row &&
      row.user_id === (login ? login.id : null) &&
      row.owner_key === (login ? "u:" + login.id : "g:" + hash)
    )
      return {
        owner: row.owner_key,
        user: login || null,
        cookie: this.sessionCookie(token!, request),
      };
    await this.cleanup();
    const capacity = await this.db
      .prepare("SELECT count(*) AS n FROM assistant_sessions")
      .first<{ n: number }>();
    if ((capacity?.n || 0) >= 10000)
      throw new ApiError("RATE_LIMITED", "当前请求较多，请稍后重试。", true);
    token = randomToken();
    const nextHash = await tokenHash(token);
    const owner = login ? "u:" + login.id : "g:" + nextHash;
    await this.db
      .prepare(
        "INSERT INTO assistant_sessions(token_hash,owner_key,user_id,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?)",
      )
      .bind(
        nextHash,
        owner,
        login ? login.id : null,
        this.now() + 172800000,
        this.now(),
      )
      .run();
    return {
      owner,
      user: login || null,
      cookie: this.sessionCookie(token, request),
    };
  }
  private sessionCookie(token: string, request: Request) {
    return `campusos_assistant=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=172800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  }
  async cleanup() {
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE agent_runs SET status='failed',error_code='INTERRUPTED',finished_at_ms=? WHERE owner_key IS NOT NULL AND status='running' AND lease_until_ms<=?",
        )
        .bind(now, now),
      this.db
        .prepare(
          "DELETE FROM agent_runs WHERE owner_key IS NOT NULL AND started_at_ms<?",
        )
        .bind(now - 172800000),
      this.db
        .prepare("DELETE FROM assistant_sessions WHERE expires_at_ms<=?")
        .bind(now),
      this.db
        .prepare("DELETE FROM assistant_route_refs WHERE expires_at_ms<=?")
        .bind(now),
      this.db
        .prepare(
          "DELETE FROM assistant_location_challenges WHERE expires_at_ms<=?",
        )
        .bind(now),
      this.db
        .prepare("DELETE FROM assistant_actions WHERE expires_at_ms<=?")
        .bind(now),
      this.db
        .prepare(
          "DELETE FROM conversations WHERE owner_key IS NOT NULL AND expires_at_ms<=?",
        )
        .bind(now),
    ]);
  }
  async conversation(
    identity: AssistantIdentity,
    id?: string,
  ): Promise<Conversation> {
    if (id) {
      const row = await this.db
        .prepare(
          "SELECT id,owner_key,selected_place_id,active_route_id,expires_at_ms FROM conversations WHERE id=? AND owner_key=? AND expires_at_ms>?",
        )
        .bind(id, identity.owner, this.now())
        .first<Conversation>();
      if (!row)
        throw new ApiError("NOT_FOUND", "对话不存在或已过期，请新建对话。");
      return row;
    }
    const counts = await this.db
      .prepare(
        "SELECT count(*) AS total,sum(CASE WHEN owner_key=? THEN 1 ELSE 0 END) AS mine FROM conversations WHERE expires_at_ms>?",
      )
      .bind(identity.owner, this.now())
      .first<{ total: number; mine: number }>();
    if ((counts?.total || 0) >= 5000 || (counts?.mine || 0) >= 5)
      throw new ApiError("RATE_LIMITED", "对话数量已达上限，请稍后重试。");
    const next = crypto.randomUUID();
    await this.db
      .prepare(
        "INSERT INTO conversations(id,user_id,guest_session_hash,owner_key,expires_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        next,
        identity.user?.id || null,
        identity.user ? null : identity.owner.slice(2),
        identity.owner,
        this.now() + 172800000,
        this.now(),
      )
      .run();
    return {
      id: next,
      owner_key: identity.owner,
      selected_place_id: null,
      active_route_id: null,
      expires_at_ms: this.now() + 172800000,
    };
  }
  async latest(identity: AssistantIdentity) {
    return this.db
      .prepare(
        "SELECT id FROM conversations WHERE owner_key=? AND expires_at_ms>? ORDER BY updated_at_ms DESC LIMIT 1",
      )
      .bind(identity.owner, this.now())
      .first<{ id: string }>();
  }
  async history(identity: AssistantIdentity, id: string) {
    const conversation = await this.conversation(identity, id);
    const rows = await this.db
      .prepare(
        "SELECT id,role,content,artifacts_json FROM conversation_messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY rowid DESC LIMIT 20",
      )
      .bind(id)
      .all<{
        id: string;
        role: "user" | "assistant";
        content: string;
        artifacts_json: string;
      }>();
    const messages: StoredMessage[] = rows.results.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      text: row.content,
      cards: z
        .array(AssistantCardSchema)
        .max(30)
        .parse(JSON.parse(row.artifacts_json)),
    }));
    return {
      conversationId: id,
      messages,
      selectedPlaceId: conversation.selected_place_id,
      activeRouteId: conversation.active_route_id,
    };
  }
  async reserve(
    identity: AssistantIdentity,
    conversation: Conversation,
    requestId: string,
    ip: string,
  ) {
    const runId = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          "INSERT INTO agent_runs(id,conversation_id,status,owner_key,request_id,ip_key,is_user,started_at_ms,lease_until_ms,charged_tokens) VALUES(?,?,'running',?,?,?,?,?,?,250000)",
        )
        .bind(
          runId,
          conversation.id,
          identity.owner,
          requestId,
          await tokenHash(ip),
          identity.user ? 1 : 0,
          this.now(),
          this.now() + 120000,
        )
        .run();
    } catch (error) {
      const text = String(error);
      if (/AGENT_|UNIQUE constraint/.test(text))
        throw new ApiError(
          "RATE_LIMITED",
          "对话正在进行或额度已用完，请稍后重试。",
          true,
        );
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        "对话服务暂不可用，请稍后重试。",
        true,
      );
    }
    return runId;
  }
  async running(owner: string, runId: string) {
    const row = await this.db
      .prepare(
        "SELECT id FROM agent_runs WHERE id=? AND owner_key=? AND status='running' AND lease_until_ms>?",
      )
      .bind(runId, owner, this.now())
      .first();
    if (!row) throw new ApiError("CANCELLED", "已停止回复。");
  }
  async cancel(identity: AssistantIdentity, requestId: string) {
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE agent_runs SET status='failed',error_code='CANCELLED',finished_at_ms=?,lease_until_ms=0 WHERE owner_key=? AND request_id=? AND status='running'",
        )
        .bind(this.now(), identity.owner, requestId),
      this.db
        .prepare(
          "UPDATE assistant_actions SET status='revoked' WHERE owner_key=? AND status IN ('pending','claimed') AND run_id IN (SELECT id FROM agent_runs WHERE owner_key=? AND request_id=?)",
        )
        .bind(identity.owner, identity.owner, requestId),
    ]);
  }
  async finish(
    identity: AssistantIdentity,
    runId: string,
    status: "completed" | "failed",
    usage: Record<string, unknown>,
    chargedTokens: number,
    errorCode?: string,
  ) {
    const result = await this.db
      .prepare(
        "UPDATE agent_runs SET status=?,finished_at_ms=?,lease_until_ms=0,error_code=?,usage_json=?,charged_tokens=? WHERE id=? AND owner_key=? AND status='running' AND lease_until_ms>?",
      )
      .bind(
        status,
        this.now(),
        errorCode || null,
        JSON.stringify(usage),
        chargedTokens,
        runId,
        identity.owner,
        this.now(),
      )
      .run();
    if (!result.meta.changes) throw new ApiError("CANCELLED", "已停止回复。");
    if (status === "failed")
      await this.db
        .prepare(
          "UPDATE assistant_actions SET status='revoked' WHERE owner_key=? AND run_id=? AND status IN ('pending','claimed')",
        )
        .bind(identity.owner, runId)
        .run();
  }
  async append(
    conversation: Conversation,
    role: "user" | "assistant",
    text: string,
    cards: AssistantCard[] = [],
  ) {
    const safeText = text
      .slice(0, 4000)
      .replace(/(?:1[01]\d|120)\.\d{4,}\s*[,，]\s*2\d\.\d{4,}/g, "[位置]");
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO conversation_messages(id,conversation_id,role,content,artifacts_json) VALUES(?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          conversation.id,
          role,
          safeText,
          JSON.stringify(cards),
        ),
      this.db
        .prepare(
          "DELETE FROM conversation_messages WHERE conversation_id=? AND id NOT IN (SELECT id FROM conversation_messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT 20)",
        )
        .bind(conversation.id, conversation.id),
      this.db
        .prepare(
          "UPDATE conversations SET updated_at_ms=?,expires_at_ms=? WHERE id=? AND owner_key=?",
        )
        .bind(
          this.now(),
          this.now() + 172800000,
          conversation.id,
          conversation.owner_key,
        ),
    ]);
  }
  async context(
    conversation: Conversation,
    selected: string | null,
    route: string | null,
  ) {
    await this.db
      .prepare(
        "UPDATE conversations SET selected_place_id=?,active_route_id=? WHERE id=? AND owner_key=?",
      )
      .bind(selected, route, conversation.id, conversation.owner_key)
      .run();
  }
  async action(
    identity: AssistantIdentity,
    conversation: Conversation,
    runId: string,
    actions: MapAction[],
  ) {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        "INSERT INTO assistant_actions(id,owner_key,run_id,conversation_id,actions_json,expires_at_ms) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        id,
        identity.owner,
        runId,
        conversation.id,
        JSON.stringify(actions),
        this.now() + 300000,
      )
      .run();
    return { id, actions };
  }
  async claim(identity: AssistantIdentity, actionId: string) {
    const row = await this.db
      .prepare(
        "UPDATE assistant_actions SET status='claimed' WHERE id=? AND owner_key=? AND status='pending' AND expires_at_ms>? AND run_id IN (SELECT id FROM agent_runs WHERE owner_key=? AND (status='completed' OR (status='running' AND lease_until_ms>?))) RETURNING actions_json,conversation_id",
      )
      .bind(actionId, identity.owner, this.now(), identity.owner, this.now())
      .first<{ actions_json: string; conversation_id: string }>();
    if (!row) throw new ApiError("NOT_FOUND", "地图操作已失效，请重新查询。");
    return {
      actions: z
        .array(MapActionSchema)
        .max(8)
        .parse(JSON.parse(row.actions_json)),
      conversationId: row.conversation_id,
    };
  }
  async receipt(
    identity: AssistantIdentity,
    actionId: string,
    ok: boolean,
    message: string,
    mode?: "2d" | "2.5d" | "3d",
  ) {
    const result = await this.db
      .prepare(
        "UPDATE assistant_actions SET status=?,receipt_json=? WHERE id=? AND owner_key=? AND status='claimed' AND expires_at_ms>?",
      )
      .bind(
        ok ? "applied" : "failed",
        JSON.stringify({ ok, message, ...(mode ? { mode } : {}) }),
        actionId,
        identity.owner,
        this.now(),
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError("NOT_FOUND", "地图操作已失效。");
  }
  async execution(owner: string, id: string, runningRunId?: string) {
    const row = await this.db
      .prepare(
        runningRunId
          ? "SELECT a.status,a.receipt_json FROM assistant_actions a JOIN agent_runs r ON r.id=a.run_id WHERE a.id=? AND a.owner_key=? AND a.expires_at_ms>? AND r.id=? AND r.owner_key=? AND r.status='running' AND r.lease_until_ms>?"
          : "SELECT status,receipt_json FROM assistant_actions WHERE id=? AND owner_key=? AND expires_at_ms>?",
      )
      .bind(
        id,
        owner,
        this.now(),
        ...(runningRunId ? [runningRunId, owner, this.now()] : []),
      )
      .first<{ status: string; receipt_json: string | null }>();
    if (!row || row.status === "revoked")
      throw new ApiError("CANCELLED", "地图操作已取消。");
    if (row.status === "applied" || row.status === "failed")
      return z
        .object({
          ok: z.boolean(),
          message: z.string().max(100),
          mode: z.enum(["2d", "2.5d", "3d"]).optional(),
        })
        .strict()
        .parse(JSON.parse(row.receipt_json || "{}"));
    return null;
  }
  async locationChallenge(identity: AssistantIdentity) {
    const challenge = randomToken();
    await this.db
      .prepare(
        "DELETE FROM assistant_location_challenges WHERE owner_key=? OR expires_at_ms<=?",
      )
      .bind(identity.owner, this.now())
      .run();
    await this.db
      .prepare(
        "INSERT INTO assistant_location_challenges(nonce_hash,owner_key,expires_at_ms) VALUES(?,?,?)",
      )
      .bind(await tokenHash(challenge), identity.owner, this.now() + 30000)
      .run();
    return challenge;
  }
  async consumeLocation(
    identity: AssistantIdentity,
    grant: NonNullable<AgentChatRequest["locationGrant"]>,
  ) {
    const now = this.now();
    const result = await this.db
      .prepare(
        "DELETE FROM assistant_location_challenges WHERE nonce_hash=? AND owner_key=? AND expires_at_ms>? RETURNING nonce_hash",
      )
      .bind(await tokenHash(grant.challenge), identity.owner, now)
      .first();
    if (
      !result ||
      grant.capturedAt > now + 1000 ||
      now - grant.capturedAt > 30000
    )
      throw new ApiError("LOCATION_REQUIRED", "定位已过期，请重新定位。");
    const capturedAt = Math.min(now, grant.capturedAt);
    return {
      coordinate: grant.coordinate,
      accuracyMeters: grant.accuracyMeters,
      capturedAt,
      expiresAt: capturedAt + 30000,
      consent: "browser_geolocation" as const,
    };
  }
}
