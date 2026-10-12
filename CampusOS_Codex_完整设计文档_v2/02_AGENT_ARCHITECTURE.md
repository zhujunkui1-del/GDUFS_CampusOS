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
  | { type:'SET_LAYER'; layer:'buildings'|'events'|'services'|'moments'; visible:boolean };

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

- 封装 `ModelClient`：`generateWithTools`、`generateStructured`、`embed` 等按供应商分离；支持设置基础 URL、模型名称、限额、重试、超时。
- 提交前实测所选择模型是否支持真正的 tool calling/JSON Schema，不能由 Codex 仅靠推测配置。
- API Key 只在服务器变量；审计日志脱敏；所有 AI 调用设置 token、成本和并发预算。

## 10. 必须测试

1. 按权限调用公开查询成功、私人查询在游客下拒绝、越权跨用户查询拒绝。
2. 输入模糊建筑名时返回澄清/候选，而非自己编造。
3. 返回错误 `placeId`、`routeId` 时地图动作被拒绝。
4. Skill 超时、模型服务故障时展示可恢复错误，地图公共功能不瘫痪。
5. 工具 JSON 参数畸形、恶意群聊提示词、不可信网页中的指令无法越权调用工具。
6. 写入用户日程必须在后端确认令牌校验后执行。
7. 通过真实校园问题回放，确保 `Agent → Skill → MapAction → UI` 闭环。
