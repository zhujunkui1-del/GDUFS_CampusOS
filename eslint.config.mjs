import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    "vercel-gateway/**",
    ".wrangler/**",
    "**/.wrangler/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "services/external-search/runtime/**",
    "services/cloud-search/build/**",
    "services/xhs-redbook-eval/build/**",
    ".map-tools/**",
    ".tmp/**",
    ".tmp-open-next-build/**",
    "output/**",
    "backups/**",
    "scripts/kb_build/**",
    "public/vendor/**",
    "CampusOS_Codex_完整设计文档_v2/we-mp-rss-main/**",
    "CampusOS_Codex_完整设计文档_v2/wechat-article-exporter-main/**",
    "CampusOS_Codex_完整设计文档_v2/weixin_search_mcp-main/**",
  ]),
]);
