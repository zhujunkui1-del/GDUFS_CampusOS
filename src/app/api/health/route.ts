import { APP } from "@/lib/app";
import { withApi } from "@/lib/server/http";
import { readServerEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const GET = withApi(() => {
  readServerEnv({ APP_ENV: process.env.APP_ENV });
  return { service: "campusos", status: "ok", version: APP.version };
});
