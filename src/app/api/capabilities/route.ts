import { APP, CAPABILITIES } from "@/lib/app";
import { withApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const GET = withApi(() => ({
  campusId: APP.campusId,
  capabilities: CAPABILITIES,
}));
