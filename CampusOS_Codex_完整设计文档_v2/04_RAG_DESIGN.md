# 04｜校园信息 RAG 与多源知识引擎

## 1. 已确认策略：方案 B

**来源明确且通过校验的官方文章可自动建立索引；由模型提取的活动日期、举办地点、报名截止日期等关键结构化信息，未完成规则/人工核验时不公开为地图事件；微信群、小红书及第三方地图素材需人工审核。**

知识来源范围可以是广外全校政策公告；地图可定位地点仅限大学城教学区和生活区。非官方信息只用于生活经验或线索，并保留可打开的原文链接以供用户核实。

## 2. 内容与数据分离

| 类型 | 储存 | 检索方式 |
|---|---|---|
| 规章制度、官网公告、办事指南 | 文档原文 + chunk + 向量 | hybrid RAG |
| 讲座、竞赛、活动、报名截止 | `campus_events` 结构化表 + 来源表 | 时间/类型/校区 SQL 检索 |
| 教学区与生活区建筑、道路、出入口 | `campus_places`、`path_nodes`、`path_edges` | 地理/图算法 Skill |
| 个人课表/成绩/偏好 | 受权限保护的个人业务数据表 | 登录授权的个人 Skill |
| 社交帖子 | 社交独立数据域 | 不自动进入官方知识库 |

## 3. 数据源治理

`knowledge_sources`: `sourceId`, `displayName`, `sourceType`（official_web/official_account/group_import/social_link/manual）, `allowedDomains`, `entryUrls`, `parserProfile`, `fetchPolicy`, `enabled`, `authorizationStatus`, `lastCheckedAt`。

- A 官方站点：广外学校官网、学院/职能部门官网、正式办事通知。适用于制度性结论。
- B 官方公众号与经许可群公告：补充近期活动/通知；公众号不保证存在任意文章历史读取 API。
- C 社交经验：小红书、校园墙、学生问答；**不能替代校方规定**，保留原始链接与可能过期提示。
- D 私有用户上传资料：只能被本人通过授权上下文访问；不参与公共 RAG 搜索。

初始白名单从学校相关可信域名开始，如 `gdufs.edu.cn` 及经确认的学院子域名；非校方域名需要额外配置和审核，不要把子域名后缀形式模糊匹配成钓鱼站。

## 4. Source Connector 工作流

`source config → scheduled check → fetch respecting policies → parse main content/attachments → canonicalize → dedup/version → classify → entity extraction → validation → review/auto index → vector+keyword → events`。

### 官方网页 Connector

- 可配置列表页入口、翻页方式、正文 CSS/DOM 规则、站点独立增量标识、请求上限、有效域名、超时与重试策略。
- 根据内容 ETag、Last-Modified、规范 URL、标题和 SHA-256 检测变化；站点不提供这些元信息时用内容哈希。
- 尊重 robots、使用条款与站点压力；不绕过验证码、登录和访问控制。
- 正文、发布日期、附件、发布机构、原文 URL 必须同时采集并保存；无法确认的字段不编造。
- 若一个官网发布了新旧两篇相互替代的通知，通过 `supersededByDocumentId` 建关联，而不是默默覆盖旧文。

建议官方通知每 3～6 小时检查一次；规章指南每周或按需检查，实际频率按站点政策调整。`fetched_at` 是检查时间，绝不冒充发布日期。

### 公众号 Connector

支持管理员提交原文链接/获得授权的文章导出；若官方公开合法 API 可用，再加自动连接器。记录文章正文可提取性、原文地址、公众号名称与发布时间；无法读取则仅保留链接及标题，不伪造全文。

### 群聊导入与知识蒸馏

文件由项目负责人主动导入、确保具有适当授权并经过隐私审查。支持 CSV/JSON/TXT（其他格式经验证适配）。四阶段：

1. **预处理**：识别消息时间、群来源、内容；脱敏手机号、学号、个人身份、非必要附件；仅限有权使用的数据。
2. **分类**：官方通知、常见问答、生活经验、待核验地点线索、闲聊、个人敏感内容；丢弃无关和敏感原文。
3. **蒸馏**：生成可追溯 FAQ、活动线索、地点候选；保留私密来源引用 ID，不把单一用户的猜测改写成官方结论。
4. **审核**：管理端审核，校方政策类必须交叉查找官方依据；审核通过后进入对应逻辑知识库。

原始聊天内容默认不被公共检索且不用于模型训练；公开可见条目只保留去标识化、可授权复用的信息。支持后续撤回和同步删除索引。

### 小红书与其他社交内容

- 目标是**尽可能在合法可用的技术路径下查找广外相关资料**，但不要假设存在开放全站笔记搜索/内容抓取 API。
- 默认能力：外部站内搜索跳转、用户/管理员提交笔记 URL、可使用内容的审核/人工整理，保存原文链接、发布时间、地点线索与核验状态。
- 如果后续获得正式授权 API，则增加实时连接器，提供搜索参数、分页、限流、授权范围和异常处理。
- 社交内容一律标 `unofficial`，只用作经验参考；不是活动主办方通知、招生政策、教务规定或学校官方指令。
- **图片或地图**：负责人确认 + 许可核验双门槛，审核前不得发布，也不得将图片偷偷归档到正式生产资源目录。

## 5. 知识存储与索引

- 物理可共用 D1 + Vectorize（或经评估改为 PostgreSQL + pgvector）；**逻辑分库**：official_policy、campus_announcements、approved_life_experience、user_private（租户隔离）。
- `knowledge_documents` 保存完整元数据、正文和附件引用。
- `knowledge_chunks` 关联文档、标题层级、起止偏移、页码和向量索引键。
- `knowledge_facts` 保存可核实的抽取事实、证据片段、适用学年、有效期和审核状态；不能将 `fact` 当成未经核验的绝对事实。
- `event_sources` 将同一事件和多篇文档关联，避免多个重复事件。

