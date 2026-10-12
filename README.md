# 广外通 CampusOS

广外大学城校区的响应式 Web 应用。正式域名：`gdufs.ccwu.cc`（已由负责人指定，尚未完成线上绑定）。需求基线保存在 `CampusOS_Codex_完整设计文档_v2/`。

S0 工程基线已完成；当前进行 S1 真实校园地图与验收：高德官方底图、两区视野、75个 OSM 来源地点、搜索/详情和客户端地图动作已实现。校园完整名录、入口、自建路网/跨区隧道仍待核验；Agent/RAG、短信登录和模型设置尚未开发。实际边界见 [S1验收记录](docs/S1_ACCEPTANCE.md)。

## 本地运行

需要 Node.js 22.12+（本次验证使用 24.19.0）和 npm；数据库约束验证另需可运行的 `python` 3。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run db:migrate:local
npm run dev
```

访问 `http://127.0.0.1:3000/map`。保留 `.env.local` 内未知服务的空值；凭据只在本地环境或 Cloudflare Secret 中配置，不写入源码或文档。

地图需 `AMAP_WEB_KEY`、`AMAP_SECURITY_JS_CODE`；Next 开发写入被忽略的 `.env.local`，Workers 本地写入被忽略的 `.dev.vars`。高德后台允许本地与正式站点域名。安全密钥只用于服务端固定地址代理；`AMAP_WEBSERVICE_KEY` 未提供时保持空值，不冒充独立 Web 服务接入。请勿把凭据文件上传或提交。

地图只浏览教学、生活两区及按窗口比例确定的必要周边，首次进入地图页才加载 SDK；原始 OSM/GeoPackage 不整包加载到浏览器。新增资料离线检查可运行 `python scripts/inspect-campus-sources.py`，需负责人提供的两个本地文件。

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
- `src/domain/`：MapAdapter、MapAction、核验路网算法及 Skill 合约；未注册真实 Agent/Skill 执行器。
- `src/lib/server/`：错误封装、脱敏日志、环境校验和服务端权限检查。
- `migrations/`：空表迁移与约束，未经核验的地点/路径不能被标为已确认。
- `tests/`：权限/错误/地图合约单测与两种视口的 E2E；测试数据库仅在内存中含隔离夹具。
- `docs/`：进度、决策、数据来源、阻塞和部署说明。

S1 剩余需要完整地点名录、已核验入口/通行路网与隧道资料；参考图片没有复制到公开资源库。真实运行截图与测试条件见 `docs/screenshots/s1/`。

部署与回滚见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，架构边界见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，实测记录见 [docs/PROGRESS.md](docs/PROGRESS.md)。
