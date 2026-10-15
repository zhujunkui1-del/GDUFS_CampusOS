import { z } from "zod";
import type { SkillContext } from "@/domain/skills/contracts";
import { CampusMapService } from "./campus-map-service";
import { createMapSkillRegistry } from "./skills";
import { ApiError } from "../errors";

export const mapSkillService = new CampusMapService();
export const mapSkillRegistry = createMapSkillRegistry(mapSkillService);
const cookieName = "campusos_map_session";

// Opaque, server-generated anonymous handles; clients cannot submit sessionId/userId.
// Isolate-local continuity only. A different isolate/expiry fails closed instead of exposing another route.
export class MapSessionVault {
  #sessions = new Map<
    string,
    { id: string; expiresAt: number; requests: number }
  >();
  constructor(private readonly now = () => Date.now()) {}
  resolve(request: Request): { context: SkillContext; cookie: string } {
    for (const [token, value] of this.#sessions)
      if (value.expiresAt <= this.now()) this.#sessions.delete(token);
    const incoming = request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    let token =
      incoming && z.string().uuid().safeParse(incoming).success
        ? incoming
        : undefined;
    let session = token ? this.#sessions.get(token) : undefined;
    if (!session) {
      if (this.#sessions.size >= 1000)
        throw new ApiError(
          "RATE_LIMITED",
          "地图请求过于频繁，请稍后重试。",
          true,
        );
      token = crypto.randomUUID();
      session = {
        id: crypto.randomUUID(),
        expiresAt: this.now() + 600000,
        requests: 0,
      };
      this.#sessions.set(token, session);
    }
    if (++session.requests > 40)
      throw new ApiError(
        "RATE_LIMITED",
        "地图请求过于频繁，请稍后重试。",
        true,
      );
    return {
      context: {
        requestId: crypto.randomUUID(),
        sessionId: session.id,
        user: null,
        campusId: "gdufs_university_town",
        permissions: [],
        signal: request.signal,
      },
      cookie: `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${Math.max(1, Math.floor((session.expiresAt - this.now()) / 1000))}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    };
  }
}
export const mapSessionVault = new MapSessionVault();
