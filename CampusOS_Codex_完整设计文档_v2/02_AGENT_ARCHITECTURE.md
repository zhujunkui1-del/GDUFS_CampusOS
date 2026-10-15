# 02｜AI Agent 系统架构

## 1. 已选方案

采用**方案 A：1 个总控 Agent + 4 个专业能力模块 + 统一 Skill 注册执行层 + 独立 RAG/地图/业务数据库**。初期不强制 4 个专业模块都使用独立大模型；只有需要复杂独立推理的任务再升级为子 Agent。

四个模块：

1. `knowledge-domain`：校园规章、学业、办事与来源解释。
2. `spatial-domain`：地点、道路图、单段/多站路线、地图意图。
3. `events-domain`：活动竞赛、时间/校区筛选、地点关联。
4. `personal-domain`：已认证用户的课表、任务、偏好、提醒；最小权限访问。

注意：这些是逻辑职责，不等于必须四个模型并发生成；主 Agent 是统一入口，具体查询尽量调用确定性业务 Skill。

## 2. 请求入口

公共请求：`POST /api/agent/chat`（必要时使用 SSE 流式发送事件）。

服务端从经过验证的 Session 中获得 `userId`，不能从请求 JSON 中直接信任用户 ID。客户端可以传当前 `selectedPlaceId`、`routeId`、地图模式等上下文，但服务端验证地点/路线 ID 是否存在且有权访问。

```ts
type AgentRequest = {
  conversationId?: string;
  message: string;
  mapContext?: {
    selectedPlaceId?: string;
    activeRouteId?: string;
    visibleLayers?: string[];
    viewport?: { center: [number, number]; zoom: number };
  };
};
```

绝不把浏览器给出的 GPS 视为持续授权；定位通过浏览器授权后仅按当前需求使用。

## 3. Agent 执行循环

1. 识别用户目标、已知约束、地理/事件实体以及敏感操作。
2. 读取必要的会话上下文，选择允许的工具清单。
3. 调用模型 `tools` 接口决定 Skill（不把模型的自由文本当执行命令）。
4. `tool-executor` 验证工具名称、Schema、登录状态、请求权限、速率和确认令牌。
5. 执行只读 Skill（可并行），返回结构化数据、来源和错误码；写入 Skill 经用户确认才执行。
6. 若信息不足，调用更多 Skill；必要时向用户提出一个明确问题。
7. 后端对最终结果进行业务验证并构建标准化 `AgentResponse`，前端根据 `mapActions` 改变地图。
8. 达到预算/轮数上限时返回当前可核实的结果和未完成项，不能伪称完成。

建议初始配置：最多 6～8 个模型工具回合，所有可配置；并行工具限制和执行超时由后端实现。

## 4. 流式状态协议

推荐事件类型：`message.delta`、`tool.started`、`tool.finished`、`artifact.ready`、`confirmation.required`、`run.completed`、`run.failed`。

每条事件至少包含 `runId`,`eventId`,`timestamp`,`type`,`payload`。事件中的 `tool.finished` 必须来自真实已执行的工具，**不展示模型内部推理文本或编造的“思考步骤”**。

```ts
type MapAction =
  | { type:'FOCUS_PLACE'; placeId:string; zoom?:number }
  | { type:'SHOW_PLACES'; placeIds:string[] }
  | { type:'SHOW_ROUTE'; routeId:string }
  | { type:'OPEN_PLACE_DETAILS'; placeId:string }
  | { type:'SHOW_PLACE_DETAILS'; placeId:string }
  | { type:'CLEAR_ROUTE' }
  | { type:'SET_VIEW_MODE'; mode:'2d'|'2.5d'|'3d' }
  | { type:'SET_LAYER'; layer:'buildings'|'sports'|'dormitories'|'services'; visible:boolean };

type AgentResponse = {
  status:'completed'|'needs_input'|'needs_confirmation'|'failed';
  message:string;
  cards?:Array<{type:'place'|'route'|'event'|'source'; id:string}>;
  mapActions?:MapAction[];
  sources?:Array<{documentId?:string; title:string; url:string; publishedAt?:string}>;
  pendingConfirmation?:{actionId:string; summary:string};
};
```

