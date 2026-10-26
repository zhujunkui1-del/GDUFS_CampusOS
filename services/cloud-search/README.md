# CampusOS Preview 云端搜索

当前状态及真实失败见 [迁移报告](../../docs/CLOUD_SEARCH_MIGRATION_2026_10_27.md)。普通网页已通过真实 Agent 检索；小红书登录后仍回到游客状态，未通过原生搜索/重启恢复验收。

入口 Worker 验证 SERVICE_TOKEN，仅接受只读搜索和私有会话维护。普通网页进入 lite Node Container，小红书进入 ManagedXhs/Cloudflare Browser Run；主 Preview 通过 Service Binding 调用，不经本机 relay。

从仓库根目录构建和部署：

```powershell
node services/cloud-search/build.mjs
npx wrangler deploy --config services/cloud-search/wrangler.jsonc
```

配置仅指向 Preview 固定账户。SERVICE_TOKEN、PROFILE_KEY 使用 Wrangler Secret；R2 bucket 保持私有。主 Preview 的 CLOUD_SEARCH_TOKEN 应与 SERVICE_TOKEN 相同。凭据配置脚本从忽略目录读入，禁止在命令参数、日志或 Git 中填写密钥。无须导出日常浏览器 profile。

有界私有诊断：

```powershell
node scripts/inspect-cloud-search.mjs status
node scripts/inspect-cloud-search.mjs managed-probe
node scripts/inspect-cloud-search.mjs search "广外 南校 一饭"
node scripts/inspect-cloud-search.mjs web "广东外语外贸大学 图书馆 借阅规则"
```

`login` 只由管理员明确要求时生成二维码；`verify` 生成短期 Live View，脚本只将地址写到忽略的 runtime，不打印或提交。`managed-restart` 关闭当前云端浏览器并从下次请求恢复加密状态，不能将 guest 状态的恢复当成登录成功。有效会话文件存在也不保证源站仍接受它。

测试资料在 tests/unit/{cloud-search,managed-session,source-qr}.test.ts、tests/e2e/cloud-{search-live,session-ui}.spec.ts。运行公网测试须显式设置 CLOUD_SEARCH_LIVE=1、E2E_BASE_URL 为 Preview；不得将夹具的 logged_in 响应冒充真人验收。

无自动破解验证、代理轮换或浏览器身份伪装；源站拒绝时返回真实失败。小红书笔记保留原文跳转、来源和经验属性，不进入官方政策库。回退本机是另一次维护决策，当前没有自动切回。
