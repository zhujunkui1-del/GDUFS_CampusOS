import { withApi } from "@/lib/server/http";
import { defaultModelRuntime } from "@/lib/server/models/runtime";
import { AGENT_DOMAINS } from "@/lib/server/agent/domains";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => ({
  stage: "S2-A",
  chatAvailable: false,
  status: "pending_map_skills_and_session_quotas",
  model: await defaultModelRuntime().status(),
  domains: AGENT_DOMAINS,
  skills: new SkillRegistry().manifest(),
}));
