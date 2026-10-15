# 广外通 CampusOS

广外大学城校区的响应式 Web 应用。正式域名：`gdufs.ccwu.cc`（已由负责人指定，尚未完成线上绑定）。需求基线保存在 `CampusOS_Codex_完整设计文档_v2/`。

S0 工程基线已完成；当前进行 S1 真实校园地图与验收：本地固定OSM底图、默认朝北、两区视野、87个 OSM 来源地点、搜索/详情和客户端地图动作已实现。校园完整名录、入口、自建路网/跨区隧道仍待核验；Agent/RAG、短信登录和模型设置尚未开发。实际边界见 [本次验收](docs/S1_LOCAL_MAP_ACCEPTANCE.md)；底图只手动更新，见 [维护步骤](docs/LOCAL_MAP_MAINTENANCE.md)。

## 本地运行

需要 Node.js 22.12+（本次验证使用 24.19.0）和 npm；数据库约束验证另需可运行的 `python` 3。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run db:migrate:local
npm run dev
```

访问 `http://127.0.0.1:3000/map`。保留 `.env.local` 内未知服务的空值；凭据只在本地环境或 Cloudflare Secret 中配置，不写入源码或文档。

本地地图不需要高德凭据；按需在线查询/路线需 `AMAP_WEB_KEY`、`AMAP_SECURITY_JS_CODE`；Next 开发写入被忽略的 `.env.local`，Workers 本地写入被忽略的 `.dev.vars`。高德后台允许本地与正式站点域名。安全密钥只用于服务端固定地址代理；`AMAP_WEBSERVICE_KEY` 未提供时保持空值，不冒充独立 Web 服务接入。请勿把凭据文件上传或提交。

地图只浏览教学、生活两区及按窗口比例确定的必要周边，首次进入地图页才加载本地渲染器，打开地图不请求高德；原始 OSM/GeoPackage 不整包加载到浏览器。校园几何优先 map.osm、横屏周边优先 map (1).osm。新增资料离线检查可运行 `python scripts/inspect-campus-sources.py`，需负责人提供的两个本地文件。

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
- `src/domain/`：MapAdapter、MapAction、核验路网算法及严格 Skill/Agent/会话合约；五项真实地图 Skill 已接执行器。
- `src/lib/server/`：错误封装、脱敏日志、环境校验和服务端权限检查。
- `migrations/`：空表迁移与约束，未经核验的地点/路径不能被标为已确认。
- `tests/`：权限/错误/地图合约单测与两种视口的 E2E；测试数据库仅在内存中含隔离夹具。
- `docs/`：进度、决策、数据来源、阻塞和部署说明。

当前固定校园地点和步行路网已接入，入口开放状态仍以现场为准；参考照片没有复制到公开资源库。真实运行截图与测试条件见 `docs/screenshots/s1/` 和 `docs/verification/s2-c/`。

## S2-C 真实 AI 与地图

原全局“问 AI”入口支持真实 DeepSeek、流式回复、地点/路线卡片和地图操作。服务端需配置 `MODEL_API_KEY`、`MODEL_NAME`、`MODEL_BASE_URL`、`MODEL_CAPABILITIES_JSON`，并增加 `AGENT_SIGNING_SECRET`（至少32字符，推荐32随机字节）；仅写入忽略的 `.env.local`/`.dev.vars` 或 Cloudflare Secrets。执行 `npm run db:migrate:local` 应用含0004的迁移，再运行 `npm run model:verify`。未配置或模型故障时，公共地图继续独立使用。

Next dev 通过 OpenNext 开发绑定访问本地D1；Workers构建后用 `npm run preview:worker`。不要同时启动两个独立本地D1模拟器写同一个持久目录。共享会话/额度/动作/建筑路线使用D1；设备精确路线只保留短期页面票据，刷新后重新定位。默认2D、现有导航与南苑7栋模型保持，批量建模暂停。

真实模型测试明确启用且会使用API额度：设置 `E2E_BASE_URL`、`PLAYWRIGHT_CHANNEL=chrome` 或 `msedge`、`E2E_LIVE_AGENT=1`，运行 `npx playwright test tests/e2e/assistant-live.spec.ts tests/e2e/assistant-location-live.spec.ts --workers=1`。默认回归跳过付费用例；隔离双Worker共享D1运行 `npm run test:assistant:state`。验收、安全/成本边界、截图与S2-D依赖见 [S2-C报告](docs/S2_C_AI_MAP_ACCEPTANCE.md)。

部署与回滚见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，架构边界见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，实测记录见 [docs/PROGRESS.md](docs/PROGRESS.md)。

S2-D本地验收与上线缺项见 [验收报告](docs/S2_D_AGENT_ACCEPTANCE.md)：AI/地图可直接清路线，手机步行面板支持保留最小档上下拖动。180单元和Chrome/Edge各61项常规回归通过，真实DeepSeek证据单列；云端与真实手机未完成，不作为公网试用就绪。

Workers构建务必用 `npm run build:worker`：包装器移除OpenNext生成的服务端环境默认值并扫描残留秘密。不要绕过包装器直接构建发布；运行时模型密钥/签名Secret通过本地 `.dev.vars` 或云端Secret配置。离线核查可运行 `node tests/integration/verify-s2-d-artifacts.mjs`，它要求本机实际MODEL/签名Secret存在，仅输出计数/结论，不输出值。

S2-E隔离HTTPS预览：[打开CampusOS地图](https://campusos-preview.zhujunkui1.workers.dev/map)。独立Worker/D1和云端真实Agent已运行，完整验收、截图、手机测试步骤及Free CPU风险见 [S2-E报告](docs/S2_E_CLOUDFLARE_PREVIEW_ACCEPTANCE.md)。低频功能通过不等于免费套餐长期稳定或生产已就绪；正式域名/生产库/套餐仍需另批。模型能力24小时到期须管理员重新验证并更新预览Secret，当前未自动安排付费刷新。
