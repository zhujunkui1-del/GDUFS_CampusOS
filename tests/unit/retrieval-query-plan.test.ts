import { describe, expect, it } from "vitest";
import { requestTimeWindow } from "@/lib/server/assistant/time-window";


describe("recent notice time window", () => {
  it("treats 最近的校园通知 as a 30-day publication window", () => {
    const w = requestTimeWindow("最近的校园通知", Date.parse("2026-10-29T04:00:00Z"));
    expect(w).toMatchObject({ after: "2026-09-30", before: "2026-10-29", role: "publication" });
  });
});
