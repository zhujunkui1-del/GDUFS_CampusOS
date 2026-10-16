# AI 多会话管理验收

日期：2026-10-16；基线提交 `c6a90cb`。范围仅为新对话、历史列表/切换和删除；沿用原Agent、五项Skill、D1及AI面板，无建筑建模、地图算法或供应商变更。

## 1. 审计与存储设计

原游客Cookie是48小时HttpOnly/SameSite=Strict、HTTPS Secure的随机主体，D1只保存哈希；登录身份仍通过真实login_sessions/users验证。会话按owner_key隔离，客户端userId不能建立权限。

原conversations关联messages、agent_runs和assistant_actions，后两者有级联外键；agent_runs同时承担站点/主体/IP/Token配额。故不能直接DELETE父对话再丢掉配额。原路线索引仅按owner绑定，新增assistant_conversation_routes关联会话，地图显示状态与会话语义分离。

0005是兼容性迁移：新增title、deleted_at_ms、列表索引及路线关联表，回填已有标题/关联，更新容量触发器并增加“已删除会话不能预留Run”的原子检查。无表重建或历史清空；新关联表的级联仅删除附属关联行，原父表外键未扩大。

标题来自首条用户消息，最多48个Unicode字符，无额外模型调用。旧记录以现存最早用户消息回填，无法恢复此前20条保留上限之外的消息。历史继续最多20条/会话、48小时续期；每主体最多50个有效对话、100个含短期删除标记的记录，全站5000有效/10000总记录。模型请求、Token、并发和IP额度全部保持原值。列表每页最多20个标题/更新时间，不预读整段消息，按更新时间/ID倒序游标翻页。

## 2. 新建、切换与地图上下文

- 新对话立即中止当前fetch/卡片请求、撤销服务端待执行动作、清空AI消息与语义上下文；不创建空D1记录，首条消息才懒创建独立UUID。
- 原对话仍留在历史。新会话不带旧conversationId、路线ID、票据、已确认地点或工具结果；主体Cookie保持。首次初始化/刷新恢复最近有消息的有效会话，在当前页面点击“新对话”后，窗口focus或跨页面不会又载入旧会话。
- 历史切换先清显示并取消请求，再从D1读取所选会话；不自动执行旧卡片动作。旧路线需用户主动点击并重新检查所有权、会话关联、10分钟有效期及地图/路网版本。设备精确路线仍不写D1，切换/刷新失去短期页面票据后须重新定位。
- 所有SSE、历史加载、卡片请求和定位回调检查请求代次/AbortSignal；迟到结果不能写入新窗口或操作地图。取消HTTP有5秒期限，其他元数据HTTP有15秒期限，不自动重试付费模型。
- MapProvider只补了用户主动选点版本；AI程序聚焦不会伪装成新用户选点。“这里”使用当前会话已验证上下文，或新一次明确地图选点。
- 新建/切换/删除对话保留地图显示、模式及独立手动路线/导航；旧AI路线可留作地图显示，但不进入新会话语义。清路线仍由原工具栏/卡片操作。身份真正切换时沿用原规则清理旧身份的受保护AI路线。

## 3. 删除语义与失败恢复

“删除这段对话？”确认弹窗使用现有Base UI AlertDialog：默认焦点为取消，包含原文说明及危险按钮；成功后再移除列表项。D1失败或网络中断显示“删除失败，请重试。”，保留内容及重试入口。

同一[D1 batch事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)执行：标记本人对话删除、清空标题/地点/路线上下文；停止Run租约并去掉usage/tool内容；物理DELETE消息、待执行/已领取动作及独占路线/关联。仍被其他对话引用的旧路线保留。删除父记录本身采用短期无内容标记，防止配额外键级联；仅保留数值配额、请求幂等与必要审计字段，既有清理在48小时后回收。重复删除本人未过期标记返回成功，不续期或重置额度；未知/越权/过期ID均拒绝。

删除当前会话会立即取消请求，确认服务端成功后进入空白；删除其他会话不停止当前聊天。删除后的Run预留、消息追加、动作生成/领取及路线票据恢复均不能复活记录。事务失败时标记/Run/消息/动作/路线一起回滚，本地注入失败已验证。

## 4. API与客户端兼容

