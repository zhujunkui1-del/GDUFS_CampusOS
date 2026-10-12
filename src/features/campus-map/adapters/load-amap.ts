import { z } from "zod";
import { currentAMap, type AMapSDK } from "./amap-types";

let loading: Promise<AMapSDK> | undefined;
export function loadAMap(): Promise<AMapSDK> {
  const existing = currentAMap();
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch("/api/map/config", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const body = z
      .object({
        ok: z.literal(true),
        data: z.object({
          configured: z.boolean(),
          webKey: z.string().nullable(),
          securityProxyPath: z.literal("/_AMapService"),
        }),
      })
      .parse(await response.json());
    if (!body.data.configured || !body.data.webKey)
      throw new Error("高德地图尚未配置，请联系维护者。");
    window._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}${body.data.securityProxyPath}`,
    };
    const key = body.data.webKey;
    return new Promise<AMapSDK>((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        script.remove();
        reject(new Error("地图加载超时，请检查网络后重试。"));
      }, 20000);
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      script.async = true;
      script.onload = () => {
        clearTimeout(timeout);
        const sdk = currentAMap();
        if (sdk) resolve(sdk);
        else {
          script.remove();
          reject(
            new Error("高德 SDK 未能初始化，请检查 Key 类型和域名白名单。"),
          );
        }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("无法下载高德地图，请检查网络后重试。"));
      };
      document.head.append(script);
    });
  })();
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}
