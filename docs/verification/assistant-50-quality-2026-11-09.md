# CampusOS AI助理｜50题校园事务回答质量评测（2026-11-09）

只读评测：未修改任何产品代码、未改数据库、未部署。所有样本来自 Preview（`https://campusos-preview.zhujunkui1.workers.dev`）真实 API。

## 环境

- HEAD：`a0ef179`（main，与 origin/main 同步，无未提交改动）
- Worker：`9399c9eb-7274-4e3a-96f7-21f6f6142924`
- 脚本：`.tmp/assistant-50-eval.mjs`；原始结果：`.tmp/assistant-50-results.json`
- 每题一个独立游客会话（`POST /api/agent/session` → `POST /api/agent/chat`，SSE），记录回答文本、工具调用、来源卡片、耗时、后端 metrics

## 总体结果

| 指标 | 结果 |
| --- | --- |
| HTTP | 50/50 = 200，无空回答、无工具报错 |
| 工具调用 | 53 次（`search_campus_knowledge` ×49、`search_campus_events` ×4），全部成功 |
| **地图工具调用** | **0**（`search_places` / `plan_route` / `control_map`） |
| **外部联网搜索** | **0**（智能搜索默认关闭） |
| answerMode | `model` ×37、`no_evidence` ×8、`evidence_excerpt` ×4、`event_list` ×1 |
| **模型失败** | **7/50（14%）抛 `MODEL_SERVICE_UNAVAILABLE`**：Q3、Q4、Q17、Q18、Q22、Q28、Q44 |
| answerRequirement | `strict` ×49、`advisory` ×1、`open` ×0 |
| conversationAct | `general` ×25、`campus` ×25 |
| 编号引用 | ≈23/50；其中 Q13、Q35 输出 `[n1][n2]`，前端不认 |
| 耗时 | avg **23.3s**、p50 **19.7s**、p95 **57.2s**、max **82.5s**（保研） |

## 质量分层

### A｜可用（13）
Q5、Q7、Q9、Q15、Q20、Q23、Q24、Q38、Q39、Q41、Q42、Q43、Q47
命中真实学生手册/官方正文，答案含具体数字、时间、流程、电话，并带 `[n]`。

### B｜部分可用（2）
Q6（借阅规则只给总台电话）、Q50（校友入馆可答，食堂部分未确认）。

### C｜诚实说明或被迫兜底（30）
Q1、2、3、8、10、11、12、13、14、16、17、19、21、25、26、27、28、29、30、31、32、34、35、36、37、40、45、46、48、49
其中 Q3/Q17/Q28 是 **模型失败后**的 lastResort（"这次没能把资料整理成可靠回答…"），其余是"未检索到…建议咨询 XX"。表层的语料缺口，但其中至少一半属于校内根本没有公开上网的服务信息。

### D｜答错或答偏（5）
| Q | 问题 | 实际输出 |
| --- | --- | --- |
| Q4 | 团组织关系转接 | 《研究生新生入学指南》住宿报到段落 |
| Q18 | **体测不达标怎么办** | **奖学金条款"体测≥65分"** |
| Q22 | **心理咨询记录是否保密** | **咨询师履历 + 预约时段** |
| Q33 | **学科竞赛奖金怎么发放** | **竞赛活动列表**（event_list） |
| Q44 | **食堂营业时间** | **食品安全招标文件片段** |

## Roots

### R1｜模型失败被当成"没有资料"（7×，14%）
- `src/lib/server/assistant/chat.ts:1860-1930`：仅在 `MODEL_* / TIMEOUT / RUN_LIMIT_EXCEEDED` 时进兜底，兜底文案仍说"没有检索到能回答这个问题的正文信息"。
- `src/lib/server/assistant/model-run.ts:433-455`：`validateFinal` / `checkEvidence` 拒绝后只重试一次，第二次即抛 `MODEL_SERVICE_UNAVAILABLE`。
- `src/lib/server/assistant/grounding.ts:97`：固定兜底文案。
- Q3/Q17/Q28/Q44 metrics：`answerRepairRetries=1`、上游两次均以 `stop` + 82–174 字结束 ⇒ **不是超时，是校验器把简短正确的回答判掉了**。
- Q18：`groundingChecks=1`、`groundingFailures=1`（判定为把教育部意见归因给广外），重试仍失败。

### R2｜校验器与证据自相矛盾（关键）
- `src/lib/server/assistant/chat.ts:1000-1006`
  ```ts
  if (content.active && falseNegativeAnswer(text, content.query, contentResults))
    return "本轮已检索到符合主题的公开文章，不能否定相关文章存在。..."
  ```
- `src/lib/retrieval/evidence-assessment.ts:150-162`：只要命中文档数 >0，且回答含"没有找到…相关信息"，就判为漏召回。
- 当检索到的是**同主题但不含答案的文章**（食堂招标公告之于营业时间），模型正确地说"没有"却被判错，被迫重写；重写仍不合格即抛错。这正是 Q44/Q18/Q22/Q33/Q4 从"正确说不出来"变成"摘录原文"的机制。

### R3｜检索排序只看主题词，不看答案槽位
食堂→招标公告；图书馆→假期/临时闭馆；体育馆→研究生考试报名；心理咨询→咨询师介绍。没有判断段落是否包含时间/费用/流程等答案槽位。

### R4｜通用设施问题不走地图
Q45「校园超市和打印店在哪」、Q46「快递点」只调了 `search_campus_knowledge`，还提示用户"开启智能搜索开关"。
- `src/domain/agent/navigation-intent.ts` 的 `mentions()` 只匹配规范地名或别名。
- `src/features/campus-map/data/campus.json` 只有「又康超市」「三饭打印店」「B栋打印店」「菜鸟驿站」「中通快递」，别名仅「又康」。
- 用户说的「超市」「打印店」「快递」不构成 named place ⇒ 不进地图分支。

### R5｜strict / advisory 几乎失效
`src/lib/server/assistant/content-intent.ts:292-307`：`strictFact` 由知识类正则 / events / articleLookup / officialOnly 覆盖，命中任一即 `strict`；50 题里只有 Q12 拿到 `advisory`。这与"通用知识应可回答"直接冲突。

### R6｜引用格式污染
`src/lib/server/assistant/content-prompt.ts:30` 要求 `[n]`，模型偶发输出 `[n1] [n2]`（Q13、Q35）；前端只重排 `[n]`（`src/lib/server/assistant/citations.ts:6-20`）。

## 优先级建议

- **P0：R1 + R2** —— 14% 的样本因校验死循环被降级为拒答，且直接削弱"有证据就该答"。
- **P1：R3 + R5** —— 检索槽位判断 + 通用知识通道。
- **P2：R4 + R6 + P95 延迟**（57s）。

## 复现

```bash
node .tmp/assistant-50-eval.mjs
```
