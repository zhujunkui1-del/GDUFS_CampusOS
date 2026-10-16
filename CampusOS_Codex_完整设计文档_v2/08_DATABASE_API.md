# 08｜数据库模型、API 边界与前后端协议

## 1. 总体架构

推荐初版：`Next.js 响应式 Web → Cloudflare 适配层/Workers API → 自研 Agent + Skills → D1/Vectorize/R2/外部模型/高德 SDK`。

可替换：部分后端或关系库迁移到腾讯云/PostgreSQL；不要把框架功能锁死在某个平台。选型要先核对实际 Next.js/Workers 适配器版本、运行时、文件上传大小与持久化限制。

### 边界

- 前端使用高德官方 JS SDK 显示底图、交互、地理信息；受限内部数据不可私自抓取重分发。
- 地理业务 `CampusMapService` 为自有 POI 和授权路径数据服务，受 `MapAdapter` 抽象保护。
- Agent 只通过后端 Skill 访问受控数据；写操作必须有用户授权、后端确认。
- 知识库 RAG、事件库、GIS 与个人数据分表分域，避免将结构化数据全塞向量库。

## 2. 初始逻辑数据表

| 表 | 核心字段 | 说明 |
|---|---|---|
| `users` | `id,status,display_name,created_at` | CampusOS 用户 |
| `auth_identities` | `user_id,phone_encrypted,password_hash?` | 手机号唯一、认证信息 |
| `login_sessions` | `session_hash,user_id,expires_at,revoked_at` | 会话控制 |
| `external_connections` | `user_id,provider,scopes,status,expires_at` | 校方授权状态（待接入） |
| `user_preferences` | `user_id,map_mode,interests_json` | 偏好 |
| `user_model_configs` | `id,user_id,provider,model_id,base_url,encrypted_api_key,key_version,version` | 待新增：登录用户模型配置/加密凭据，完整字段与约束见第 12 份文档 |
| `user_model_preferences` | `user_id,mode,active_config_id,version,updated_at` | 待新增：当前选择唯一，配置必须属于本人 |
| `user_memories` | `user_id,content,consent_at,deleted_at` | 可管理长期记忆 |
| `conversations` | `id,user_id?,guest_session_id?,status` | Agent 会话 |
| `conversation_messages` | `id,conversation_id,role,content,created_at` | 对话信息 |
| `agent_runs` | `id,conversation_id,status,tool_calls,cost` | 真实执行记录 |
| `user_tasks` | `id,user_id,title,starts_at,due_at,status,version` | 个人任务 |
| `user_schedules` | `id,user_id,title,start_at,end_at,place_id?` | 课表与个人日程 |
| `user_favorites` | `user_id,target_type,target_id` | 收藏 |
| `campus_zones` | `id,name,polygon,verified_at` | 教学/生活/连接区域 |
| `campus_places` | `id,name,aliases,category,zone_id,geom,status` | 自有地点 |
| `place_entrances` | `id,place_id,coord,path_node_id,verified_at` | 可导航入口 |
| `path_nodes` | `id,geom,level,verified_at` | 步行图节点 |
| `path_edges` | `id,from,to,length,level,accessible,verified` | 步行图边 |
| `route_snapshots` | `id,owner_session?,path_geojson,network_version,expires_at` | 可复用路线结果 |
| `place_media` | `id,place_id,source_id,license_status,approval` | 图/视频/全景 |
| `knowledge_sources` | `id,type,domain,policy,status` | 信息源配置 |
| `knowledge_documents` | `id,source_id,url,published_at,verified_at,status` | 文档元信息 |
| `knowledge_chunks` | `id,document_id,text,vector_key,offsets` | 语义切片 |
| `knowledge_facts` | `id,document_id,claim,status,valid_until` | 抽取事实 |
| `campus_events` | `id,title,starts_at,deadline,place_id?,status` | 活动 |
| `event_sources` | `event_id,document_id` | 多来源关联 |
| `ingestion_jobs` | `id,source_id,status,error,attempts` | 采集任务 |
| `content_reviews` | `id,target_type,target_id,decision,reviewer_id` | 审核记录 |
| `audit_events` | `id,actor_id,action,target_id,created_at` | 重要操作审计 |

