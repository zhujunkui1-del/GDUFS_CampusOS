import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("five real map Skills execute in Workers with owned route actions and no guessed GPS", async ({
  request,
}, info) => {
  const calls: {
    name: string;
    input: unknown;
    status: number;
    output: unknown;
  }[] = [];
  const run = async (name: string, input: unknown) => {
    const response = await request.post(`/api/map/skills/${name}`, {
      data: { input },
    });
    const output = await response.json();
    calls.push({ name, input, status: response.status(), output });
    return { status: response.status(), output };
  };
  const south = await run("search_places", { query: "南苑7栋" });
  expect(south.status).toBe(200);
  const dormId = south.output.data.data.matches[0].placeId;
  expect(dormId).toBe("osm-way-312536955");
  const lib = await run("search_places", { query: "图书馆" });
  expect(lib.status).toBe(200);
  const libraryId = lib.output.data.data.matches[0].placeId;
  expect(libraryId).toBe("osm-way-307250998");
  const details = await run("get_place_details", { placeId: dormId });
  expect(details.status).toBe(200);
  expect(details.output.data.data.building.levels).toBe(7);
  const nearby = await run("find_nearby_places", {
    origin: { type: "place", placeId: dormId },
    category: "canteen",
    radiusMeters: 1000,
  });
  expect(nearby.status).toBe(200);
  expect(nearby.output.data.data.matches.length).toBeGreaterThan(0);
  const planned = await run("plan_route", {
    start: { type: "place", placeId: dormId },
    endPlaceId: libraryId,
    mode: "walking",
  });
  expect(planned.status).toBe(200);
  const route = planned.output.data.data;
  expect(route.usesTunnel).toBe(true);
  expect(route.path.coordinates.length).toBeGreaterThan(2);
  expect(route.distanceMeters).toBeGreaterThan(500);
  const actions = await run("control_map", {
    actions: [
      { type: "FOCUS_PLACE", placeId: dormId },
      { type: "SHOW_PLACE_DETAILS", placeId: dormId },
      { type: "SHOW_ROUTE", routeId: route.routeId },
      { type: "SET_VIEW_MODE", mode: "3d" },
      { type: "CLEAR_ROUTE" },
    ],
  });
  expect(actions.status).toBe(200);
  expect(actions.output.data.data.execution).toBe("intent_only");
  expect((await run("search_places", { query: "南苑999栋" })).status).toBe(404);
  expect((await run("get_place_details", { placeId: "fake" })).status).toBe(
    404,
  );
  expect(
    (await run("find_nearby_places", { origin: { type: "device_location" } }))
      .status,
  ).toBe(422);
  expect(
    (
      await run("control_map", {
        actions: [{ type: "SHOW_ROUTE", routeId: crypto.randomUUID() }],
      })
    ).status,
  ).toBe(404);
  expect((await run("run_javascript", { code: "x" })).status).toBe(404);
  const dir = process.env.E2E_SKILLS_CAPTURE_DIR || "test-results/s2-b";
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}-http.json`,
    JSON.stringify(
      {
        actualWorkerExecution: true,
        actualPhone: false,
        routeDistanceMeters: route.distanceMeters,
        networkVersion: route.networkVersion,
        calls,
      },
      null,
      2,
    ) + "\n",
  );
});
