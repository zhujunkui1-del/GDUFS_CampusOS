# CampusOS Agent 五份运行记录复核

## 根因和修改位置

| 场景 | 源头与修复 | 对应代码 |
| --- | --- | --- |
| 场次比较 | 旧版把带日期的新请求当成对上一轮场次的补充。D-197 已修正路由优先级。本次对每个返回场次再核对当前标题和日期，区分查询命中、需要用户选择和证据不足。日期区间以实际时间戳比较，取消或延期沿用公共日历过滤。 | `src/lib/server/calendar/compare.ts`、`src/lib/server/assistant/chat.ts` |
| 奖学金制度 | 四个输出名额直接截取检索排序，发放通知挤占制度类候选。加入制度文档召回和按奖项类型分组重排。附件入口直接列出带引用的文件，缺少正文时保留边界。 | `src/lib/retrieval/terms.ts`、`src/lib/server/retrieval/retriever.ts`、`src/domain/retrieval/contracts.ts`、`src/lib/server/assistant/evidence-answer.ts` |
| 海外留学 | 校园回答的模型输入仍含旧用户问题，旧校验只判事实支撑。日志本身无法证明旧用户问题是单一原因，代码证据表明它可成为主题污染的输入路径。当前工具调用和证据只保留在最新消息之后，较早语境用于服务端解析追问。新增留学主题识别和先于事实核验的错题校验，未确定申请层次与路径时先澄清。 | `src/lib/retrieval/aliases.ts`、`src/lib/retrieval/query-plan.ts`、`src/lib/retrieval/evidence-assessment.ts`、`src/lib/server/assistant/model-run.ts`、`src/lib/server/assistant/evidence-check.ts`、`src/lib/server/assistant/chat.ts` |
| 近期可参加竞赛 | 参赛意图落入近期新闻列表，截断前依据发布日期。按当前开放报名窗口缩小候选，剔除已结束、取消和结果报道，输出只使用已核实的报名证据。 | `src/lib/retrieval/query-focus.ts`、`src/lib/retrieval/evidence-assessment.ts`、`src/lib/server/assistant/content-intent.ts`、`src/lib/server/assistant/read-plan.ts`、`src/lib/server/assistant/evidence-answer.ts`、`src/lib/server/retrieval/skills.ts` |
| 宿舍水电费 | 原始记录已召回研究生手册，后续通用相关性筛选未保留直接渠道证据。让同缴费对象的官方局部证据进入引用，直接输出可确认的事实。对有明确章节的长篇手册沿章节切片，停止把手册日期当独立活动。 | `src/lib/retrieval/payment-evidence.ts`、`src/lib/retrieval/evidence-assessment.ts`、`src/lib/retrieval/chunks.ts`、`src/lib/ingestion/reference-sections.ts`、`src/lib/ingestion/article-times.ts`、`src/lib/ingestion/calendar-extraction.ts`、`src/lib/server/assistant/chat.ts`、`src/lib/server/assistant/evidence-answer.ts` |

## 计量和风险

原日志的 260,018 来自已知的 10,018 Token 加一次 250,000 本地保守配额记账。无效规划回复原本仍带 usage，调用方因抛弃该回复而丢失这笔用量，进而触发保守记账。没有足够数据从该值推算供应商实际扣费。更新后会保留模型返回的用量，即使计划不符合工具协议。供应商用量缺失时，分别显示观测 Token 和配额记账，缺失标记会保留。知识检索输出 lexical、supplement 与 revalidationAndRanking 三段耗时。核验分别记录事实支撑、与本轮问题的一致性及关键证据覆盖，超时为核验未完成。

当前公开奖学金文件在 D1 中部分只有附件入口。仍需入库可读取的附件正文，才可给出具体条款。已有长文档索引未全库回填。未核实开放报名的结果表示当前资料证据不足，外部页面只有摘要或缺少有效窗口时也不会作为报名依据。水电手册说明充值服务，楼栋适用范围和目前执行情况仍需核实。普通模型问答耗时受供应商响应影响。最终复测留学申请仍需模型生成及核验，耗时约 35 秒，5–8 秒目标尚未达成。

## 线上导出

以下是通过后台 Agent 工作流用同一会话顺序复跑的完整导出。仅移除了会话、请求和运行标识及凭据字段，保留节点、工具证据和公开来源。

- [01 场次比较](01-calendar.json)
- [02 奖学金制度](02-scholarship.json)
- [03 海外留学](03-study-abroad.json)
- [04 可参加竞赛](04-participation.json)
- [05 南校水电缴费](05-utilities.json)

自动化回归见 `tests/unit/assistant-audit.test.ts`、`tests/unit/calendar-compare.test.ts` 及相关共享检索套件。


## 验证范围

全量 Vitest 171 个文件、1218 个测试通过。类型检查、lint、生产构建及环境清理检查通过。隔离测试覆盖冲突、不冲突、单项与双项缺失、标题标点、无关场次、跨日与时区、开放与关闭报名、取消及赛后报道、同邮箱多账户已有套件、缴费对象和手册章节。

五份导出按相同会话顺序运行，包含奖学金后接海外申请。题目数据全部来自当前公开 D1。以数据充分的确定性分支直接生成带证据的结果，因此本次若干题模型调用为零。模型分支的事实校验字段与超时行为仍受供应商输出影响。日志的 status 保留执行终态，metrics 中 executionStatus、retrievalStatus、taskStatus 表示业务状态。


## 最终线上结果

共享 Preview Worker 为 `56c7edaa-8f97-48d5-9df0-12ab21404572`，以下五题在同一会话顺序完成，浏览器断言通过。

| 导出 | 本次服务端耗时 | 任务状态 |
| --- | --- | --- |
| [01-calendar](01-calendar.json) | 1.456 秒 | completed |
| [02-scholarship](02-scholarship.json) | 3.013 秒 | partial |
| [03-study-abroad](03-study-abroad.json) | 35.053 秒 | partial |
| [04-participation](04-participation.json) | 1.481 秒 | insufficient_evidence |
| [05-utilities](05-utilities.json) | 1.549 秒 | partial |

留学申请实际命中三份公派申请通知及一份学院参考资料，最终回答与本轮问题相关。事实核验超时一次，任务保留 partial。已观测 Token 5243，保守配额记账 250000，usageComplete=false。其他四题均沿实际证据直接生成，无额外模型调用。