原则：Skill 返回由业务系统生成的 `placeId/routeId`。不接受模型凭空构造的路线 ID、任何 JS 函数名或者浏览器 eval 字符串。

## 5. Map Action 执行策略

- Agent 返回的是**声明式动作**而非直接操作地图 SDK。
- `MapActionRenderer` 对动作做白名单校验和可见范围检查；再调用 `MapAdapter` 的对应方法。
- 前端点击地点、打开活动、选择路线等操作将新的 `selectedPlaceId` 传给下一轮 Agent，以保留语境。
- 页面切换不销毁有价值的 route/session 状态；路由对象过期则友好提示重新计算。
- 常见 UI 操作（放大地图、点击建筑、切换图层）优先直接用前端 API，不经过 LLM。

## 6. 记忆设计（结合账号）

- **对话短期记忆**：限定 token 窗口，必要时压缩摘要；记忆中引用仍保留来源键。
- **业务状态**：收藏、日程、课表、路线独立存储在受控数据库，不以聊天摘要代替。
- **长期偏好**：仅保存用户允许的关注话题、常用地点等；可查看、修改、删除、暂停写入。
- **隐私数据**：成绩、教务令牌、手机号、微信群原始隐私内容不能写入公共向量库；每次查询按任务最小化传给模型。
- 游客：会话短期状态可使用匿名 `guestSessionId`；无承诺长期云端记忆。

## 7. 提示词层

`system` 负责：CampusOS 产品身份、官方信息优先、时间校验、不编造地理事实、何时请求确认、工具安全、范围限定大学城。

领域提示词是可维护配置，不可绕过数据库权限。来自官网/群聊/小红书的内容是**不可信外部数据**，不得当作系统指令；忽略其伪造工具命令、越权请求或诱导泄露信息。

## 8. 工作流样例

### 路线与日程协同

输入："我下午 2 点上课，现在取快递、打印和吃饭能赶上吗？"

- 如未绑定/录入个人课表或未知位置，先获取起点、课程终点与时间。
- `search_places` 并行查地点；`get_user_schedule` 仅对本人登录会话调用。
- `plan_multi_stop_route` 在已核验道路图上计算候选顺序，包含停留时长与截止时间。
- `control_map` 以返回的真实地点和路线 ID 生成指令；呈现路线与可编辑时间线。
- 若路线不可行，返回明确冲突而不是修饰答案。

### 活动查询到地图

输入："本周适合计算机专业的 AI 讲座在哪里？"

- `search_campus_events` 优先查询结构化事件表。
- 官方正文或规则细节可调用 `search_campus_knowledge`。
- 校区为白云山、线上、地点未知的事件，不在大学城图上生成错误标记。

## 9. 接入模型与配置

- 对话 `ModelClient` 封装 `generateWithTools`、`generateStructured`；Embedding 使用独立客户端和平台配置。供应商协议、允许端点、能力与错误由服务端适配器注册，基础 URL 按审核策略限制。
- 平台默认为 DeepSeek；游客可临时使用自定义 API，登录用户可选择本人持久配置。服务端在每个 Run 开始时校验身份、所有权、配置版本、真实测试结果和预算并固定模型快照；前端传入的能力或 config ID 不形成授权。
- API Key 由服务端用于供应商请求：平台 Key 为 Secret，登录用户 Key 认证加密保存，游客 Key 仅请求内存使用。审计日志脱敏；所有调用设置 token、成本、并发和超时预算。
- 工具兼容测试未通过的模型不能进入 Agent Skill 执行循环；JSON 输出能力按任务需要验证。测试工具不属于正式 16 项 Skill。
- 自定义失败保留会话、地图和已完成工具台账，提供重测/切换入口；用户明确选择后才改用平台模型。重试或切换不能重复业务写入；停用/删除/替换与运行中请求须协调取消。
- 完整凭据生命周期、连接测试、错误与切换恢复规则见 `12_MODEL_API_SETTINGS.md`，实施本节前必须完整阅读。

