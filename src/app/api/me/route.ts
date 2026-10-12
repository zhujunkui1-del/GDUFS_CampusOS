import { requireUser } from "@/lib/server/auth";
import { withApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// Authentication is unavailable in S0; every request is anonymous.
// JSON fields and unverified cookies cannot establish a user identity.
export const GET = withApi(() => requireUser(null));
