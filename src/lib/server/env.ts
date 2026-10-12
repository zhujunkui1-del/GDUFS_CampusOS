import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
  AMAP_WEB_KEY: z.string().optional(),
  AMAP_SECURITY_JS_CODE: z.string().optional(),
  AMAP_WEBSERVICE_KEY: z.string().optional(),
  MODEL_BASE_URL: z.union([z.literal(""), z.url()]).optional(),
  MODEL_API_KEY: z.string().optional(),
  MODEL_NAME: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
});

export function readServerEnv(values: Record<string, string | undefined>) {
  const result = envSchema.safeParse(values);
  if (!result.success) {
    // Only field names are disclosed; validation messages may contain secrets.
    const fields = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`环境变量配置不正确：${[...new Set(fields)].join(", ")}`);
  }
  return result.data;
}