P2 社交表另见 `10_CAMPUS_SOCIAL.md`。生产 DDL 应使用迁移工具和字段约束、索引、唯一性/外键；本表是逻辑设计而非可直接执行 SQL。

模型新增表以 `12_MODEL_API_SETTINGS.md` 第 9 节为完整依据，兼容现有账号、会话和业务数据；游客临时配置不写库。`is_active` 从本人选择派生，避免多处状态不一致。本次没有生成/执行迁移。

## 3. 数据隔离与权限

所有 `user_*` 表访问默认强制 `user_id = session.user.id`。管理者不能因为拥有知识审核权限而获准阅读普通学生成绩和私人聊天。手机号加密储存，鉴权能力必须在服务端。数据库视图或 DAO 应避免“忘写 WHERE”跨用户泄露。

`campus_places` 的 `status` 至少区分 `discovered / license_pending / geography_pending / approved / rejected`。`place_media` 单独保存素材审批与许可记录。只能用核验通过且允许用途匹配的数据进入公开服务。

## 4. API 目录建议

| Method | Endpoint | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/health` | 公开 | 健康/版本（不泄露密钥） |
| `POST` | `/api/auth/otp/request` | 公开+限流 | 请求验证码 |
| `POST` | `/api/auth/otp/verify` | 公开+限流 | 验证并登录/注册 |
| `POST` | `/api/auth/logout` | 已登录 | 撤销会话 |
| `GET` | `/api/me` | 已登录 | 本人概要 |
| `GET` | `/api/places` | 公开 | 按名称/类型/校区搜索 |
| `GET` | `/api/places/:id` | 公开 | 地点详情 |
| `POST` | `/api/routes/plan` | 公开 | 路线规划（服务端限流） |
| `POST` | `/api/routes/multi-stop` | 公开 | 多站时间路线 |
| `POST` | `/api/agent/chat` | 公开/登录 | 流式智能体对话 |
| `POST` | `/api/agent/actions/:id/confirm` | 本人 | 执行待确认动作 |
| `GET` | `/api/knowledge/search` | 公开 | 校园知识搜索 |
| `GET` | `/api/events` | 公开 | 校园雷达列表 |
| `GET` | `/api/events/:id` | 公开 | 活动详情与来源 |
| `GET/POST` | `/api/me/tasks` | 本人 | 任务查询与创建 |
| `PATCH/DELETE` | `/api/me/tasks/:id` | 本人 | 更新/删除 |
| `GET/POST` | `/api/me/favorites` | 本人 | 收藏 |
| `GET/POST` | `/api/me/schedules` | 本人 | 日程/课表 |
| `GET` | `/api/me/school-connections` | 本人 | 校方连接能力/状态，真实授权前不可假成功 |
| `POST` | `/api/admin/sources` | 管理员 | 信息源管理 |
| `POST` | `/api/admin/knowledge/import` | 管理员 | 经授权文档导入 |
| `POST` | `/api/admin/reviews/:id/decision` | 管理员 | 内容/素材审核 |

所有 API 返回受控错误结构；查询范围有分页上限、速率限制，日志脱敏。除公共查询外，高风险修改使用服务端确认与幂等控制。

### 模型设置接口扩展

新增公开供应商元数据、匿名/登录连接测试、本人模型配置 CRUD/测试及当前选择接口，扩展原 `/api/agent/chat` 的服务端模型选择。完整接口目录、请求敏感字段与响应白名单见 `12_MODEL_API_SETTINGS.md` 第 10 节。本人配置不返回明文/密文 Key；所有读取、测试、调用和修改均检查所有权。游客测试只在请求内存中使用 Key，匿名保存接口拒绝。

## 5. API 结果约定

```ts
type ApiResult<T> =
  | { ok:true; data:T; requestId:string }
  | { ok:false; error:{code:string;message:string;retryable?:boolean};requestId:string };
