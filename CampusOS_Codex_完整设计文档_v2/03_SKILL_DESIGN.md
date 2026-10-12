# 03｜Skill 技能系统规格（16 项）

## 1. 技术原则

Skill 是**真实运行的能力模块**，具有明确功能边界、JSON Schema 输入输出、独立权限、错误处理、版本号、单元测试。Skill 可由 Agent 通过 Tool Calling 选择，也可由普通 UI/HTTP 直接调用。**Skill 不等于提示词、不等于无实现的 JSON 展示数据。**

调用链：`Agent → Tool Registry → Validate Input → AuthZ → Confirmation if write → Execute → Validate Output → Provenance → Agent/Frontend`。

## 2. Skill 目录

| 编号 | Skill | 分组 | 权限 | 副作用 | 阶段 |
|---|---|---|---|---|---|
| 01 | `search_places` | 地图 | 公开 | 无 | P0 |
| 02 | `get_place_details` | 地图 | 公开 | 无 | P0 |
| 03 | `find_nearby_places` | 地图 | 公开，位置需授权 | 无 | P0 |
| 04 | `plan_route` | 导航 | 公开 | 无 | P0 |
| 05 | `plan_multi_stop_route` | 导航 | 公开/可含本人计划 | 无 | P0→P1 |
| 06 | `control_map` | 地图协议 | 公开 | 仅客户端显示 | P0 |
| 07 | `search_campus_knowledge` | RAG | 公开/本人私库限制 | 无 | P0 |
| 08 | `search_campus_events` | 事件 | 公开 | 无 | P0 |
| 09 | `get_event_details` | 事件 | 公开 | 无 | P0 |
| 10 | `find_official_service` | 校园办事 | 公开 | 无 | P0 |
| 11 | `get_user_schedule` | 个人 | 登录本人 | 无 | P1 |
| 12 | `manage_user_tasks` | 个人 | 登录本人 | **写入需确认** | P1 |
| 13 | `manage_favorites` | 个人 | 登录本人 | 有，收藏可直观确认 | P1 |
| 14 | `get_account_context` | 个人 | 登录本人 | 无，最小字段 | P1 |
| 15 | `sync_academic_data` | 学校接口 | 正式 SSO 授权+本人 | 外部读取/同步 | P2 |
| 16 | `get_place_media` | 实景 | 公开，仅许可媒体 | 无 | P1 |

## 3. 统一 Skill 合约

```ts
type SkillResult<T> =
  | { ok:true; data:T; sources?:Array<{title:string;url:string;publishedAt?:string}>; warnings?:string[] }
  | { ok:false; error:{code:string;message:string;retryable:boolean} };

type SkillContext = {
  requestId:string;
  sessionId:string;
  user:{id:string;role:'user'|'admin'}|null;
  campusId:'gdufs_university_town';
  permissions:string[];
  confirmedActionId?:string; // 服务端签发并验证，不能信模型文本
};

type SkillDefinition<I,O> = {
  name:string;
  version:string;
  description:string;
  inputSchema:unknown;
  outputSchema:unknown;
  auth:'public'|'user'|'school_authorized'|'admin';
  sideEffect:'none'|'user_data_write'|'external_sync';
  requiresConfirmation:boolean;
  timeoutMs:number;
  execute:(input:I,ctx:SkillContext)=>Promise<SkillResult<O>>;
};
```

