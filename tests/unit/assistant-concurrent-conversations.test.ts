import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
import { AssistantStore } from "@/lib/server/assistant/store";
const req = (cookie = "") =>
  new Request("https://campus.example/api/agent/session", {
    headers: { Cookie: cookie },
  });

it("one account runs two conversations at the same time (multiple sessions, several devices)", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("concurrent_conversations"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token));
    const first = await s.conversation(u);
    // Same account, second session: another conversation must not be blocked.
    const second = await s.conversation(u, undefined, crypto.randomUUID());
    const firstRun = await s.reserve(
      u,
      first,
      crypto.randomUUID(),
      "fixture-a",
    );
    const secondRun = await s.reserve(
      u,
      second,
      crypto.randomUUID(),
      "fixture-b",
    );
    expect(secondRun).not.toBe(firstRun);
    const running = await f.db
      .prepare(
        "SELECT count(*) AS n FROM agent_runs WHERE owner_key=? AND status='running' AND lease_until_ms>?",
      )
      .bind(u.owner, f.store.now())
      .first<{ n: number }>();
    expect(running?.n).toBe(2);
  } finally {
    f.close();
  }
});

it("the same conversation still refuses a second reply in flight", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("single_conversation"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token));
    const c = await s.conversation(u);
    await s.reserve(u, c, crypto.randomUUID(), "fixture");
    await expect(
      s.reserve(u, c, crypto.randomUUID(), "fixture"),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "上一条回复仍在进行，请等待完成或停止后重试。",
    });
  } finally {
    f.close();
  }
});
