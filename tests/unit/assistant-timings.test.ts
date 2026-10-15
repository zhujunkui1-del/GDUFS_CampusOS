import { it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { databaseTimings } from "@/lib/server/assistant/timings";
import { createMapSkillRegistry } from "@/lib/server/maps/skills";
import { AgentChatRequestSchema } from "@/domain/agent/contracts";

it("times real database calls without changing transactions or exposing SQL/bindings", async () => {
  const fixture = sqliteD1();
  try {
    const timing = databaseTimings(fixture.db);
    await timing.db
      .prepare("CREATE TABLE timing_test(id TEXT PRIMARY KEY, value INTEGER)")
      .run();
    await timing.db.batch([
      timing.db
        .prepare("INSERT INTO timing_test VALUES(?,?)")
        .bind("private-fixture", 1),
      timing.db.prepare("UPDATE timing_test SET value=2").bind(),
    ]);
    expect(
      await timing.db
        .prepare("SELECT value FROM timing_test WHERE id=?")
        .bind("private-fixture")
        .first(),
    ).toEqual({ value: 2 });
    await expect(
      timing.db
        .prepare("INSERT INTO timing_test VALUES(?,?)")
        .bind("private-fixture", 3)
        .run(),
    ).rejects.toThrow();
    expect(timing.snapshot()).toMatchObject({
      calls: 4,
      readQueries: 1,
      writeQueries: 4,
      failures: 1,
    });
    expect(JSON.stringify(timing.snapshot())).not.toMatch(
      /private-fixture|SELECT|INSERT/,
    );
  } finally {
    fixture.close();
  }
});
it("only permits fixed snapshot search/details result reuse, and accepts an explicit cleared map context", () => {
  const registry = createMapSkillRegistry();
  for (const name of ["search_places", "get_place_details"])
    expect(registry.get(name)?.reuseResultMs).toBe(5000);
  for (const name of ["plan_route", "find_nearby_places", "control_map"])
    expect(registry.get(name)?.reuseResultMs).toBe(0);
  expect(
    AgentChatRequestSchema.parse({
      message: "查附近",
      mapContext: { activeRouteId: null },
    }).mapContext?.activeRouteId,
  ).toBeNull();
});
