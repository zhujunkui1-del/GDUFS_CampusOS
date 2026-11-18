import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
const bindings = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => bindings,
}));
import {
  publicBuilding,
  publicBuildingImage,
  privateFeedbackImage,
} from "@/lib/server/building-media";
import { feedbackPost } from "@/lib/server/feedback";
import { consoleAdministration } from "@/lib/server/console/api";
import {
  consoleBindings,
  createConsoleSession,
} from "@/lib/server/console/auth";
import { previewApiHandler } from "@/lib/server/preview-api";
import seed from "@/features/campus-map/data/building-profiles.json";
const origin = "https://building.example.invalid";
const key = "fixture-console-key-longer-than-forty-characters-only";
const library = "osm-way-307250998";
let fixture: ReturnType<typeof sqliteD1>;
beforeEach(() => {
  fixture = sqliteD1();
  bindings.env = {
    DB: fixture.db,
    APP_ENV: "preview",
    CONSOLE_AUTH_MODE: "admin_key",
    CONSOLE_ORIGIN: origin,
    CONSOLE_ADMIN_EMAILS: "admin@example.invalid",
    CONSOLE_ADMIN_ACCESS_KEY: key,
    CONSOLE_SESSION_SECRET:
      "fixture-console-secret-at-least-thirty-two-characters",
  };
});
afterEach(() => fixture.close());
async function login() {
  const session = await createConsoleSession(
    new Request(origin + "/api/console-auth", {
      method: "POST",
      headers: { Origin: origin },
    }),
    { key },
    consoleBindings(),
  );
  return { cookie: session.cookie.split(";")[0], csrf: session.csrf };
}
function admin(
  path: string,
  session: { cookie: string; csrf?: string },
  body?: unknown,
) {
  return consoleAdministration(
    new Request(origin + "/api/admin/v2/buildings" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: session.cookie,
        ...(session.csrf ? { "X-Console-CSRF": session.csrf } : {}),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    }),
  );
}
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function form(field: string) {
  const data = new FormData();
  data.set(field, new File([bytes], "校园照片.png", { type: "image/png" }));
  return data;
}

