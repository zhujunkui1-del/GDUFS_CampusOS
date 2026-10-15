import { APP, CAPABILITIES } from "@/lib/app";
import { withApi } from "@/lib/server/http";
import { defaultModelRuntime } from "@/lib/server/models/runtime";
import { assistantBindings } from "@/lib/server/assistant/database";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  let storageReady = false;
  try { await assistantBindings().db.prepare("SELECT token_hash FROM assistant_sessions LIMIT 1").first(); storageReady = true; } catch {}
  const model = await defaultModelRuntime().status();
  return { campusId: APP.campusId, capabilities: { ...CAPABILITIES, routes: { ...CAPABILITIES.routes, available: true }, agent: { ...CAPABILITIES.agent, available: storageReady && model.ready } } };
});
