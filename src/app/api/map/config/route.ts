import { withApi } from "@/lib/server/http";
import { mapRuntime } from "@/lib/server/map-env";
export const dynamic = "force-dynamic";
export const GET = withApi(() => {
  const { env } = mapRuntime();
  return {
    configured: !!(env.AMAP_WEB_KEY && env.AMAP_SECURITY_JS_CODE),
    webKey: env.AMAP_WEB_KEY || null,
    securityProxyPath: "/_AMapService",
    sdkVersion: "2.0",
  };
});