错误码建议：`INVALID_ARGUMENT`, `NOT_FOUND`, `AMBIGUOUS_PLACE`, `OUT_OF_CAMPUS`, `ROUTE_UNAVAILABLE`, `INSUFFICIENT_DATA`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFIRMATION_REQUIRED`, `UPSTREAM_ERROR`, `RATE_LIMITED`, `TIMEOUT`。

## 4. 各技能输入输出约定

### 01 `search_places`
- 输入：`{query:string; category?:string; limit?:number}`。
- 输出：`{matches:[{placeId,name,aliases?,category,zone,location,verificationStatus}],ambiguous:boolean}`。
- 验证：地点均来自确认过的 DB/获许可地图服务；不能猜测宿舍楼栋编号。

### 02 `get_place_details`
- 输入：`{placeId:string}`。
- 输出：建筑描述、入口、服务、来源、资料更新日期、已审核媒体；缺项省略。

### 03 `find_nearby_places`
- 输入：`{originPlaceId?:string;location?:{lng:number;lat:number};category?:string;radiusMeters?:number}`。
- 输出：经核实地点及几何距离；如果需要真实步行距离，再调用 `plan_route`。用户位置必须有当次授权；不能在未授权时偷偷定位。

### 04 `plan_route`
- 输入：`{startPlaceId:string;endPlaceId:string;mode:'walking';preferences?:{accessible?:boolean}}`。
- 输出：`{routeId,distanceMeters,estimatedMinutes,path:{type:'LineString',coordinates:[number,number][]},segments:[...],networkVersion}`。
- 必须走经过核验的步行道路图；隧道作为标注 `underground` 的连接边；无障碍选项只有在可用数据充分时启用。

### 05 `plan_multi_stop_route`
- 输入：`{startPlaceId;stops:[{placeId,durationMinutes?,earliestAt?,latestAt?}];finalPlaceId?;arriveBefore?;departureAt?}`。
- 输出：多个候选路线、顺序、各段距离/时间、冲突解释、可修改任务 ID；使用确定性算法，LLM 只提取约束/总结结果。

### 06 `control_map`
- 输入：`{actions:MapAction[]}`；`MapAction` 定义见 `02_AGENT_ARCHITECTURE.md`。
- 输出：`{acceptedActions:MapAction[];rejectedActions:[{action,reason}]}`；校验地点 ID、路线 ID 与安全图层名，绝不执行任意 JS。

### 07 `search_campus_knowledge`
- 输入：`{query;sourceTypes?;timeRange?;academicYear?;campusScope?;limit?}`。
- 输出：排序后的证据片段、文档与段落 ID、发布时间、适用状态、原文链接、非官方来源说明。不能把回答正文当成原始事实。

### 08 `search_campus_events`
- 输入：`{query?;category?;startsAfter?;endsBefore?;campusScope?;targetAudience?}`。
- 输出：结构化活动列表含发生时间、地点关联、报名截止、出处和校验状态。不得把校外/白云山地点自动映射大学城。

### 09 `get_event_details`
- 输入：`{eventId}`。
- 输出：活动详情、主办方、报名方式、适用对象、多个来源与版本、是否已经结束。

### 10 `find_official_service`
- 输入：`{topic;department?;campusScope?}`。
- 输出：官方办理渠道链接、办公地点 `placeId?`、适用事项和最近核验日期；无校方信息时不编造电话或流程。

### 11 `get_user_schedule`
- 输入：`{dateFrom;dateTo;includeClasses?:boolean}`。
- 输出：当前**服务端认证用户**自身的课程/任务（字段最小化）；禁止传入 arbitrary userId 查询别人。

### 12 `manage_user_tasks`
- 输入：`{operation:'create'|'update'|'complete'|'delete';taskId?;payload?;expectedVersion?}`。
- 输出：变更后任务 ID、状态、版本。写入之前必须确认实际影响；处理重试时使用 idempotency key。

### 13 `manage_favorites`
- 输入：`{operation:'add'|'remove'|'list';targetType:'place'|'event'|'document';targetId?}`。
- 输出：当前本人收藏状态及有限列表。收藏是低风险操作，UI 一键触发即可；来自 Agent 的批量修改仍应有可撤销交互。

### 14 `get_account_context`
- 输入：`{fields:['displayName'|'preferredZone'|'interests'|'favoritePlaceIds'|'schoolConnectionStatus',...]}`。
- 输出：明确白名单字段；**不可返回完整手机号、密码哈希、学校授权令牌、模型 API Key/密文或原始成绩**。

### 15 `sync_academic_data`
- 输入：`{scopes:['timetable'|'exam_schedule'|'grades',...];mode:'manual'|'scheduled'}`。
- 输出：已授权范围内的同步状态、实际导入数、数据版本；前提必须具备校方正式 API/协议与用户授权。未具备时返回 `UNSUPPORTED_INTEGRATION`，绝不伪造。

### 16 `get_place_media`
- 输入：`{placeId;kind?:'photo'|'floorplan'|'panorama'}`。
- 输出：仅返回允许展示/嵌入的合法 URL、来源、许可类型、审核时间及替代文本。全景无法嵌入则返回原站跳转。

## 5. Skill 注册与运行约束

- 使用 Zod/JSON Schema 完成入参/出参验证；对结果体大小和工具并发设限。
- 每个 Skill 自带单元测试和固定错误行为。输入地点必须在 `places` 数据表中存在；路线必须有非空坐标路径。
- 所有本人数据工具在执行层检查有效 session；权限不可只放在系统提示词中。
- 账号注册/手机号找回、模型配置与密钥管理走独立固定 API，不暴露成可以让 Agent 自主修改的 Skill。
- `sync_academic_data` 无校方接口时不属于 P0/P1 完成项，保持明确错误响应。
- 地图绘制和 UI 点击通常直接操作前端，无须每一步都消耗模型调用。
- 模型设置不扩充 16 项目录；连接诊断工具只用于隔离测试。不同模型调用同一注册器、Schema、权限及确认流程；工具不兼容时阻止执行，故障重试按业务动作幂等键核对已有结果。完整要求见 `12_MODEL_API_SETTINGS.md`。

## 6. 复用与比赛展示

Skill 应同时支持 (1) Agent 调用，(2) 内部 API 调用，(3) 开发测试调用；必要时可将部分 Skill 包装成独立 HTTP 服务或 MCP 工具，但包装本身不是核心交付标准。关键是从用户请求到实际返回数据形成完整闭环，并有日志证据。

## 7. 自动化测试清单

- 非法输入、空列表、模糊地点、跨校区、无路、路线超时。
- 登录/游客/管理员/学校授权不同权限；跨用户私人数据越权。
- 日程写入确认和幂等；网络重试不会重复创建任务。
- 社交地点 `moments` 图层即使未实现也不会造成地图错误。
- `get_place_media` 不返回未审核素材和无许可的第三方图片。
- 行程的距离/时间来自算法，不允许由模型返回任意未经验证数字。
