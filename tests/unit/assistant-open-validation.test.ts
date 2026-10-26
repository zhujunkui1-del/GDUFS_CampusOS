import { it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { AssistantStore } from "@/lib/server/assistant/store";
it("Preview open validation can continue past the old 20-turn guest cap", async () => {
  const f = sqliteD1(),
    now = Date.now();
  try {
    const store = new AssistantStore(f.db, () => now, true);
    const identity = await store.identity(new Request("https://preview.test"));
    const conversation = await store.conversation(identity);
    for (let i = 0; i < 25; i++) {
      const run = await store.reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated-validation",
      );
      await store.finish(identity, run, "completed", {}, 100);
    }
    expect(f.sqlite.prepare("SELECT count(*) n FROM agent_runs").get()?.n).toBe(
      25,
    );
    const active = await store.reserve(
      identity,
      conversation,
      crypto.randomUUID(),
      "isolated-validation",
    );
    await expect(
      store.reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated-validation",
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await store.finish(identity, active, "completed", {}, 100);
  } finally {
    f.close();
  }
});
