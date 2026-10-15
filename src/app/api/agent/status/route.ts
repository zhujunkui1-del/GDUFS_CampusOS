import { withApi } from "@/lib/server/http";
import { defaultModelRuntime } from "@/lib/server/models/runtime";
import { AGENT_DOMAINS } from "@/lib/server/agent/domains";
import { mapSkillRegistry } from "@/lib/server/maps/runtime";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => ({
  stage: "S2-B",
  chatAvailable: false,
  status: "map_skills_ready_pending_chat_ui_and_shared_quotas",
  model: await defaultModelRuntime().status(),
  domains: AGENT_DOMAINS,
  skills: mapSkillRegistry.manifest(),
}));