| API | 行为 |
|---|---|
| GET /api/agent/conversations?cursor=&limit= | 本人分页元数据 |
| GET /api/agent/conversations/:id | 本人真实有界历史 |
| DELETE /api/agent/conversations/:id | 参数化、原子、幂等删除 |
| GET /api/agent/session | 保留可信身份/模型状态及最近有效历史恢复 |
| 原routes/:id、actions/:id/claim | 新客户端传conversationId并验证绑定 |

所有接口复用assistantContext、Origin/Sec-Fetch-Site保护、可信Cookie及no-store响应。元数据操作复用现有Cloudflare限流Binding，分页和存储有硬上限；模型共享配额仍是D1原子台账。边缘限流不是严格的跨地域全局计数，不以它代替原Agent额度。

旧浏览器使用严格响应Schema，新客户端以X-CampusOS-Conversation-Protocol:1请求标题扩展；未刷新客户端仍获得旧历史形状。claim只在新请求提供conversationId时返回对应扩展字段。新API经过原preview薄入口转交同一鉴权函数，无备用未鉴权实现。

## 5. 本地验证

- TypeScript/Lint/单元与安全生产构建通过，最终项数见文末。覆盖独立ID/上下文、标题/分页、登录/游客隔离、越权/重复删除、运行中删除、晚写/动作、配额保留、其他路线、失败回滚和Unicode。
- SQLite空库35张表；含0004历史的升级夹具验证消息、Run、路线payload均保留，外键0错误。
- 两个实际workerd共享受管D1模拟服务：跨实例删除/恢复拒绝、运行终止、配额保留、其他对话路线及重启后状态通过；不是云端多地域证据。
- 初轮本地Chrome/Edge桌面及手机视口各14项专项通过，最终扩充到每浏览器18项并在公网重跑。Mock的模型流/故障与真实D1测试分开，含迟到文字/动作/GPS、失败重试、刷新、焦点和地图路线保留。
- Workers本地预览真实session/list返回200，Edge额外4项管理UI通过。原9spec在Workers预览下Chrome/Edge各61通过、3既有条件跳过；覆盖五Skill、导航/抽屉、取消、模型/数据库/断线隔离和3D。

中间失败记录：Windows开发服务占用.open-next导致一次构建EPERM，关闭本任务服务后标准构建通过；路线保留测试曾误把屏幕像素包络当地理几何，调整为实际路线、起终点与模式断言。手机既有导航界面隐藏AI入口，保留测试通过宽布局打开后切手机视口验证，两种布局策略未改动。失败不算通过，原始记录在忽略的test-results目录。

## 6. Cloudflare预览

只更新campusos-preview Worker和同名D1，UUID仍为原配置；无生产/DNS/Secret修改、数据库重建或付费升级。迁移前只读认证/目标核对后，仅0005待执行；远程12命令8.90ms通过。

迁移前后45段对话、228条消息、116条Run、4条路线数量一致，新增4条关联，外键0错误。证据在verification/conversations/preview-before.json及preview-after.json。后续真实测试只删除其自有测试对话，既有到期清理仍按原政策运行。

入口：https://campusos-preview.zhujunkui1.workers.dev/map 。实际发布版本及真实模型/云端检查结果在文末补充，未用Mock代替真实服务验收。

## 7. 限制与更新/回滚

真实手机GPS/中文输入法/硬件触控尚未实机验收；桌面手机视口不能替代。学生账号/SMS登录UI仍未开发，登录所有权由真实格式的隔离数据库夹具验证，未宣称学生真实登录浏览器验收。

沿用既有Free CPU容量、多地域、模型24小时能力记录及开发依赖门槛；不因新功能完成宣称S2全面生产达标。模型测试守原站点额度及批准1元现有余额，Mock和D1测试不调用模型；实际余额差包含可能的同期其他使用，不当项目独立账单。

更新继续用npm run deploy:preview安全流程，迁移0005仅一次；应用回滚和数据库回滚分开。0005不回滚删除数据，旧响应兼容形状可支撑旧客户端；若回退旧服务端版本，其缺少删除感知，不能当成安全回滚方案，应保留本轮鉴权/删除保护再发布。不要清库、删表或恢复已删除对话来掩盖失败。

