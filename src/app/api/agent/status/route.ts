import { withApi } from "@/lib/server/http";
import { defaultModelRuntime } from "@/lib/server/models/runtime";
import { AGENT_DOMAINS } from "@/lib/server/agent/domains";
import { mapSkillRegistry } from "@/lib/server/maps/runtime";
import { assistantBindings } from "@/lib/server/assistant/database";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  const model = await defaultModelRuntime().status();
  let storageReady = false;
  try {
    await assistantBindings()
      .db.prepare("SELECT token_hash FROM assistant_sessions LIMIT 1")
      .first();
    storageReady = true;
  } catch {}
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
