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
- **地图别名**：已补（见下节）。
- **长文入库「截断」是误判**：上一轮把 `text_length` 偏小当成截断，实际是**公众号 HTML 的字节数被内联样式撑大**。抽样核对 `body_format='reading_html'` 的文档，`articleText()` 抽出的正文与 `text_length` 基本一致——《故障报修全攻略》`body` 58,259 字节，去样式后正文 882 字，`text_length` 928；`wx-7f3ebc318681d421366` 356,227 字节对应正文 611 字。**入库没有截断**，这批文章本身就是图片为主、文字很少，可检索内容自然有限。

## 2026-11-10｜地图别名与「地图没回执」降级

两个独立的缺陷都能让「校内有哪些便利店」这类问题变成空回答。

**其一：地图只有正式地名，没有学生叫法。** `campus.json` 里是「又康超市」「三饭打印店」「B栋打印店」「菜鸟驿站」「中通快递」，别名只有「又康」，所以 `search_places` 收到「便利店」「打印店」「快递」时匹配不到任何地点，`search_campus_knowledge` 又没有这类内容，最终只能拒答。

新增 `src/features/campus-map/data/service-aliases.json`，只按 place id 追加口语别名（超市/便利店/小卖部、打印店/打印/复印、快递/快递点/驿站），不新增地点、不改坐标与来源。`campus.ts` 读取时合并进 `aliases`，`scripts/prepare-route-metadata.mjs` 的输入清单同步加入该文件，否则 `npm run deploy:preview` 会以 `Public walking metadata is stale` fail-closed。

**其二：地图动作没有回执时整轮失败。** `chat.ts` 的 `beforeAnswer` 在发布 `artifact.ready` 后最多轮询 15 秒等浏览器回执；等不到就抛 `TIMEOUT`，整个回答变成「地图操作未完成」。无人值守的客户端（脚本、未挂载的页面、关闭的标签页）永远不会回执，于是地点明明已经找到、卡片也已经发出，前端却只拿到一个错误。现在两处都改为返回 `false`，让模型直接用文字回答——卡片已经发布，用户照样能看到地点。

另外一处同样的问题：当本轮检索已经用掉大部分 D1 查询预算时，轮询会撞上 `RECEIPT_QUERY_SOFT_LIMIT`（40）并抛 `TIMEOUT`，现在也改为停止等待、直接回答。

验证：

| 问题 | 修复前 | 修复后 |
| --- | --- | --- |
| 「校内有哪些便利店？」 | `run.failed TIMEOUT`，无文字 | 「校内目前收录的便利店只有又康超市一家」 |
| 「打印店在哪？」 | `search_places ok:false` | 三饭打印店 / B栋打印店 / 伟腾图文 |
| 「快递点在哪？」 | `search_places ok:false` | 菜鸟驿站与中通快递都在生活区 |

`npm run map:route-metadata` 重新生成后 `publicPlaces=113`；`tests/unit/place-coverage.test.ts` 增加一条口语别名断言；全量 156 文件 / 1098 用例通过。

## 第四次复测（v8，2026-11-10）

`node .tmp/assistant-50-eval-v8.mjs` → `.tmp/assistant-50-results-v8.json`，`CONCURRENCY=2`。

| 指标 | v7 | v8 |
| --- | --- | --- |
| `answerMode=model` | 48 | **48** |
| `answerMode=no_evidence` | 2 | **2** |
| 失败码 | 0 | 0 |
| p50 | 19.2s | **18.7s** |
| p95 | 31.9s | **35.5s** |
| 最长 | 41.1s | **41.9s** |

剩余两道 `no_evidence` 都是**数据缺口**，不是链路缺陷：

- 「体育馆怎么预约，收费标准多少？」——知识库没有体育馆预约与收费内容。
- 「校内有银行网点或者 ATM 吗？」——知识库没有银行网点信息，地图也没有对应 POI。

这两题的兜底文案仍然是「本鱼目前没有检索到能回答这个问题的正文信息。已尝试的关键词：…」，读起来像机器而不是助手。下一轮可以把「确实是数据缺口」的兜底改成更自然的说法，并区分「本校没有」与「本站没有收录」。

## 第二轮 50 题（2026-11-12，全新问题集）

第一轮 50 题集中在党团、教务、图书馆、医保、宿舍、就业等事务流程。第二轮换一批**不同角度**的问题，覆盖选课与学籍、宿舍生活细节、校园餐饮、医疗、交通与地图、场馆与社团、通用建议与闲聊，用来检验泛化能力而不是复述第一轮的题干。

