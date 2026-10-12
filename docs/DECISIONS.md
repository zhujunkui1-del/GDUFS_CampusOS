# 架构决策记录

更新时间：2026-10-12（Asia/Shanghai）

规则：本文件记录项目负责人已确定的需求基线、技术核验结果及尚待确认的选择。未经负责人确认，不替换核心产品范围或技术方案。

## 已确定的产品/架构基线

| ID    | 决定                                                                                                       | 状态/依据                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D-001 | 只做广外大学城校区地图，覆盖教学区、生活区、连接道路和南校隧道；不做白云山地图                             | 已确定：v2 `AGENTS.md`、`00_README_项目索引.md`、`01_PRODUCT_SPEC.md`、`05_MAP_DESIGN.md` |
| D-002 | 响应式 Web；桌面左导航/地图/全局 AI，手机地图/底部 AI 抽屉；不做原生 App                                   | 已确定：`01_PRODUCT_SPEC.md`、`06_UI_UX_DESIGN.md`                                        |
| D-003 | 1 个总控 Agent + 4 个领域模块、16 项真实 Skill、白名单式 MapAction；Skill 后端校验输入、权限、输出和副作用 | 已确定：`02_AGENT_ARCHITECTURE.md`、`03_SKILL_DESIGN.md`                                  |
| D-004 | 官方来源通过校验可自动索引；活动关键日期/地点要核验；社交/群聊/地图素材人工审核；空间社交 P2               | 已确定：`04_RAG_DESIGN.md`、`10_CAMPUS_SOCIAL.md`                                         |
| D-005 | 高德官方 JS API 2.0 是第一候选，使用 `MapAdapter` 隔离 SDK；校内自有地点和路网必须有许可/核验来源          | 已确定为候选与边界：`05_MAP_DESIGN.md`、`08_DATABASE_API.md`；尚未完成实测                |
| D-006 | 自有账号+手机号找回+游客模式；学校 SSO/教务同步只在取得正式授权后接入                                      | 已确定：`AGENTS.md`、`07_ACCOUNT_SYSTEM.md`                                               |
| D-007 | 初始全栈方向为 Next.js + TypeScript，Cloudflare Workers 适配层；D1/Vectorize/R2 为推荐组件                 | 设计基线候选：`09_DEVELOPMENT_PLAN.md`、`08_DATABASE_API.md`；最终运行时/部署适配待核验   |

## 技术核验与待确认事项

### D-008：Next.js 部署适配器