```

使用 UTC 标准时间存储日期，页面按 `Asia/Shanghai` 显示学校本地时间；报名截至日期必须保留原文准确语义（日期截止/具体时刻），不能默认补 23:59 当成真实通知。

地点地理坐标内部统一约定，地图 SDK 转换单独适配，严禁 WGS84/GCJ-02/BD-09 混合而不转换。

## 6. Agent 到 UI 的事件流

消息发起后，`AgentRun` 产生结构化事件：`tool.started/tool.finished/message.delta/artifact.ready/confirmation.required/run.completed/run.failed`。`artifact.ready` 可以包含 `placeCard/routeCard/eventCard/mapActions`。

前端按 `MapAction` 白名单执行 `FOCUS_PLACE`,`SHOW_PLACES`,`SHOW_ROUTE`,`SET_LAYER`,`OPEN_PLACE_DETAILS`。执行器在 UI 使用这些 ID 前再次检查；不能注入任意 JS。

## 7. 地图与 RAG 数据关系

- `campus_events.place_id` 必须指向 `campus_places` 中已核验且属于大学城的地点，或者为空。
- `knowledge_documents` 可以广外全校；但其 `campus_scope` 与地图联动必须严格筛选。
- 自有步行 `path_edges` 与路线快照维护 `network_version`，图数据更新时旧路线可被标记需要重算。
- 外部社交内容不会直接写入官方 `knowledge_facts`，只有审核合格的独立信息可以作为明确“非官方经验”。

## 8. 部署与密钥

- 配置 `.env.example` / Cloudflare secrets，不提交真实 key、短信密钥、OAuth client secret。
- 地图前端发布型密钥按平台要求配域名/安全参数白名单；服务端密钥仅在后端。
- 数据库迁移、备份、审计/错误监控、生产/预览环境分离；不得把试验用手机号或测试地点公开到生产。
- 模型凭据按 `12_MODEL_API_SETTINGS.md` 处理：HTTPS、登录持久 Key 的 AES-256-GCM/Cloudflare Secret、游客内存临时 Key、日志/缓存脱敏和供应商出站白名单；当前 HTTP 本地预览仅用 Mock 凭据。`anykey.md` 不作为可提交/公开资源。

## 9. 模块边界单元测试

重点验证：匿名 API 不返回个人数据；错误校区不出地图；过期活动筛选正确；无真实路径不返回成功；关联删除不会留下悬空事件；地图素材待审核不会进入公开响应；Agent 对话异常不会破坏地图使用；手机号找回/账号撤销会话状态一致。

模型配置、凭据加密、SSRF、并发切换、故障恢复及游客临时模式追加验收见 `12_MODEL_API_SETTINGS.md` 第 12 节，均为待实施测试要求。
## 2026-10-15 当前架构修订

早期高德默认底图描述已由D-018取代，当前为固定MapLibre/本地OSM及真实本地步行路网。S2-A复用Next.js/OpenNext/Workers，新增/api/agent/status与严格验证但暂不启用的/api/agent/chat。实际D1已有30个空业务表，地点服务来自固定JSON；没有为了Agent复制或假填数据库。

S2-A暂不迁移账号/BYOK表。现有user_preferences.map_mode仍只允许2d/2.5d且默认2.5d；未被当前地图使用，未来账号偏好接入需兼容当前默认2D/三模式。会话、消息、运行表存在但尚未接DAO；工具迭代上下文只在单次Run内存。跨请求指代记忆、路线快照所有权与共享使用额度在S2-B/C接入前必须验收。

S2-B新增POST /api/map/skills/{name}确定性公开工具接口，正文{input,selectedPlaceId?}严格校验，身份/GPS参数拒绝。匿名主体为服务端随机句柄，路线快照有会话所有权/版本/10分钟有效期；目前都在isolate有界内存，不写D1、不保证跨实例连续。S2-C启用公开付费聊天前补共享DAO/额度与授权定位传递；详细Schema/HTTP实例见docs/S2_B_MAP_SKILLS_ACCEPTANCE.md。现有D1未迁移/造数据。


## S2-C 数据与API现状（2026-10-15，覆盖前述空表/内存状态）

0004_assistant_shared_state.sql复用conversations/conversation_messages/agent_runs，新增assistant_sessions/assistant_route_refs/assistant_actions/assistant_location_challenges，34表，无虚构种子。D1按主库会话访问；额度/租约在一个INSERT trigger中原子检查，批次事务取消/清理，非单isolate额度。会话/历史/动作/路线均绑定可信Cookie主体；登录仅从真实login_sessions验证，不信任userId。账号UI/SMS仍未接入。

新增GET /api/agent/session、/conversations/:id；POST /chat（SSE）、/cancel、/location/challenge、/routes/:id、/actions/:id/claim与/receipt；/api/map/skills/:name改共用D1身份/路线。设备路线payload不落库，完整性保护短期票据只在页面内存/POST传输；建筑路线可跨运行时恢复。会话48h/20消息、路线10min/版本绑定、动作5min单次领取，存储容量/额度/清理与全部接口见docs/S2_C_AI_MAP_ACCEPTANCE.md。没有新增学校数据或私人业务Skill。

### S2-D验证与计时（2026-10-15）

无新增表/迁移，34表空库约束与双workerd共享D1模拟服务并发/跨主体拒绝/重启恢复通过；不是云端多地域。request级数据库包装保留first-primary/batch语义，只统计调用/读写语句数量和await时长，不记录SQL/参数。部分私有API返回数值Server-Timing；chat指标为结束前快照，不包含后续finish写入或独立动作HTTP请求。精确GPS/票据仍不落日志，额度不因本地测试被重置。

Cloudflare账号已认证但无专用D1，preview/production UUID仍全零；生产迁移与公开发布未获本轮批准，保持不执行。实际云端额度/延迟/CPU与Free子请求预算须隔离预览实测，见docs/S2_D_AGENT_ACCEPTANCE.md。

### 2026-10-16 定位challenge时间校准

POST /api/agent/location/challenge除challenge/expiresInSeconds外返回服务端serverTime；客户端基于它与单调耗时/样本年龄计算原locationGrant.capturedAt。请求Schema、D1表和30秒单次nonce协议不变，不信任模型定位授权声明，不增加精确位置持久化。原服务端未来时间、所有权、过期、精度和范围校验保留。详见docs/S2_E_BROWSER_FIXES.md。

## 0005多会话数据与API（2026-10-16）

35业务表：conversations新增title/deleted_at_ms，assistant_conversation_routes维护会话-路线引用。新增GET /api/agent/conversations游标列表及DELETE /api/agent/conversations/:id；原历史、身份、SSE和路线端点复用并加强会话绑定，全部鉴权、Origin与no-store。元数据复用原边缘限流，不能替代D1全局Agent额度。

内容实际SQL DELETE，父对话无内容删除标记与去内容Run台账保留48h，避免旧级联外键删除配额；共享路线仅删除当前引用，独占路线一起删除。Run预留/消息追加/动作校验拒绝已删除父会话。事务失败全回滚，重复删除安全。每主体50有效/100总记录，全站5000有效/10000总记录、每页20；历史20条/48h和原模型额度不变。旧客户端响应形状兼容，迁移不重建或清空任何表，细节/云端证据见docs/AI_CONVERSATION_MANAGEMENT_ACCEPTANCE.md。