脚本 `.tmp/eval-round2.mjs`，题目 `.tmp/round2-questions.txt`，结果 `.tmp/assistant-round2-results.json`。每题独立游客会话，`CONCURRENCY=2`。

### 总览

| 指标 | 结果 |
| --- | --- |
| HTTP 200 | 50/50 |
| 空回答 | 0 |
| 工具调用 | 54 次（`knowledge` 51、`events` 2、`places` 1），全部成功 |
| `answerMode=model` | 39 |
| `answerMode=no_evidence` | 8 |
| `answerMode=event_list` | 1 |
| `answerMode=attributed_excerpt` | 1 |
| `answerMode=article_not_found` | 1 |
| `MODEL_SERVICE_UNAVAILABLE` | 1（「学生证丢了怎么办」） |
| 含引用 | 30/50 |
| 平均 / p50 / p95 / 最长 | 22.3s / 21.4s / 44.5s / 52.3s |

### 答得对的（节选）

- 「转专业需要什么条件，什么时候可以申请」——按学院方案给出申请时间、无违纪处分、不在休学/保留学籍期间、创新班不可再申请等条件，并附[1][2]。
- 「期末考试挂科了，补考和重修怎么安排」——区分补考资格、重修后仍不及格不得补考、缺考与违纪无资格、缓考两类处理。
- 「校园卡怎么充值」——数智广外公众号、广外一卡通小程序、企业微信三条渠道。
- 「宿舍钥匙丢了怎么办」——报备宿管单位、持证件到值班室借用备用钥匙并按时归还。
- 「校园里遇到紧急情况打哪个电话」——校内报警、保卫处、属地派出所、宿管、门诊部急诊。
- 「校医院能看牙吗」——白云山校区有口腔科，大学城校区没有。
- 「奖学金有哪些，怎么申请」「助学贷款怎么申请」——国家奖学金/励志奖学金金额与评定时间、生源地贷款额度与贴息规则。
- 「食堂可以用微信支付宝付款吗」——微信码已开通，支付宝未见说明。

### 暴露的缺陷

**1）闲聊与通用问题必搜。** 「你好呀，你今天心情怎么样」触发了两次 `search_campus_knowledge`，最后返回「目前没有检索到能回答这个问题的正文信息。已尝试的关键词：你好呀你今天心情怎么样」。根因是 `input-gate.ts` 的最后一行兜底返回 `campus`，而 `content-intent.ts` 的检索条件里有一条 `act === "general"`；两者叠加后，几乎任何一句话都会进入检索。`CHITCHAT` 只认「你是一只/大肥鱼/好饿/陪我聊」这类固定短语，「心情怎么样」不在其中。

**2）建议类问题被当成找文章。** 「宿舍太潮湿了，有什么除潮的办法」返回「当前公开资料中未找到这篇文章。可以检查标题，或提供原文链接。」根因是 `intent.ts` 的 `titleLike()`：只要句子 ≥12 字且以 `办法|方案|意见|报告|通知|公告…` 结尾就判为文章标题。这句话以「办法」结尾，于是 `articleLookup=true`，走了精确标题检索，命中不到就落进 `article_not_found`。

**3）通用建议被严格证据门禁拦住。** 「宿舍太潮湿了」「篮球场晚上开灯吗」「宿舍有人上门推销怎么办」「图书馆有充电插座吗」这类问题本可以先给通用做法再说明哪些需要核实，但 `answerRequirement` 在发生了检索时一律是 `strict`，只有命中「注意|建议|攻略|怎么办|注意事项」等词才是 `advisory`。真实链条是：检索没过 → `strict` 门禁拒答 → 兜底文案。

**4）数据缺口（不是链路缺陷）。** 打热水地点、清真食堂、夜宵、图书馆充电插座、宿舍洗衣机位置与热水时间、校车时刻表、地铁站路线、两校区通勤、共享单车入校规定、照相馆、体育馆预约收费、银行网点。这些题要么知识库没有正文，要么地图没有对应 POI。

**5）路由仍然偏知识库。** 「校车时刻表在哪里看」「大学城地铁站怎么走」「白云山校区和大学城校区之间怎么去」「校园里有照相馆或者打印照片的地方吗」全部只走 `search_campus_knowledge`，没有一次 `search_places`。「图书馆可以带包进去吗」反而走了 `search_places + knowledge`（`facilityListing` 之外的路径），方向反了。

**6）格式残留。** 「缓考要怎么申请」正文里出现 `[n]`（应为 `[1]`），说明 `normalizeCitations` 没有覆盖到该路径；同题无引用。

