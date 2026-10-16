import { describe, expect, it } from "vitest";
import { locationCaptureTime } from "@/domain/agent/location-grant";
import { AssistantStore } from "@/lib/server/assistant/store";
import { sqliteD1 } from "../fixtures/sqlite-d1";

describe("server-clock location timestamps", () => {
  it.each([-3600000, 2600, 3600000])(
    "uses sample age rather than client wall clock offset %d",
    async (offset) => {
      const fixture = sqliteD1();
      const issued = Date.parse("2026-10-16T00:00:00Z");
      let now = issued;
      try {
        const store = new AssistantStore(fixture.db, () => now);
        const owner = await store.identity(
          new Request("https://campus.invalid/api/agent/session"),
        );
        const challenge = await store.locationChallenge(owner);
        now += 1000;
        const sampleAge = now + offset - (now + offset - 100);
        const capturedAt = locationCaptureTime(issued, 1000, sampleAge);
        expect(capturedAt).toBe(now - 100);
        const grant = {
          challenge,
          coordinate: [113.390146, 23.0615765] as [number, number],
          accuracyMeters: 8,
          capturedAt,
        };
        expect((await store.consumeLocation(owner, grant)).capturedAt).toBe(
          capturedAt,
        );
        await expect(store.consumeLocation(owner, grant)).rejects.toMatchObject(
          { code: "LOCATION_REQUIRED" },
        );
      } finally {
        fixture.close();
      }
    },
  );
  it("rejects stale samples, time reversal and an expired challenge", async () => {
    for (const [elapsed, age] of [
      [30001, 0],
      [0, 30001],
      [-1, 0],
      [0, -1001],
      [NaN, 0],
    ])
      expect(() => locationCaptureTime(100000, elapsed, age)).toThrow(/过期/);
    const fixture = sqliteD1();
    let now = 100000;
    try {
      const store = new AssistantStore(fixture.db, () => now);
      const owner = await store.identity(
        new Request("https://campus.invalid/api/agent/session"),
      );
      const challenge = await store.locationChallenge(owner);
      now += 30001;
      await expect(
        store.consumeLocation(owner, {
          challenge,
          coordinate: [113.390146, 23.0615765],
          accuracyMeters: 8,
          capturedAt: now,
        }),
      ).rejects.toMatchObject({ code: "LOCATION_REQUIRED" });
    } finally {
      fixture.close();
    }
  });
});
