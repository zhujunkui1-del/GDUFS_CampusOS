# 广外通 CampusOS

广外大学城校区的响应式 Web 应用。正式域名：`gdufs.ccwu.cc`（已由负责人指定，尚未完成线上绑定）。需求基线保存在 `CampusOS_Codex_完整设计文档_v2/`。

当前为 S0 工程基线：六个页面入口、全局 AI 面板/手机抽屉、API 错误与权限基础、30 张空数据表和 Cloudflare Workers 本地预览。校园地图、地点/路线、Agent/RAG、短信登录尚未接入，页面显示实际不可用状态。

## 本地运行

需要 Node.js 22.12+（本次验证使用 24.19.0）和 npm；数据库约束验证另需可运行的 `python` 3。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run db:migrate:local
npm run dev
```

访问 `http://127.0.0.1:3000/map`。保留 `.env.local` 内未知服务的空值；凭据只在本地环境或 Cloudflare Secret 中配置，不写入源码或文档。

## 验证

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run db:verify
npm run build
npm run build:worker
npm run preview:worker
```

Workers 本地预览默认为 `http://127.0.0.1:8787`，连接本地 D1，不需要 Cloudflare 账户。

浏览器 E2E 默认使用 Playwright Chromium：先运行 `npx playwright install chromium`，再运行 `npm run test:e2e`。Windows 如已安装 Edge，也可运行：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

测试默认复用端口 3000 的本项目开发服务，否则自行启动。要验证已经启动的 Workers 预览，可设置 `$env:E2E_BASE_URL = 'http://127.0.0.1:8787'` 后运行同一测试。

## 结构与后续阶段

- `src/app/`：页面和 API 路由；地图首页是 `/map`。
- `src/components/`：导航/响应式 Shell 和公共空状态。
- `src/features/campus-map/`、`src/features/assistant/`：地图及全局 AI 的独立 UI 边界。
- `src/domain/`：MapAdapter、MapAction 和 Skill 合约；S0 未注册真实地图 SDK 或 Skill 执行器。
- `src/lib/server/`：错误封装、脱敏日志、环境校验和服务端权限检查。
- `migrations/`：空表迁移与约束，未经核验的地点/路径不能被标为已确认。
- `tests/`：权限/错误/地图合约单测与两种视口的 E2E；测试数据库仅在内存中含隔离夹具。
- `docs/`：进度、决策、数据来源、阻塞和部署说明。

下一阶段 S1 需要高德凭据、获准的真实大学城地点/入口/路网与隧道资料。参考图片没有复制到公开资源库。

部署与回滚见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，架构边界见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，实测记录见 [docs/PROGRESS.md](docs/PROGRESS.md)。
