import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import {
  buildingProfileId,
  buildingProfileMembers,
  managedBuildings,
  buildingPlaces,
} from "@/features/campus-map/data/building-groups";
import seed from "@/features/campus-map/data/building-profiles.json";
import { primaryDatabase, type SqlDatabase } from "./assistant/database";
import { readJson } from "./assistant/http-context";
import { withApi } from "./http";
import { ApiError } from "./errors";
import { requireConsole, consolePermission } from "./console/auth";
import type { ConsoleActor } from "@/domain/console/contracts";
export const mediaDatabase = () =>
  primaryDatabase(
    (getCloudflareContext().env as unknown as { DB: SqlDatabase }).DB,
  );
export async function imageStatement(
  db: SqlDatabase,
  file: File,
  kind: "building" | "feedback",
  feedbackId: string | null = null,
) {
  const data = await file.arrayBuffer(),
    b = new Uint8Array(data);
  const mime =
    b[0] === 255 && b[1] === 216 && b[2] === 255
      ? "image/jpeg"
      : b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71
        ? "image/png"
        : String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...b.slice(8, 12)) === "WEBP"
          ? "image/webp"
          : null;
  if (!mime || data.byteLength > 1_900_000)
    throw new ApiError(
      "INVALID_ARGUMENT",
      "请选择不超过1.9MB的JPEG、PNG或WebP图片。",
    );
  const id = crypto.randomUUID();
  return {
    id,
    statement: db
      .prepare(
        "INSERT INTO project_images(id,kind,feedback_id,name,mime,data,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(id, kind, feedbackId, file.name, mime, b, new Date().toISOString()),
  };
}
function place(id: string) {
  const p = buildingPlaces.find((p) => p.id === id);
  if (!p) throw new ApiError("NOT_FOUND", "建筑不存在。");
  return p;
}
type ProfileRow = {
  place_id: string;
  description: string;
  photos_json: string;
};
function groupedProfile(id: string, rows: Map<string, ProfileRow>) {
  const key = buildingProfileId(id),
    p = place(key),
    members = buildingProfileMembers(key);
  const defaults = seed as Record<
    string,
    { description: string; photos: string[] }
  >;
  const descriptions = [
    ...new Set(
      members
        .map((member) => rows.get(member.id)?.description)
        .filter((value): value is string => value !== undefined),
    ),
  ];
  return {
    id: key,
    name: p.name,
    campus: p.campus,
    description: descriptions.length
      ? descriptions.join("\n\n")
      : defaults[key]?.description || "",
    photos: [
      ...new Set(
        members.flatMap((member) => {
          const saved = rows.get(member.id);
          return saved
            ? (JSON.parse(saved.photos_json) as string[])
            : defaults[member.id]?.photos || [];
        }),
      ),
    ],
  };
}
export async function readBuilding(db: SqlDatabase, id: string) {
  place(id);
  const members = buildingProfileMembers(id);
  const saved = await db
    .prepare(
      `SELECT place_id,description,photos_json FROM building_profiles WHERE place_id IN (${members.map(() => "?").join(",")})`,
    )
    .bind(...members.map((member) => member.id))
    .all<ProfileRow>();
  return groupedProfile(
    id,
    new Map(saved.results.map((row) => [row.place_id, row])),
  );
}
export async function readBuildingCatalog(db: SqlDatabase) {
  const saved = await db
    .prepare("SELECT place_id,description,photos_json FROM building_profiles")
    .all<ProfileRow>();
  const rows = new Map(saved.results.map((row) => [row.place_id, row]));
  return managedBuildings.map((place) => groupedProfile(place.id, rows));
}
export const publicBuilding = withApi(async (request) =>
  readBuilding(
    mediaDatabase(),
    new URL(request.url).searchParams.get("id") || "",
  ),
);
export async function buildingAdministration(
  db: SqlDatabase,
  request: Request,
  path: string[],
  actor: ConsoleActor,
) {
  const audit = (action: string, id: string) =>
    db
      .prepare(
        "INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id) VALUES(?,?,?,?, 'building',?)",
      )
      .bind(crypto.randomUUID(), actor.id, actor.email, action, id);
  if (request.method === "GET" && path.length === 0) {
    const saved = await db
      .prepare("SELECT place_id,description,photos_json FROM building_profiles")
      .all<{ place_id: string; description: string; photos_json: string }>();
    const rows = new Map(saved.results.map((r) => [r.place_id, r]));
    return { items: managedBuildings.map((p) => groupedProfile(p.id, rows)) };
  }

  if (request.method === "POST" && path[0] === "upload" && path.length === 1) {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File))
      throw new ApiError("INVALID_ARGUMENT", "请选择图片。");
    const image = await imageStatement(db, file, "building");
    await db.batch([image.statement, audit("building.image_upload", image.id)]);
    return { url: "/api/public/building-image?id=" + image.id };
  }
  if (request.method === "POST" && path.length === 1) {
    place(path[0]);
    const value = z
      .object({
        description: z.string(),
        photos: z.array(
          z
            .string()
            .refine(
              (s) =>
                /^\/buildings\/[a-f0-9]+\.(webp|jpg|png)$/.test(s) ||
                /^\/api\/public\/building-image\?id=[a-f0-9-]{36}$/.test(s),
            ),
        ),
      })
      .parse(await readJson(request));
    const saves = buildingProfileMembers(path[0]).map((member) =>
      db
        .prepare(
          "INSERT INTO building_profiles(place_id,description,photos_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(place_id) DO UPDATE SET description=excluded.description,photos_json=excluded.photos_json,updated_at=excluded.updated_at",
        )
        .bind(
          member.id,
          value.description,
          JSON.stringify(value.photos),
          new Date().toISOString(),
        ),
    );
    await db.batch([
      ...saves,
      audit("building.update", buildingProfileId(path[0])),
    ]);
    return { saved: true };
  }
  throw new ApiError("NOT_FOUND", "未找到建筑接口。");
}
export function imageEndpoint(privateImage: boolean) {
  return async (request: Request) => {
    let imageResponse: Response | undefined;
    const checked = await withApi(async () => {
      const context = privateImage
        ? await requireConsole(request, false)
        : null;
      if (context) consolePermission(context.actor, "admin");
      const db = context?.config.db || mediaDatabase();
      const row = await db
        .prepare(
          "SELECT name,mime,data FROM project_images WHERE id=? AND kind=?",
        )
        .bind(
          new URL(request.url).searchParams.get("id") || "",
          privateImage ? "feedback" : "building",
        )
        .first<{ name: string; mime: string; data: ArrayBuffer | number[] }>();
      if (!row) throw new ApiError("NOT_FOUND", "图片不存在。");
      imageResponse = new Response(new Uint8Array(row.data as ArrayBuffer), {
        headers: {
          "Content-Type": row.mime,
          "Cache-Control": privateImage
            ? "no-store"
            : "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          ...(new URL(request.url).searchParams.has("download")
            ? {
                "Content-Disposition":
                  "attachment; filename*=UTF-8''" +
                  encodeURIComponent(row.name),
              }
            : {}),
        },
      });
      return {};
    })(request);
    return imageResponse ?? checked;
  };
}
export const publicBuildingImage = imageEndpoint(false);
export const privateFeedbackImage = imageEndpoint(true);
