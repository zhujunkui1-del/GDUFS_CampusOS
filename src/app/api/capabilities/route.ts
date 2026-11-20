import { APP, CAPABILITIES } from "@/lib/app";
import { withApi } from "@/lib/server/http";
import { platformModelStatus } from "@/lib/server/models/runtime";
import { assistantBindings } from "@/lib/server/assistant/database";

export const dynamic = "force-dynamic";
export const GET = withApi(async () => {
  let storageReady = false;
  let db: ReturnType<typeof assistantBindings>["db"] | undefined;
  try {
    db = assistantBindings().db;
    await db
      .prepare("SELECT token_hash FROM assistant_sessions LIMIT 1")
      .first();
    storageReady = true;
  } catch {}
  // The console can switch the platform model chain off; the capability flag
  // follows the chain that would actually answer, not the static config.
  const model = await platformModelStatus(db);
  return {
    campusId: APP.campusId,
    capabilities: {
      ...CAPABILITIES,
      routes: { ...CAPABILITIES.routes, available: true },
      agent: { ...CAPABILITIES.agent, available: storageReady && model.ready },
    },
  };
});
