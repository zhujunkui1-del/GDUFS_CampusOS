# S0 工程架构

> 当前知识架构（2026-10-17，D-045）：自研Agent + 自研RAG + Cloudflare D1。KnowledgeRetriever为平台无关自研接口，D1KeywordRetriever为待实现正式后端路线，优先关键词/标题/分类/分段；Dify全部废弃。现有来源/文章/版本/审核/outbox是权威，公开检索复验当前权限、许可、版本及生命周期。向量资源另批；[S3-D计划](S3_D_RETRIEVAL_PLAN.md)为当前验收入口。下方各节按原日期保留历史。

日期：2026-10-12。已确认保留 Next.js + TypeScript + Cloudflare Workers 的基线，使用 OpenNext 适配。S0 没有接入真实地图、模型、RAG、短信或学校系统。

## 页面与状态

六个路由 `/map`、`/radar`、`/knowledge`、`/schedule`、`/favorites`、`/account` 共用 `(campus)/layout.tsx`。Shell 保留导航展开和全局 AI 面板状态；页面内跳转不会创建另一个 Agent。手机底部五入口，收藏入口位于“我的”。AI 抽屉支持半屏/全屏、拖动和键盘操作；退出时恢复打开按钮的焦点。

地图区域只展示实际数据缺失状态，没有由视觉稿制作的建筑、路线或预设答案。地图 UI 与 AI UI 分别位于各自 feature 目录，未来业务实现沿此边界扩展。

## API、权限与密钥

- `GET /api/health` 检查基础服务与配置格式，返回版本及服务健康；不表示第三方已可用。
- `GET /api/capabilities` 返回已实现能力的真实状态，所有第三方业务能力当前为 false。
- `GET /api/me` 目前始终以游客身份处理并返回 401；请求里的 userId、Cookie 或 Header 不会建立身份。
- `withApi` 生成服务端 requestId，统一错误码/HTTP 状态；未知异常不回传消息，日志只含白名单运行字段。
- `requireUser`、`requireAdmin`、`requireOwner` 接受由未来服务端会话验证器提供的上下文；管理员内容权限不允许读取他人私人业务。
- 服务秘密变量不使用 `NEXT_PUBLIC_`。仅公开项目 URL 使用该前缀。环境校验错误不包含原始变量值。

S0 的授权检查原语不等于已实现短信登录。S4 必须接入真实 Session DAO、OTP 限流及实际短信供应商后才能启用账号操作。

## 地理与 Skill 合约

内部地点/节点字段统一为 WGS84，并明确存储 CRS；高德边界在 S1 转为 GCJ-02，保留来源原始坐标/转换记录。没有真实数据时不实现猜测转换结果或路径。

MapAction 仅允许五种声明式动作并检查大小、类型及未知字段；S1/S2 还必须查数据库验证地点/路线 ID、范围和当前用户权限，结构校验本身不表示 ID 已合法。

SkillDefinition 具有输入/输出 Schema、权限、副作用、确认与超时字段。S0 只建立合约，不声明任何真实 Skill 已运行；S2 实现注册器和真实调用记录。

## 数据库

本地 D1 与内存 SQLite 均应用同一迁移；30 张表全部无业务种子。私有表带 owner/user 约束和索引；个人资料不进入公共知识域。迁移校验来源许可、地理核验、路径端点、跨校区活动、对话归属和路线几何。来源撤回会撤销对应地点/路段的已确认状态。

S1 地点查询仍须同时检查许可、地理状态和用途匹配；S3 检索仍须检查文档权限/生命周期和向量索引撤回。SQL 约束不能代替这些业务过滤。D1 使用 JSON 几何和关系表，不依赖其未声明提供的 PostGIS/SpatiaLite。

## 环境与公开部署

Next.js 本地服务和本地 workerd 预览均可启动。`wrangler.jsonc` 将 local/preview/production 的数据库、Worker 名和域名分开；全零 D1 ID 是显式占位值，部署脚本会在任何构建/上传前拒绝缺账户或占位配置。

`gdufs.ccwu.cc` 是负责人提供的目标域名。2026-10-12 本机 DNS 查询未返回该主机 A/AAAA，HTTPS 未验证成功。没有执行云资源创建、DNS 修改或公开部署。

## S1 扩展（2026-10-13）

`CampusMapProvider` 在共享 Shell 内维护唯一地图实例。底图固定铺满窗口；导航/搜索/详情/全局 AI 独立浮动，页面跳转不销毁地图和当前路线。客户端 SDK 是否真正就绪由页面状态判断，不能从 Key 存在推断成功。

