# 个人待办冲突检测与连续任务复验

## 原始记录及根因

读取负责人提供的 `campusos-agent-run (5).json` 与 `campusos-agent-run (6).json`。第一轮在 `personalRead` 的两场名称解析分支返回澄清，尚未调用 `PersonalTaskStore.list`。原 trace 的 sources 统计的是来源卡片数量，无法证明个人待办是否读取，实际本轮未读。

第二轮的 `personalReadIntent` 仅分析当前输入，“所有活动”没有个人数据范围词。旧会话 artifact 只有公开活动的 comparison 状态，没有个人待办冲突状态，因而进入校园内容检索。日志有历史消息数，也无法替代任务状态传递。

## 修改文件

- `src/domain/agent/personal-task.ts` 定义个人冲突任务的输入范围、日期、活动名称和状态。
- `src/lib/server/assistant/personal-conflicts.ts` 解析本轮目标及范围补充，读取关联活动区间后排序并扫描全部重叠组合。重复收藏或待办指向同一个场次时合并。使用实际时间戳比较，支持跨日和不同时区的已确认区间，相邻边界相等不冲突。
- `src/lib/server/assistant/personal-reads.ts` 全量扫描先实际读取本人待办。读取状态区分未登录、空数据和成功读取。数据库失败由调用方记录 failed，未完成任务不会伪称成功。
- `src/lib/server/assistant/store.ts` 将 activeTask 保存在本人会话的回复 artifact 中，兼容既有数组和比较状态格式。
- `src/lib/server/assistant/chat.ts` 优先续接个人任务，再选择数据源。旧版本对话的紧邻个人冲突问题也可以恢复范围。记录 activeTask、resolvedIntent、dataSource、completionReason、读取数量、可比较活动和冲突数。
- `src/lib/server/calendar/compare.ts` 复用原文确认结束时刻的逻辑。
- `src/lib/server/assistant/evidence-answer.ts` 结构化活动列表排除没有举办日期或仅为 notice 的普通文章。
- `tests/unit/personal-conflicts.test.ts`、`tests/unit/personal-activity-tasks.test.ts` 覆盖范围追问、日期补充、新话题切换、未登录、空数据、已完成排除、关联场次、时间缺失、账号隔离以及真实聊天入口的连续三轮。

## 数据模型边界

当前个人待办字段为 title、dueAt、notes 和 source。dueAt 是逾期时间，不能推定为举办时间。已关联日历场次时读取真实 startsAt 和 endsAt。明确全天占用和重复规则尚无存储字段，本次没有新增这两项编辑功能；日期精度的活动按时间不足列出，不能猜测为全天。未关联、已取消或延期、来源失效、多场次未选定和缺结束时刻的条目都会保留为无法判断。已完成待办不参与扫描，未完成和逾期待办参与。无足够区间时 taskStatus 为 partial 或 insufficient_evidence；没有未完成事项时返回真实空状态。

## 验证与运行导出

全量 Vitest 172 个文件、1220 个测试通过，类型检查、lint、生产构建通过。最后扩大显式待办表述范围后，相关六个测试再通过。

[第一轮完整日志](round-1.json)与[第二轮完整日志](round-2.json)来自同一个线上后台会话。使用既有隔离测试账号，加入两场公开的 11 月 20 日活动和一个只有逾期时间的测试事项。第一轮检测到 2 个明确区间、1 组重叠 30 分钟的冲突，缺时间条目列为无法判断。第二轮“所有活动”继承同一任务与数据源。两轮均无校园知识、校园活动、外部搜索或模型调用。日志移除会话和请求标识，保留公共活动 ID、实际工具数据和任务判断。新增隔离待办已清理，既有事项保留。
