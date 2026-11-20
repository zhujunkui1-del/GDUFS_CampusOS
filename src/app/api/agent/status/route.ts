import { withApi } from "@/lib/server/http";
import { platformModelStatus } from "@/lib/server/models/runtime";
import { AGENT_DOMAINS } from "@/lib/server/agent/domains";
import { mapSkillRegistry } from "@/lib/server/maps/runtime";
import { assistantBindings } from "@/lib/server/assistant/database";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  let db: Parameters<typeof platformModelStatus>[0] = undefined;
  try {
    db = assistantBindings().db;
  } catch {}
  let storageReady = false;
  if (db)
    try {
      await db
        .prepare("SELECT token_hash FROM assistant_sessions LIMIT 1")
        .first();
      storageReady = true;
    } catch {}
  // The console-managed chain decides which provider answers. Without a database
  // handle the Worker variables decide, so the status stays truthful either way.
  const model = await platformModelStatus(db);
  return {
    stage: "S2-C",
    chatAvailable: model.ready && storageReady,
    status: model.ready && storageReady ? "ready" : "unavailable",
    storageReady,
    model,
    domains: AGENT_DOMAINS,
    skills: mapSkillRegistry.manifest(),
  };
});