- 核验结果（2026-10-12）：Cloudflare 官方仍提供 Next.js on Workers 的 OpenNext 指引；当前文档同时推荐 `vinext` 作为新的 Next.js-on-Workers 项目的默认方案。
- 影响：基线指定 Next.js + Workers，但未锁定 OpenNext 或 vinext。两者的兼容范围、迁移风险、开发体验和比赛交付风险需要在 S0 做小型适配验证。
- 决策：负责人于 2026-10-12 确认启动 S0；保留 Next.js + TypeScript + Workers 的基线并验证 OpenNext，不切换至 vinext。最终版本组合和实际运行证据见下方 S0 记录。
- 来源：[Cloudflare Next.js 文档](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)、[Cloudflare Web Apps 文档](https://developers.cloudflare.com/workers/framework-guides/web-apps/)。

### D-009：Cloudflare 数据与部署服务

- 核验结果：D1 使用 SQLite 语义并支持 FTS5；Vectorize 当前为 GA，可连接 Workers 与 Embedding 模型；R2 可绑定到 Worker。Vectorize 建索引前需确定 embedding 维度/距离度量。Workers 各套餐限制不同。
- 影响：这组组件技术上可作为候选，但选用前须定模型/维度、数据隔离、成本/配额、部署区域与备份。负责人已指定域名 `gdufs.ccwu.cc`；账号、套餐和 DNS/HTTPS 接入仍未核实。
- 决策：保留设计文档推荐方向；不创建线上资源、不产生费用，直至负责人确认。
- 来源：[D1](https://developers.cloudflare.com/d1/)、[Vectorize](https://developers.cloudflare.com/vectorize/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)。

### D-010：高德 SDK、路线和坐标

- 核验结果：高德 JS API 2.0 支持地图交互、倾斜/3D 相关功能和步行规划；高德官方路线服务也提供步行路线 API。JS API 需要 Web JS API Key 与安全密钥，生产建议用服务器代理；高德底图采用 GCJ-02。
- 关键限制：SDK/API 能调用，不代表广外校内每条道路、建筑入口或南校地下隧道有真实拓扑覆盖。不能仅凭外部步行规划的结果宣称校园路线已核验。S1 路线成功状态必须基于有来源、许可和核验标记的路段。
- 决策：高德仍为第一候选，不把 AMap 响应直接持久化为可再分发 POI/路网数据库；内部坐标约定、转换与路线数据授权需在 S1 前确认。
- 来源：[JS API 2.0 文档](https://lbs.amap.com/api/javascript-api-v2/documentation)、[JS API 安全密钥](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)、[步行路线 Web 服务](https://lbs.amap.com/api/webservice/guide/api/newroute)、[坐标说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/basetype)。

### D-011：模型与 Embedding 供应商

- 设计要求：模型需实测支持 Tool Calling/结构化输出；Embedding 模型需与向量索引配置匹配。模型调用有超时、成本、并发和日志脱敏控制。
- 当前状态：文档未指定供应商、模型或计费账户；没有 API Key。Cloudflare Workers AI 是备选之一，但其模型、Tool Calling、中文检索质量和成本未做比较。
- 决策：S2 前列出兼容候选并由负责人确认；密钥只使用本地环境变量或云端 Secret，不提交到仓库。

### D-012：真实校园数据与地图素材

- 校内真实地点搜索需要可展示/长期使用的地点、别名、分类、校区区块与来源；路线还需要有证据的出入口、步行路径节点/边及地下层级。
- 本地用户地图图片仅作为研究资料；不视为可自由发布、数字化改编或重新分发许可。UI 视觉稿不是 GIS 数据。
- 决策：无来源或授权时返回真实空状态/`INSUFFICIENT_DATA`；不得用假地点、坐标或路线替代。

## 开发前审查记录

最初的审查仅创建项目状态、决策、数据来源和阻塞文档。负责人确认后进入 S0；当前状态以 `PROGRESS.md` 为准。

## S0 已落实的工程选择（2026-10-12）

- **版本组合**：Next.js 16.3.8、React 19.3.0、TypeScript 5.9.3、OpenNext 1.20.10、Wrangler 4.149.0；npm 锁文件固定依赖，基线架构未替换。Typecheck 先运行 `next typegen`，确保干净 checkout 不依赖旧构建类型。
- **兼容性证据**：Next.js 16.4.0 的 Node 构建可成功，但 Workers 请求会因 `preview-props.json` 清单变化返回 500；因此固定到 16.3 系列的补丁版。OpenNext 1.19.11 与 16.3.8 的实际请求也失败，最终 1.20.10 的 Workers 预览页面、API 和六项 E2E 已全部通过。参见 [上游问题与未发布修复](https://github.com/opennextjs/opennextjs-cloudflare/pull/1356)。未来升级要重新执行真实 Workers E2E，不能只看 peerDependencies 或构建成功。
- **构建依赖**：OpenNext 为开发依赖；对构建链 `@node-minify/core` 的 glob 固定到已修复对应告警的 10.5.0，对 rclone.js 的 adm-zip 固定到 0.6.1。S0 未启用 R2 增量缓存，因此未运行 rclone.js 的下载脚本。整个审计仍有 ESLint/Next glob 链 5 项开发工具告警；运行依赖审计为 0。
- **工具版本**：ESLint 使用 Next 当前插件 peer 范围支持的 9.39.5；10.12.0 虽能执行 lint，但插件依赖树显示 peer 不兼容，故不采用。ESLint 9 已被上游标记结束支持，列入后续工具维护事项。
- **数据与边界**：地点/节点内部坐标统一 WGS84；MapAdapter 在 S1 承担高德 GCJ-02 转换。Schema 与数据库 ID/权限验证分开，S0 不注册真实 Skill 或地图动作执行器。
- **项目域名**：`gdufs.ccwu.cc` 写入公开项目 URL 和 production custom-domain 配置；2026-10-12 A/AAAA 查询只返回 SOA，HTTPS 连接未成功。不将目标域名声明为已上线。
- **源码管理**：创建本地 Git `main`，未经许可的研究图片不进入 Git/公开资源目录；没有配置远程仓库或推送。

## UI 修订决定（2026-10-12）

负责人明确要求删除顶栏并加强 Apple-inspired、局部 Liquid Glass、Minimalism。已按此批准调整功能浮层/字体/导航位置；原模块范围与 Next/Workers、Agent、Skill、数据权限边界继续沿用。使用 Base UI React 1.9.0 的非模态 Drawer，统一焦点/拖动/停靠；没有增设 UI 原型或虚假数据入口。细节、颜色对比与实际检查边界见 `UI_REVIEW.md`。
