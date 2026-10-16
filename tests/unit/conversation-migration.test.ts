import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";

it("upgrades populated 0004 without deleting history, quota or route payloads", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  try {
    for (const file of [
      "0001_platform_and_campus.sql",
      "0002_knowledge_and_events.sql",
      "0003_route_geometry_guards.sql",
      "0004_assistant_shared_state.sql",
    ])
      db.exec(readFileSync("migrations/" + file, "utf8"));
    const cid = crypto.randomUUID(),
      route = crypto.randomUUID(),
      owner = "g:isolated-upgrade-owner";
    db.prepare(
      "INSERT INTO conversations(id,guest_session_hash,owner_key,expires_at_ms,updated_at_ms,active_route_id) VALUES(?,?,?,?,?,?)",
    ).run(cid, "isolated-upgrade-owner", owner, 9999999999999, 100, route);
    db.prepare(
      "INSERT INTO conversation_messages(id,conversation_id,role,content,artifacts_json) VALUES(?,?,'user','原始标题','[]')",
    ).run(crypto.randomUUID(), cid);
    db.prepare(
      "INSERT INTO agent_runs(id,conversation_id,status,owner_key,request_id,ip_key,started_at_ms,lease_until_ms,charged_tokens) VALUES(?,?,'completed',?,?,?,?,0,17)",
    ).run(
      crypto.randomUUID(),
      cid,
      owner,
      crypto.randomUUID(),
      "isolated",
      100,
    );
    db.prepare(
      "INSERT INTO assistant_route_refs(id,owner_key,expires_at_ms,map_version,network_version,payload_json) VALUES(?,?,9999999999999,'fixture-map','fixture-network',?)",
    ).run(route, owner, JSON.stringify({ testOnly: "unchanged payload" }));
    const before = db
      .prepare("SELECT payload_json FROM assistant_route_refs")
      .get();
    db.exec(
      readFileSync("migrations/0005_assistant_conversations.sql", "utf8"),
    );
    expect(
      db.prepare("SELECT content FROM conversation_messages").get()?.content,
    ).toBe("原始标题");
    expect(
      db.prepare("SELECT title,deleted_at_ms FROM conversations").get(),
    ).toMatchObject({ title: "原始标题", deleted_at_ms: null });
    expect(
      db.prepare("SELECT charged_tokens FROM agent_runs").get()?.charged_tokens,
    ).toBe(17);
    expect(
      db.prepare("SELECT payload_json FROM assistant_route_refs").get(),
    ).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT conversation_id,route_id FROM assistant_conversation_routes",
        )
        .get(),
    ).toMatchObject({ conversation_id: cid, route_id: route });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