**7）一条失败。** 「学生证丢了怎么办」返回 `MODEL_SERVICE_UNAVAILABLE`，兜底为「本鱼这次没能把资料整理成可靠回答」，属于模型侧偶发失败，不是检索问题。

## 第二轮缺陷修复（2026-11-13）

针对上面 7 条缺陷，改了五处判定而不是加关键词，Preview 部署 `d035e871-fe6b-4fc0-a30f-3542b0ba6abe`，全量单测 156 文件 / 1109 用例通过。

| 现象 | 根因 | 改法 |
| --- | --- | --- |
| 闲聊「你好呀，你今天心情怎么样」也检索 | `input-gate.ts` 兜底返回 `campus`；`content-intent.ts` 让 `act === "general"` 直接进入检索 | `conversation-act.ts` 增加 `smallTalkToAssistant`：称呼本鱼 + 状态词且没有校园实体时判 `chitchat` |
| 「宿舍太潮湿有什么办法」被当文章标题，回「未找到这篇文章」 | `intent.ts` 的 `TITLE_ENDING` + `titleLike()`（长度 ≥12）把疑问句当标题 | `titleLike()` 开头用 `QUESTION_SHAPE` 拦掉疑问句式 |
| 50 题里 49 题都走 strict 事实门禁 | `content-intent.ts` 的 `answerRequirement` 只按 strictFact 粗分 | 引入 `advice` / `factualAsk`：「求建议且不问具体事实」判 advisory，事实型追问仍 strict |
| 「图书馆可以带包进去吗」被当地图请求 | `navigation-intent.ts` 的 `ROUTE_RE` 把「进去」当位移 | 新增 `MOVEMENT_COMPOUND`，先把「进去/出去/上去…」剔掉再判路线 |
| 正文里出现 `[n]` | 提示词里写了字面 `[n]`，模型照抄 | 提示词改成「编号引用（如 [1]）」 |
| no-evidence 文案像机器，且把「本站没收录」说成「学校没有」 | `evidenceFallback` 固定句式 | 改为「翻遍了已收录的广外资料……这不代表学校没有相关规定，只是本站还没收录到」，并过滤掉「把问题原样念回来」的伪关键词 |
| 转专业问句检索不到 | `query-plan.ts` 残留词清洗没有 `需要/需`，modifier 变成「转专业需」，任何文档都不匹配 | 清洗列表补 `需要|需`；同时 `query-understanding.ts` 拒绝「把整句当 subject」的 planner 结果 |

复测（`.tmp/assistant-round2-v4.json`，每题独立会话，失败自动重试一次）：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| `answerMode=model` | 39 | 39 |
| `no_evidence` | 8 | 7 |
| `article_not_found` | 1 | 0 |
| `MODEL_SERVICE_UNAVAILABLE` | 1 | 0 |
| 兜底文案回显问题本身 | 是 | 否 |
| 正文 `[n]` 残留 | 1 例 | 0 |
| `answerRequirement` 分布 | strict 49 / open 1 | strict 39 / advisory 7 / open 2 |
| 含编号引用 | 30/50 | 28/50 |
| p50 / p95 / max | 21.4s / 44.5s / 52.3s | 21.0s / 39.3s / 41.8s |

仍未解决、且已确认不是检索门禁问题：

1. **数据缺口 7 题**：打热水地点、清真食堂、夜宵、共享单车规定、图书馆能否带包、图书馆插座、篮球场夜间照明。D1 直查 `knowledge_chunks`：`清真` 全库只有 1 个 chunk 且是留学生游记里的「清真寺穹顶」，`夜宵` 0 chunk。这些题需要补采集，不是改代码。
2. **「毕业离校要办哪些手续」仍走 `attributed_excerpt`**：命中《关于2022届毕业生离校归还图书的通知》。现在引文会带上「（发布于 2022-05-09）」并保留「政策是否仍有效也要再核」，但用四年前的通知回答当年离校流程仍然勉强，属于知识库缺现行离校文件。
3. **「校门口打车方便吗，哪个门最近」仍只走知识库**：`facilityListing` 只覆盖快递/打印/超市一类服务点，校门与打车不在其中。
4. **评测偶发断流**：50 题里仍有 2 题 `status:0`（`TypeError: terminated`），单条重跑即 200。属并发下的连接中断，不计入答案质量，但评测脚本需要重试（已加，最多 3 次）。

一个必须记住的教训：**不要在评测进行中部署**。Worker 重载会掐断在途 SSE，一次部署就造出 21 条假失败（`status:0`），看起来像产品崩了。
