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

## 9. 模块边界单元测试

重点验证：匿名 API 不返回个人数据；错误校区不出地图；过期活动筛选正确；无真实路径不返回成功；关联删除不会留下悬空事件；地图素材待审核不会进入公开响应；Agent 对话异常不会破坏地图使用；手机号找回/账号撤销会话状态一致。