地物源是独立 ODbL 的版本化校园数据；`/api/places` 与 `/api/map/data` 提供受控公开查询及完整署名。坐标经 `/api/map/coordinates` 官方服务转换，返回 GCJ-02；成功结果短期缓存，失败不使用近似偏移。安全代理固定 HTTPS 高德目标、服务器注入安全码、限流/超时并拒绝重定向；对外配置只包含发布型 JS Key。

同区高德在线规划由客户端 SDK 实际请求并检查端点/校区范围，结果仅页面内存；后端路线 Skill/会话绑定快照仍属 S2，未启用。自有图算法只走经核验边；目前候选图不满足这一条件，跨区隧道保持不可用。地图操作合约限制动作、地物 ID/图层与当前真实路线 ID；全局助理只接收选中地点上下文，没有模型调用。

原 30 张 D1 表/账号边界保留，不把 OSM 来源映射状态自动转成数据库已审批状态，不把夹具写入业务库。详见 `S1_ACCEPTANCE.md` 和地物目录的 `README.md`。

## 当前地图架构（2026-10-13，D-018）

默认 MapLibre 本地OSM渲染，不请求高德底图；校园WGS84数据、复合外环/内庭与未来模型共享版本。高德SDK只在用户主动在线查询/规划时加载，GCJ02服务结果由锁版本gcoord与WGS84底图对齐；旧 /api/map/coordinates 保留受限接口但不用于地图启动。MapAdapter/地点ID/MapAction边界不变，唯一实例由Provider维护，主相机/渲染前地面视口范围由本地适配器约束。源详情与维护见 LOCAL_MAP_MAINTENANCE.md。

## S2-A Agent核心（2026-10-15）

src/lib/server/models承载受控DeepSeek ModelClient、ProviderRegistry、ModelRouter、管理员能力验证与Cloudflare/Node运行环境；src/lib/server/agent承载1总控、4逻辑域、SkillRegistry/ToolExecutor、局部限额与循环。秘密为JS私有字段或服务端环境，不进入客户端接口；ModelRouter要求实测记录而非配置声称支持工具。

S2-A对话仅隔离诊断验证，业务注册表为空；/api/agent/status提供无付费查询，/api/agent/chat严格验证后503，原AssistantPanel继续准确禁用。S2-B/C接入现有真实地图服务、可信会话/路线快照和共享配额后启用，未复制/重构地图。已有D1会话/运行表尚未接DAO，不声称持久会话。完整边界与结果见S2_A_AGENT_CORE.md，模型失败与错误配置不影响mapRuntime/health。

## S2-C 共享AI与地图（2026-10-15，当前权威状态）

原五Skill与Agent核心接入真实全局AssistantPanel，/api/agent/chat已为真实SSE，不再固定503。src/lib/server/assistant负责D1身份/会话/用量/路线/动作包与回执，模型输出经Schema和原控制器执行后才确认。34张业务表；建筑路线可跨运行时恢复，设备路线仅短期签名页面票据，精确位置不进模型/D1历史。配额使用D1原子INSERT触发器，关键DAO first-primary，未用KV/单实例内存假装共享强一致。原MapLibre/静态OSM/本地路网/南苑7栋未变，地图不依赖AI就绪。

账号识别只接已有login_sessions验证DAO，个人业务权限仍关闭；/api/me和SMS产品流程尚未实现，不能据DAO测试宣称账号上线。详细架构/接口/容量/安全与实测见S2_C_AI_MAP_ACCEPTANCE.md。前面的S0/S1/S2-A段落是阶段历史，不覆盖当前状态。

## S2-E隔离预览（2026-10-16）

实际workers.dev使用专用D1/Secret、原5 Skill与同一Agent。为解决云端Free CPU观测到的超限，预览main薄封装转交原API函数，通过OpenNext生成的ALS提供相同可信绑定；其他页面走原OpenNext并读取ASSETS预渲染缓存。无新服务/地图渲染架构或业务Skill。私有API/SSE不缓存，Cookie/安全头/Origin/Schema/权限/额度不变。适配器升级须重新验证生成模块接口。

Schema对象仅复用冻结定义元数据；业务结果仍按原Run隔离策略。D1回执JOIN同时检查运行中租约、动作/运行所有权和有效期，渐进轮询/40SQL软阈值保留最终化查询余量。真实Worker更新后共享D1恢复通过；多地域、内存及Free长期CPU容量尚未验证。生产main/资源未改，详见S2_E_CLOUDFLARE_PREVIEW_ACCEPTANCE.md。
