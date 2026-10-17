# S3-0：参考产品与 Dify 对接边界只读研究

核查日期：2026-10-17（Asia/Shanghai）。性质：架构讨论材料，不代表任何采集、Dify 集成或新业务已实现。

## 1. 本次边界与方法

- 阅读项目根 AGENTS、v2 AGENTS/索引与 04_RAG_DESIGN；遵守最新 S3-0 只审计要求。
- 使用公开网页及 Edge 的正常页面交互查看参考站。未登录、提交留言、报名、调用私有接口、复制站点代码/图片/文章库。只记录产品机制，未保存第三方全文。
- Dify 只阅读官方文档、官方定价和主仓库 LICENSE，未连接学校内网、创建账号、安装运行 Dify、发送真实模型或知识检索 API 请求。
- 浏览器临时使用 390×844 手机视口，完成后恢复原视口并关闭研究专用页；手机视口观察不代表手机实机验收。
- 被替换的旧 S3-B 子任务仅尝试通过网页阅读工具读取 5 站 robots（均报告不可访问）；未抓取官网主页/文章，未运行 PoC，没有后台进程、改表、启用或导入操作。

## 2. PKU Know：已观察的公开机制

主入口：[首页](https://pkuknow.cn/)、[活动日历](https://pkuknow.cn/calendar)。以下为当前页面观察，不推断后台实现方式。

| 项目       | 已观察                                                                                                                                 | 尚不能证明                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 聚合与分类 | 首页按活动、通知分组；细分文体、社团、讲座、学习、就业、留学及校园、科研、院系、生活、学业、奖学金、服务。分类块可独立滚动和查看更多。 | 自动分类模型、准确率、完整覆盖率、审核人员与审核算法。         |
| 查询与筛选 | 有标题/公众号/发布单位搜索、学科筛选、公众号/官网来源开关及来源目录。                                                                  | 所有筛选组合的正确性、搜索召回与数据时效 SLA。                 |
| 卡片       | 展示标题、发布时间、来源，部分卡片带需报名标记；点击可见摘要与原文跳转。                                                               | 标记代表已报名、报名可用或报名截止已核实；摘要由哪个模型生成。 |
| 来源治理   | 目录区分官网与公众号；需要校内登录或专用授权的部分来源被列为暂不自动更新。                                                             | 已获各来源完整转载授权、目录中每个账号都已人工认证。           |
| 来源补充   | 留言弹窗允许反馈来源线索，要求公众号名称与一条推文链接，昵称可留空；显示处理状态。                                                     | 实际提交流程、防滥用能力及审核权限。此次未填表或提交。         |
| 匿名浏览   | 未登录即可查看首页、来源目录、详情与日历。                                                                                             | 不收集任何访问日志、不设置 Cookie 或无隐私风险。               |

以上均据[当前首页](https://pkuknow.cn/)的公开交互观察；表中“尚不能证明”是研究限制，不是对站点的故障判定。

### 2.1 日历

[日历](https://pkuknow.cn/calendar)有前后周、今天、日期选择和每日活动数量。390×844 视口显示一周日期条及选中日期的活动列表，条目含时间、地点、来源；缺少字段的条目并未都补齐。公开列表可见相近活动的多来源条目及取消字样，故不能据此认定其完成了事件级去重和取消状态治理。日历中的活动时间与首页“发布时间”应作为不同概念建模。

未测试系统日历导出/订阅、个人报名状态、提醒推送和账号同步，不将这些功能记为已验证。

### 2.2 响应式布局

Edge 普通桌面视口实际显示四列卡片；390×844 手机视口实际显示两列，并通过列数菜单切换到单列，界面随之重排。手机导航收为活动/通知入口，常用功能在菜单内。此处只证明所观察尺寸和两种列数可用，未覆盖其他尺寸、触控手势或真机。

### 2.3 给 CampusOS 的产品建议（研究推论，尚未实施）

1. 雷达用结构化事件字段支撑时间/类别/校区筛选；知识页用可追溯文档支撑政策与办事查询；两者可共用来源和文章，但不共用同一种发布时间含义。
2. 地图标记继续只接受已核实的大学城地点 ID；来源文章和日历的纯文本地点不直接生成坐标。
3. 来源补充属于候选线索入口，先经 Console 审核，不能由匿名提交直接新增启用的 Connector。
4. 借鉴分类、来源、短摘要、原文跳转和手机单双列的交互思想；不复制参考站视觉素材、文章数据、代码或分类判定结果。
5. “需报名”只表达报名要求；“报名中/已截止/已取消/改期”需独立证据与状态。一个文章版本可关联多个事件，一个事件可保留多个文章出处。

## 3. Dify：两条检索方向不可混淆

### 3.1 CampusOS 调用 Dify 内置 Knowledge/Dataset

官方 [Knowledge API](https://docs.dify.ai/en/api-reference/guides/knowledge)支持代码管理文档与知识库，并供外部程序直接检索。建文档后索引异步完成，不可将文档写入成功当作检索就绪。

当前官方接口为 [`POST /datasets/{dataset_id}/retrieve`](https://docs.dify.ai/en/api-reference/knowledge-bases/retrieve-chunks-from-a-knowledge-base-test-retrieval)，以知识库 API Key 的 Bearer 认证，返回匹配片段和分数；不是调用整段 Dify 聊天，也不会自动代替 CampusOS Agent。参数与路径需以最终采用版本再次验证，不能沿用旧教程的同名近似端点。

官方建议 API Key 只存服务端，并支持限制可访问的知识库；Key 的 dataset 范围并不等于 CampusOS 学生身份权限。[鉴权与作用域说明](https://docs.dify.ai/en/api-reference/guides/knowledge)

### 3.2 Dify 调用 CampusOS 自有检索

官方的 [Connect to External Knowledge Base](https://docs.dify.ai/en/cloud/use-dify/knowledge/connect-external-knowledge-base)表示 Dify 应用向外部检索服务取片段，内容与检索逻辑仍归外部系统管理；Dify 没有通过此连接修改外部内容的能力。配置的基础地址会被追加 `/retrieval`。

[External Knowledge API](https://docs.dify.ai/en/cloud/use-dify/knowledge/external-knowledge-api)约定请求携带 `knowledge_id`、`query`、`retrieval_setting` 和可选元数据条件，响应 `records` 包含片段、分数、标题与对象形式的 metadata。认证由外部服务自己验证，Dify 只传递预配置的 Bearer Key。该协议没有天然携带可信 CampusOS 学生会话的保证。

因此，这个外部知识协议不是“自研 Agent 接学校 Dify 知识库”的同义词；是否采用取决于谁保有索引、谁发起检索，须先确定数据流方向。

## 4. 与现有 CampusOS 架构的建议边界（研究推论）

本节是待负责人确认的设计建议，没有新增服务或实现代码。

| 责任             | 建议边界                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 来源与合规       | S3-A Source Registry 仍是来源核验、许可、启用和暂停的事实来源。Dify 可访问不等于获得内容使用许可。                                                 |
| 文档、审核、版本 | 保留 D1 文档、审核、版本与 invalidation outbox；第三方知识库只保留可重建的索引副本及外部 ID 映射。                                                 |
| Agent            | 自研 Orchestrator、Skill Registry、Tool Executor、地图五项 Skills 和 MapAction 回执保持负责原有闭环。Dify 如引入，先作为窄检索适配器。             |
| 查询返回         | 适配器返回证据片段及 CampusOS 文档 ID/版本/原文链接/发布日期；所有命中在 D1 的公开状态门禁重新核对，拒绝撤回、拒绝、过期、来源暂停或版本失配内容。 |
| 撤回             | D1 先阻止对外命中，再通过 outbox 幂等同步远端停用/更新/删除；远端失败可重试，不能在索引尚旧时继续引用已撤回内容。                                  |
| 私人数据         | 本阶段外部检索只设计公开知识范围。学生对话、GPS、成绩与私有资料不发送；不能把模型提供的 userId、metadata 条件或 knowledge_id 当权限。              |
| 密钥和网络       | 只读检索 Key 与后台写索引 Key 分离，固定受控端点，服务端 Secret、超时、并发/用量限制、有限重试；不给模型任意 URL 或原始管理 Key。                  |
| 故障             | 知识服务不可用时明确返回不可用/无已核验证据；地图与导航独立运行，不静默改用额外付费模型。                                                          |

若没有学校提供的外部可达端点、负责人授权、版本信息、知识库范围和服务凭据，只能保留接口设计，不能宣称学校 Dify 已接通。学校内网本次没有探测。

## 5. 费用、自托管与授权注意

- [官方定价](https://dify.ai/pricing)当前列出 Cloud Sandbox 免费试用，知识文档/存储/API/检索均有额度；免费不等于不限量。是否消耗模型、Embedding 或 Rerank 费用要按实际工作流与模型供应商计量，不因只调用“检索 API”就保证零模型费用。当前页面的 Sandbox 核心上限为 50 知识文档、50MB、10 知识请求/分钟和 5,000 API 次/月；这是文档观察，未核验任何学校或项目账号配额。
- 自托管 Community 的软件费用与服务器、数据库、向量存储、备份、运维、模型调用费用分别核算。此处没有部署选型、报价或开通动作。
- [官方主仓库 LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)是附加条件的 Apache 2.0：可作其他应用后端；多租户环境限制以 Dify workspace 为租户定义；使用 Dify 前端时不得移除/修改其标志和版权。只接 API、不使用 Dify 前端与直接改造其 Console 的许可边界不同。不能把“免费比赛”或“开源”当任意集成/再分发许可；具体采用版本的许可和学校授权仍需逐项核对。
- 多个 CampusOS 学生调用一个既定服务，与向每位用户出租 Dify workspace 是不同的设计；仍需独立实现学生权限。许可证解释不能替代学校数据授权或供应商书面许可。
- 本次费用 0：只读网页，没有调用 Dify/LLM API、购买或升级服务。

## 6. 仍未验证

1. 参考站完整采集链路、模型、后台技术、授权范围、数据准确率与匿名反馈的反滥用能力。
2. 任何学校 Dify 实例的可达性、登录方式、API 版本、Key 作用域、数据权利、可用模型、容量、费用和 SLA。
3. CampusOS 与任何 Dify 的真实鉴权、召回、撤回同步、超时与性能回归；本阶段不执行这些接入测试。
4. Cloudflare Free 历史 CPU 风险是否可因外接检索降低：网络等待不等于 CPU，必须后续基于实际测量，不能据架构图宣称已解决。

## 7. 来源清单

所有链接于 2026-10-17 只读查阅；同一天页面数量可能随内容更新变化。

- [PKU Know 首页](https://pkuknow.cn/)
- [PKU Know 日历](https://pkuknow.cn/calendar)
- [Dify Knowledge API 总览](https://docs.dify.ai/en/api-reference/guides/knowledge)
- [Dify Dataset 检索接口](https://docs.dify.ai/en/api-reference/knowledge-bases/retrieve-chunks-from-a-knowledge-base-test-retrieval)
- [Dify 外部知识连接方向](https://docs.dify.ai/en/cloud/use-dify/knowledge/connect-external-knowledge-base)
- [Dify External Knowledge API 协议](https://docs.dify.ai/en/cloud/use-dify/knowledge/external-knowledge-api)
- [Dify 官方 OpenAPI](https://docs.dify.ai/en/api-reference/openapi_service.json)
- [Dify 定价](https://dify.ai/pricing)
- [Dify 官方 LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)