### 云端验证期间发现并修复

- 空DELETE正文在Workers中可能是非空body对象中的空流，原必填JSON解析返回400，UI正确保留失败状态，未误报删除。新增有界可选正文解析：空流/无body可删除，非空正文仍严格只允许空对象，1KiB/5秒上限；普通必填JSON规则保持。红测试复现Unexpected end of JSON input后修复，真实云端删除重测通过。
- “新对话”清语义后，仍需记住地图显示的身份归属以防随后切账号。新增只包含routeId/scopeKey的显示归属标记，不是可传给Agent的能力或上下文；同身份新建保留显示，身份改变清理原身份AI路线。红/绿Mock身份测试覆盖桌面及手机，独立手动路线保持。
- 窗口focus时临时历史读取故障与404必须分开。临时503保留当前内容及错误，恢复后继续；只有已删除/过期404重置。避免一次短暂D1故障被误表现为空白新对话。

这些修复没有放宽权限、配额或路线版本/有效期验证。真实模型与Mock故障记录分开；失败产生的隔离游客测试记录按原48小时清理策略处理，没有清库掩盖失败。

## 本轮最终验收结果

最新预览Worker：f98aadf8-8581-49ca-befb-d9c13d38f90e；入口不变。最终安全包14866.37KiB/gzip2420.46KiB，平台部署启动验证99ms（不是每次用户冷启动）。凭据净化、最终入口及客户端扫描通过，原OSM/路网/南苑7栋哈希不变。

| 检查 | 最终结果 |
|---|---|
| TypeScript / Lint / 单元 | 通过；231项/30文件 |
| 本地D1空库/有历史升级 | 35表、消息/配额/路线payload保留、外键0错误 |
| 两workerd共享D1 | 共享删除、其他路线/配额保留及重启恢复通过，不当多地域云端 |
| Workers本地预览 | session/list 200；空DELETE及空对象到达所有权检查404，未知字段400 |
| 原地图/Agent/3D回归 | Chrome/Edge各61通过/3既有跳过，桌面及手机视口 |
| 最终公网Mock专项 | Chrome/Edge各18通过，含新建/切换/删除/失败/GPS晚回调/身份切换/临时故障 |
| 最终真实DeepSeek + 公网D1 | Chrome/Edge各桌面/手机2项，共4通过、12轮真实对话 |
| 删除后云端实际记录 | 8段对话消息/动作/路线关联为0；12条配额Run及charged_tokens保留 |

真实矩阵36次已知上游请求、44362 Token、0纠正重试；地点/路线卡片来自实际Skill，12轮均等待地图回执，刷新后旧动作不自动执行，主动显示会重新验证路线。跨游客删除404、伪造userId正文400、重复删除200、删除后的路线404均真实测试。统计/事件/实际PNG见verification/conversations/summary.json、cloud-live及preview-deletion-audit.json，Mock截图单列cloud-mock，绝非生成图片。

原1元既有余额授权累计变化0.26元、剩余约0.74元，可能包含同期其他使用且不是本轮独立账单；没有充值或新增收费资源。原失败/中间调试保留在忽略的test-results，成功矩阵重新执行，不清库掩盖问题。

复现：npm test；npm run typecheck；npm run lint；npm run db:verify；ASSISTANT_STATE_CAPTURE_DIR指向隔离目录后npm run test:assistant:state；显式E2E_BASE_URL/PLAYWRIGHT_CHANNEL运行conversation-management.spec.ts；真实模型另须E2E_LIVE_AGENT=1及预算检查后运行conversation-management-live.spec.ts。部署继续npm run deploy:preview，不能绕过安全构建。

实际截图：[桌面历史](verification/conversations/cloud-live/chrome-desktop-real-history.png)、[手机历史](verification/conversations/cloud-live/msedge-mobile-real-history.png)、[手机删除确认](verification/conversations/cloud-live/msedge-mobile-real-delete-confirm.png)、[删除后的空白会话](verification/conversations/cloud-live/chrome-desktop-real-deleted-blank.png)。

本轮功能具备隔离预览使用条件；真实手机输入法/触摸、真实学生登录UI及既有Free CPU/多地域等正式发布门槛仍未验收。生产/DNS/新付费与建筑批量均未启动。
