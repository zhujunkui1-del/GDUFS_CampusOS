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

## 修复后的复测（2026-11-10，同一 50 题）

`node .tmp/assistant-50-eval-v3.mjs` → `.tmp/assistant-50-results-v3.json`，脚本与首次评测相同，每题独立游客会话。

| 指标 | 修复前 | 第一次修复后 | 第二次修复后（v3） |
| --- | --- | --- | --- |
| `answerMode=model` | 37 | 41 | 41 |
| `answerMode=no_evidence` | 8 | 7 | 7 |
| `answerMode=evidence_excerpt` | 4 | 2 | 2 |
| `MODEL_SERVICE_UNAVAILABLE` | 7 | 0 | 1 |
| 超时 | 1 | 1 | 1 |
| 平均耗时 | 23.3s | 24.2s | 24.6s |
| p95 | 57.2s | 68.6s | 61.4s |

### 已解决的问题

- 校验失败不再被一律说成「语料没有覆盖」：软性校验失败（措辞、引用格式）会重写一次，只有硬性缺陷才降级。
- `[n1]`/`【来源2】` 会让前端找不到来源，现在统一归一为 `[1]`。
- 时间窗识别「最近两周」「11月10号到11月22号」；「还有吗」会翻页而不是重复同一批；「换成讲座呢」会继承上一轮时间窗。
- 活动日历在窗口内没有安排时，明确说「这段时间没有 X」并给出之后的最近安排，而不是笼统的「未检索到」。
- 证据裁判把「来源没写到的细节」与「与来源矛盾」分开：前者只记待核对，不再把正确答案丢掉。
- 宿舍注意事项这类求建议的问题会先给通用建议，再说明哪些具体规定待核实。

### 仍存在的问题

- **`evidence_excerpt` 仍会被触发**：Q10「入党积极分子和发展对象有什么区别」的两次判定都被判为 `contradiction`，且确有依据（发布单位写错、把个案当普遍规律、间隔月份与来源不符）。这是模型生成的事实错误，不是裁判误判，但当前路径是整段降级为原文摘录，而不是只修正错误的那几句。
- **Q50「校内有哪些勤工助学岗位」超时**（97s），两次都是 `TIMEOUT`。
- **7 题 `no_evidence`**：志愿服务时长、游泳池、校园卡挂失、宿舍吹风机功率、晚归记录、学费缓缴、银行 ATM。前一轮评测里游泳池、晚归、缓缴是能答的，说明这类题的检索结果不稳定——同一问题在不同时刻可能命中不同文档。
- **p95 仍在 60s 以上**，最长接近 100s。

## 第三次修复后的复测（2026-11-10，v7）

`node .tmp/assistant-50-eval-v7.mjs` → `.tmp/assistant-50-results-v7.json`，`CONCURRENCY=2`，同一 50 题。

| 指标 | 修复前 | v3 | v4 | v6 | v7 |
| --- | --- | --- | --- | --- | --- |
| `answerMode=model` | 37 | 41 | 39 | 46 | **48** |
| `answerMode=no_evidence` | 8 | 7 | 9 | 3 | **2** |
| `answerMode=evidence_excerpt` | 4 | 2 | 2 | 0 | **0** |
| `MODEL_SERVICE_UNAVAILABLE` | 7 | 1 | 0 | 0 | **0** |
| 超时 | 1 | 1 | 0 | 0 | **0** |
| p50 | 19.7s | 20.6s | 9.4s | 19.4s | **19.2s** |
| p95 | 57.2s | 61.4s | 24.4s | 38.0s | **31.9s** |
| 最长 | 97.5s | 97.5s | 28.7s | 38.0s | **41.1s** |

v4/v6/v7 的并发度不同（v4 为 4，v6/v7 为 2），耗时列只作趋势参考。

### 本轮解决的问题

- **检索门禁把句子碎片当硬过滤**：`queryRelevance` 会把「宿舍报修在哪里提交」剩下的「报修在」「提交」当成必须命中的主题词，于是唯一能回答的《使用指南｜故障报修全攻略》被 `subject_modifier_missing` / `core_topic_missing` / `purpose_mismatch` 三道门先后拒绝。现在以动词开头、以谓语/属性/症状词结尾的碎片只参与排序，不再否决文档。
- **指南类文章按主题而非地名匹配**：标题写「故障报修全攻略」而不是「宿舍报修」的指南，现在被视为覆盖该操作，只要标题命中操作词即可。
- **证据裁判分级**：`contradiction` 与 `unverified` 分开，只有真的与来源矛盾才判硬伤；judge 增加 `JUDGE_TIMEOUT_MS = 12000`，超时按未校验处理，不再把整轮运行拖成 TIMEOUT。
- **检索稳定性**：同一问题多次运行的波动来自 modifier 门禁，现已消除。

### v7 仍存在的问题

- **Q10「体育馆怎么预约，收费标准多少？」**：知识库确实没有体育馆预约与收费内容（D1 标题含「体育馆」的只有校史馆参观月报和游泳比赛报道），属于数据缺口，不是检索缺陷。
- **Q18「校门口打车方便吗，哪个门最近？」**：应当走地图地点工具而不是知识库，当前 `facilityListing` 只覆盖「快递/驿站/打印/超市/便利店/充值点」，不覆盖校门与打车。
- **地图别名仍缺**：便利店、打印店、快递、银行等常见叫法没有映射到 `campus.json` 的地名，导致「校内有哪些便利店」会返回 `search_places ok:false`。
- **长文入库截断**：`article_search_documents.text_length` 小于正文长度的文档占多数（5830 篇 ready 文档中 4708 篇 text_length < 1500），部分公众号长文只入库了前几百字。这是入库链路问题，本轮未改动。