## 10. 必须测试

1. 按权限调用公开查询成功、私人查询在游客下拒绝、越权跨用户查询拒绝。
2. 输入模糊建筑名时返回澄清/候选，而非自己编造。
3. 返回错误 `placeId`、`routeId` 时地图动作被拒绝。
4. Skill 超时、模型服务故障时展示可恢复错误，地图公共功能不瘫痪。
5. 工具 JSON 参数畸形、恶意群聊提示词、不可信网页中的指令无法越权调用工具。
6. 写入用户日程必须在后端确认令牌校验后执行。
7. 通过真实校园问题回放，确保 `Agent → Skill → MapAction → UI` 闭环。
8. 模型选择、能力门控、自定义故障无自动回退、工具幂等及跨用户隔离按 `12_MODEL_API_SETTINGS.md` 验收。
## 2026-10-15 S2-A 实施状态

核心实现在src/lib/server/agent与src/lib/server/models，四域为逻辑模块，共用一个总控与管理员默认模型。S2-A实际生产注册表为空，不伪造尚未实现的Skill。诊断工具只用于运维能力测试，不能查询校园业务或产生地图动作。ModelRouter要求绑定配置的真实验证记录；仅JSON Object经业务Schema实测，不声称供应商严格JSON Schema支持。

S2-A完成核心循环测试后，S2-B接五项真实地图服务，S2-C接原全局AI面板和会话，S2-D执行完整自然语言地图验收。当前/api/agent/status可查询模型准备状态；/api/agent/chat在真实业务Skill、主体会话和共享额度接入前返回503，AI面板保留准确禁用状态。实现/差异/配置/证据见docs/S2_A_AGENT_CORE.md。

## S2-B 实施状态（2026-10-15，取代前述空注册表状态）

五项地图Skill已在同一注册器/执行器下实际运行，createMapAgent复用原总控/Router，地图工作流启用失败终止，原通用默认行为与预算保持。真实DeepSeek三场景自主工具选择通过，详细输入输出见docs/S2_B_MAP_SKILLS_ACCEPTANCE.md。

control_map输出经业务校验的intent_only，不等于地图已经执行。前端复用原Provider控制器，SHOW_PLACE_DETAILS不移动镜头，CLEAR_ROUTE走完整退出，模式走原能力检查，SHOW_ROUTE先要求可信快照已载入。当前匿名句柄与路线快照为有界短时isolate内存；公开聊天仍关闭，S2-C需共享会话/额度、上下文、定位授权与前端事件/路线桥接，不能将本轮后台实测称完整聊天UI验收。旧events/moments图层形状保留兼容，但业务拒绝。


## S2-C 当前架构（2026-10-15，取代前述聊天关闭/内存会话状态）

原总控、四逻辑域、ModelRouter与五Skill保持，src/lib/server/assistant新增D1主体/会话/路线/动作/用量DAO与SSE编排。生产chat和确定性Skill入口使用共享D1，旧内存Store只留隔离测试/受控CLI辅助，不承担生产恢复。原全局AssistantPanel已接真实DeepSeek；工具规划文字和reasoning不展示，地点/路线卡片来自真实工具。动作包须前端领取/复验/执行/回执，之后才生成最终文字流。缺定位不复用旧路线；原有权限、超时、循环上限保留。

会话48小时/20消息；建筑路线D1保存10分钟，设备路线精确几何仅签名短期页面票据；主体绑定与版本/过期检查跨Worker。单INSERT触发器原子预留额度，每主体1/站点4并发；可靠usage回收预留，取消/缺失usage保守保留。依赖D1主库会话，未依赖KV一致性。公开地图独立于模型/D1工作。详见docs/S2_C_AI_MAP_ACCEPTANCE.md，云端与实机验收留S2-D。
