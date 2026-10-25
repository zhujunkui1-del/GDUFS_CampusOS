# 文章分析查询接口（M5）

沿用13个业务分类。`unknown` 为处理状态，不是第14个业务分类。原始文章身份/发布不变；待分类公开文章在雷达的中性“待分类”分组保留阅读入口，不再声称校园公告。稳定知识只进入知识栏目。人工分类覆盖自动投影。

## 公共列表

`GET /api/public/content?surface=radar|knowledge&grouped=1&limit=12` 保留既有列表/分页/搜索，增加 `primaryDestination`、`hasRegistration`、`classificationOrigin`。雷达可用 `category=unclassified` 查待分类状态，其余类别沿用原契约。每次请求只读已存投影，不运行分类、解析HTML或调用模型。分组用一次窗口查询，避免每分类重复展开公开视图。

## 文章结构化证据

`GET /api/public/analysis?id=<documentId>`：先用现有公开视图复验发布、撤回、日期门禁、白名单、来源和修订，再返回：

- 文档ID/版本、原文URL、真实来源、发布时间、正文是否真正可用。
- 当前有效分类（人工优先）及分析器版本、置信等级、证据。
- 报名要求、逐活动报名窗口、其他截止、举办时间、原文地点与状态。
- 知识条件/步骤/材料、政策明确生效/失效时间；无证据的现行性是unknown。

不会因读取而创建分析；没有投影时analysis为null。不会返回私有/下架/墓碑内容。仅元数据文章不冒充全文。

## 有界活动查询

`GET /api/public/activities?category=competition&after=2026-11-01&before=2026-11-08&limit=10`。

`registration=open` 仅返回有可信明确开始和结束时刻且当前在窗口内的事项。没有开始时间或只有当天边界的日期不会被推断成“现在可报名”。可不带该参数读取含未知字段的活动，再向用户准确解释未知。日期筛选走活动日期索引，报名走文档/活动窗口主键；最多20个结果、最多20次文章证据复验，不扫描全量HTML。

返回独立activity key和来源documentId；仅标题、日期、原文地点都相同的group_key合并来源，不能确认时不合并。取消/改期不列为当前开放；状态随读取时间推导，不为时间流逝不断写库。原文地点不生成猜测坐标。

## 前台“报”

卡片、详情标题、独立阅读页用同一类别主题色的圆角“报”字。字段来自有肯定证据的registrationStatus=required；报名已截止仍保留。unknown/not_required不显示。标签不表示当前仍开放。

## Agent/RAG 边界

这些函数为现有自研RAG/Agent提供真实数据查询契约；本轮没有重新实现Skill Registry、编排器或地图。现有地图五项Skills不变。尚未接入 `search_campus_knowledge` / `search_campus_events` 的真实模型工具调用，因此不交付虚构工具日志或地图回执。正文证据与辅助用途已能由查询层读取，后续可在原架构中接入。