### 文档切分

- 官网文章按标题/段落语义拆分；规章按“章/条”拆分；FAQ 一问一答成块；PDF 保存页码及表格结构；活动保留全文，并抽取单独结构化事件。
- 初始中文块大小可测试 400～800 字符、适量重叠，不把这个数字当作固定标准；针对真实问答集调整。

## 6. 混合检索（Hybrid Retrieval）

流程：

1. Query 解析：学院、学年、日期、校区、活动名称、事件状态等硬过滤。
2. 权限过滤：仅选公开知识和本人允许访问的私库。
3. 关键词检索 + 向量检索并行；中文关键词检索要有适用分词/FTS 设计。
4. 候选合并/去重/重排，按相关性、来源权威、适用范围、是否过期综合判定。
5. 返回证据片段、`documentId`、URL、发布时间/更新时间和适用状态，交给 Agent 生成带链接回答。
6. 对申请条件、金额、学年、期限等关键字段检查原始段落，回答时避免只根据相似度猜测。

不确定或多个来源冲突时，给出冲突说明和核查入口；不得因“新抓取”就认定为“新规定”。

## 7. 可信度与生命周期

数据字段至少包括：`sourceType,sourceUrl,sourceAuthority,publishedAt,fetchedAt,verifiedAt,validFrom,validUntil,academicYear,campusScope,reviewStatus,lifecycleStatus,supersededBy`。

- `reviewStatus`：`pending/approved/rejected`。
- `lifecycleStatus`：`active/expired/superseded/withdrawn`。
- 官方来源自动入库不等于永远有效；未知有效期可保持 `unknown` 并提示时间范围。
- 官方信息与小红书矛盾：优先将官方作为制度依据；对商铺体验和临时情况保留多来源差异。
- 事件取消/延期后，地图 marker 和个人订阅提醒也必须同步更新。

## 8. CampusRadar 信息抽取

`official notice → event extractor → date parser → location matcher → review policy → campus_events → map marker`。

抽取至少：`title,organizer,category,startsAt,endsAt,registrationDeadline,targetAudience,campusScope,placeId?,sourceDocumentIds,status`。时间需含时区和时间类型；无法核对则不把事件标成已经确认。

- 同一文章可包含多场活动；不同文章也可描述同一场活动。
- 只有成功匹配到大学城真实 `placeId` 的事件才能显示地图标记。
- 线上活动/白云山校区/地点未知照样可在雷达信息流显示，但不得画错地图。
- 关键时间/地点/截止日期进入公开事件卡片前必须经过确定性规则校验，信心不足进入管理员人工审核。

## 9. 管理员 Knowledge Console

需要具备：来源白名单、连接器配置、手动文件/URL 导入、任务状态、重复文档合并、文档版本、审核队列、地图素材审批、事件抽取核验、索引重建、撤回与删除、操作日志、检索回归测试。

`POST /api/admin/knowledge/import` 等 API 必须权限隔离并限流，不允许游客上传直接修改公共库。文章自动入库与社交内容人工审核的规则必须由后端执行。

## 10. 初始技术落地

- Cloudflare Workers：读取、检索、业务 API。
- Cron Triggers：定时抓取触发器。
- Queues / Workflows：文档解析、Embedding、事件抽取的异步任务。
- D1：关系元数据、来源、事件、审核。
- Vectorize：向量检索；R2：授权文件/图片/原件。
- 如果运行时限制或检索成本要求改变，允许采用外部受控 Worker/数据库，但不能降低来源、权限与生命周期要求。

### 对话模型选择与公共索引

个人中心的自定义 API 只用于本人当前对话生成；游客临时配置同样适用。公共 Embedding、索引构建和后台事件提取使用独立平台配置，不借用用户 Key，不随用户切换模型改变向量维度或重建公共索引。更换回答模型仍须保留证据/来源、适用范围和私库权限；必要的 JSON 能力未通过时拒绝相关工作流。详见 `12_MODEL_API_SETTINGS.md`。

## 11. RAG 验收案例

1. 检索当前申请政策时能区别不同学年且引用原文。
2. 群聊传闻不被当成学校公告；小红书查询结果始终有非官方来源和跳转。
3. 已过期活动不出现在“未来活动”的默认筛选中。
4. 白云山实体和线上活动不在大学城地图产生虚假标记。
5. 撤回文档后关键词和向量检索都不再返回被撤回内容。
6. 站点抓取失败不清空已有有效知识；后台可查看并重试。
7. 其他用户不能检索到本人的课表/私人附件；公共 RAG 不含原始微信群个人隐私。

## S3-A 运营基础实际落地（2026-10-17）

Console已建立来源登记/人工核验、候选内容审核/发布/撤回/版本、审计和统一失效契约。220条负责人清单全部未核验、未启用，0采集文章。来源年份/优先级不等于可采集；非官方默认人工审核，活动关键时间/地点/截止未核验不可发布。全文HTML/Markdown在后台作为纯文本安全预览。

后续RAG应消费content_index_invalidations，并以console_public_documents和filterPublicContent重新验证命中ID及版本；撤回、拒绝、过期、来源暂停和权限变化立即阻止旧命中。当前没有向量/关键词索引消费者，不声称已完成索引构建或物理删除。本轮不启用Connector、定时抓取或自动AI提取，详见docs/S3_A_CONSOLE_ACCEPTANCE.md。