it("loads the actual imported seed, then persists admin edits and order for public reads", async () => {
  const request = () =>
    new Request(origin + "/api/public/building?id=" + library);
  const initial = await (await publicBuilding(request())).json();
  expect(initial.data.photos).toEqual(seed[library].photos);
  expect(initial.data.photos.length).toBeGreaterThan(3);
  const session = await login();
  const edited = {
    description: "图书馆\n介绍",
    photos: [...seed[library].photos].reverse(),
  };
  expect(
    (await admin("/" + library, { cookie: session.cookie }, edited)).status,
  ).toBe(403);
  expect((await admin("/" + library, session, edited)).status).toBe(200);
  expect((await (await publicBuilding(request())).json()).data).toMatchObject(
    edited,
  );
  expect(
    (
      await publicBuilding(
        new Request(origin + "/api/public/building?id=unknown"),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await admin("/" + library, session, {
        description: "x",
        photos: ["javascript:alert(1)"],
      })
    ).status,
  ).toBe(400);
  expect((await admin("", { cookie: "" })).status).toBe(401);
  for (const path of [
    "/api/public/building",
    "/api/public/building-image",
    "/api/admin/feedback-image",
  ])
    expect(previewApiHandler(path)?.method).toBe("GET");
});

it("stores building uploads and serves the exact bytes with their verified MIME", async () => {
  const session = await login();
  const result = await (await admin("/upload", session, form("image"))).json();
  expect(result.ok).toBe(true);
  const response = await publicBuildingImage(
    new Request(origin + result.data.url),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("Cache-Control")).toContain("immutable");
});

it("lists Baiyun separately and persists its public building profile without changing the University Town profile", async () => {
  const session = await login();
  const result = await (await admin("", session)).json();
  const baiyun = result.data.items.find(
    (p: { id: string }) => p.id === "osm-relation-13030162",
  );
  expect(baiyun).toMatchObject({
    name: "第二教学楼",
    campus: "baiyun",
    description: "",
    photos: [],
  });
  expect(
    result.data.items.find((p: { id: string }) => p.id === library).campus,
  ).toBe("university");
  expect(
    (
      await admin("/" + baiyun.id, session, {
        description: "白云山第二教学楼简介",
        photos: [],
      })
    ).status,
  ).toBe(200);
  const profile = await (
    await publicBuilding(
      new Request(origin + "/api/public/building?id=" + baiyun.id),
    )
  ).json();
  expect(profile.data).toMatchObject({
    description: "白云山第二教学楼简介",
    campus: "baiyun",
  });
  const university = await (
    await publicBuilding(
      new Request(origin + "/api/public/building?id=" + library),
    )
  ).json();
  expect(university.data.description).toBe(seed[library].description);
});

it("accepts guest attachments atomically, permits authenticated download, and never exposes them as building images", async () => {
  const input = form("images");
  input.set("content", "私密留言");
  const response = await feedbackPost(
    new Request(origin + "/api/public/feedback", {
      method: "POST",
      headers: { Origin: origin },
      body: input,
    }),
  );
  expect((await response.json()).data).toEqual({ submitted: true });
  const session = await login();
  const inbox = await (
    await consoleAdministration(
      new Request(origin + "/api/admin/v2/feedback", {
        headers: { Cookie: session.cookie },
      }),
    )
  ).json();
  const image = inbox.data.pending[0].images[0];
  for (const cookie of ["", "campusos_account=ordinary-user"]) {
    const response = await privateFeedbackImage(
      new Request(origin + image.url, { headers: { Cookie: cookie } }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(
    (
      await publicBuildingImage(
        new Request(origin + "/api/public/building-image?id=" + image.id),
      )
    ).status,
  ).toBe(404);
  const download = await privateFeedbackImage(
    new Request(origin + image.url + "&download=1", {
      headers: { Cookie: session.cookie },
    }),
  );
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  expect(download.headers.get("Cache-Control")).toBe("no-store");
  expect(download.headers.get("Content-Disposition")).toContain("attachment;");
  const invalid = form("images");
  invalid.set("content", "must roll back");
  invalid.append(
    "images",
    new File(["<svg/>"], "unsafe.png", { type: "image/png" }),
  );
  expect(
    (
      await feedbackPost(
        new Request(origin + "/api/public/feedback", {
          method: "POST",
          headers: { Origin: origin },
          body: invalid,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM project_feedback").get(),
  ).toEqual({ n: 1 });
  expect(
    fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM project_images").get(),
  ).toEqual({ n: 1 });
});

it("lists one entry per sports group and bridge, preserves existing member edits, and saves the shared profile atomically", async () => {
  const session = await login();
  let result = await (await admin("", session)).json();
  for (const name of [
    "篮球场",
    "羽毛球场",
    "排球场",
    "网球场",
    "游泳馆",
    "语心桥",
  ])
    expect(
      result.data.items.filter(
        (item: { name: string; campus: string }) =>
          item.campus === "university" && item.name === name,
      ),
    ).toHaveLength(1);
  expect(
    result.data.items.some((item: { name: string }) =>
      item.name.includes("语心桥（"),
    ),
  ).toBe(false);
  for (const [id, text, url] of [
    ["osm-way-1389859424", "已有介绍一", seed[library].photos[0]],
    ["osm-way-1389859442", "已有介绍二", seed[library].photos[1]],
  ])
    fixture.sqlite
      .prepare(
        "INSERT INTO building_profiles(place_id,description,photos_json,updated_at) VALUES(?,?,?,?)",
      )
      .run(id, text, JSON.stringify([url]), new Date().toISOString());
  result = await (await admin("", session)).json();
  const basket = result.data.items.find(
    (item: { name: string }) => item.name === "篮球场",
  );
  expect(basket.description).toContain("已有介绍一");
  expect(basket.description).toContain("已有介绍二");
  expect(basket.photos).toHaveLength(2);
  expect(
    (
      await admin("/" + basket.id, session, {
        description: "统一介绍",
        photos: [],
      })
    ).status,
  ).toBe(200);
  for (const id of ["osm-way-1389859424", "osm-way-1389859442"]) {
    const r = await (
      await publicBuilding(
        new Request(origin + "/api/public/building?id=" + id),
      )
    ).json();
    expect(r.data.description).toBe("统一介绍");
    expect(r.data.photos).toEqual([]);
  }
});
