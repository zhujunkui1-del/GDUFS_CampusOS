# CampusOS 知识库与 Dify 问答流水线试点报告（2026-11-07）

> 只记录实际跑过并拿到结果的东西。所有数字都能在 `data/kb/` 下找到对应产物。
> 没验证过的判断一律写「未验证」。
>
> 流水线已发布到独立应用 `CampusOS 问答（OCR+向量）`（`15dce9e8`），
> **生产应用 `39945f9b` 未改动**。延迟仍是阻塞项，见 §8.2 与 §9。

## 1. 结论

| 项目 | 结果 |
|---|---|
| 文章全量扫描 | 1456 篇 / 115 个公众号 / 正文 200.2 万字 |
| OCR 补全 | 197 篇纯图片文章，196 篇跑完，278,655 字，61 篇最终入库 |
| 可入库文章 | economy / hq 两套各 **1164** 篇；OCR+向量一套 **1225** 篇 |
| Dify 知识库 | **15 个**（economy ×5、hq ×5、ocr+hq ×5），另有旧试点库未动 |
| 检索（47 题标题派生） | eco **0.851** → hq **1.000** → ocr+hq **1.000** |
| 检索（19 题自然问法） | eco **0.579** → hq **0.684** → ocr+hq **0.684** |
| 检索（40 题 OCR-only） | eco **0.000** → hq **0.000** → ocr+hq **1.000** |
| 候选流水线 | 8 节点：start → retrieve → fmt → gate → LLM → strip → answer |
| 候选回答（v3，关思考） | **47/47** 成功，47/47 带资源，**47/47** 命中金标，中位 37.4 s，P90 103.9 s |
| 生产基线 | 无检索，47/47 `n_resources=0`，且把思维链直接吐给用户 |
| 故障注入 | KB 不可用 → 0.8s 兜底；模型不可用 → 1.6s 兜底 |

最关键的一句：这次不是「优化现有检索」，而是从零加检索。生产 Chatflow 只有
`start → llm → answer`，没有任何知识库节点。所以所有对照都按「基线是坏的」来写，
不写「提升 x%」。

**真正的瓶颈从头到尾都不是切块，也不是路由，而是索引类型。** 把 economy 换成
high_quality（bge-m3）后，标题派生题集从 **0.851 直接到 1.000**，OCR-only 题集
从 **0.000 直接到 1.000**——这不是调 prompt 能追回来的差距。

---

## 2. 阶段一：文章扫描

数据源：`D:\WeChat MP Tools_v2.3.1\data\articles_full`（只读，未改动）
脚本：`scripts/kb_build/scan_articles.py`
产物：`data/kb/article_inventory.json`、`data/kb/article_texts.jsonl`、
`data/kb/article_processing_status.json`、`data/kb/article_audit_report.md`

| 指标 | 值 |
|---|---|
| HTML 文件 | 1456 |
| 公众号 | 115 |
| 正文总字符 | 2,002,402 |
| 正文中位数 | 938 |
| 文章形态 | general 635 / news 351 / notice 181 / event 180 / guide 93 / policy 16 |
| 空正文（<40 字） | 197，全部是纯图片文章（无任何可提取文本） |
| 短正文（40–199 字） | 58 |
| 检出 PII | 192 |
| content_hash 重复 | 121 |

年份分布：2026 年 1357 篇，2025 年 39 篇，2024 年 24 篇，2022 年 18 篇，
2023 年 9 篇，2021 年 5 篇，未知 4 篇。

**197 篇纯图片文章已在本轮补上**：起初确实是「无任何可提取文本」，
后来用 OCR 补了 **196 篇 / 278,655 字**，61 篇最终入库（见 §5 的 OCR 一节）。
稳定 ID = `sha1(规范化 URL)[:16]`；旧版微信 URL
（`?__biz=&mid=&idx=&sn=`）必须保留这四个参数，否则会全部塌成同一个 id
（本轮踩过，6 篇撞号，已修复并重跑全链路）。

---

## 3. 阶段二：分类体系

脚本：`scripts/kb_build/classify.py`（确定性关键词加权，不调用模型）
产物：`data/kb/article_classification.json`、`data/kb/article_classification_report.md`

每篇带 `primary_category` / `categories`(≤3) / `category_confidence` / `use_type` /
`temporal` / `has_deadline`，同时区分「主题」与「用途」。

**主题分布**：招生就业 312、校园活动 248、其他 204、科研学术 193、教务教学 136、
校园新闻与历史 63、党建思政 60、社团与学生组织 59、营销与商业推广 53、
学生事务 51、节日与祝福 43、校园生活 31、行政服务 3。

**用途分布**：资料存档 504、新闻资讯 354、办事指南 194、活动资讯 182、
通知公告 166、政策制度 56。

**时效**：长期 1195、近期（含截止表述）201、历史（2025 年前）60。

**低置信度（<0.5）**：487 篇。这是本轮已知短板：分类器只用关键词，没有语义模型，
对「只有标题、正文极短」的条目区分度不足。「其他」204 篇多是纯图片短文和泛校园
自媒体内容，属于合理归类。

---

## 4. 阶段三：清洗与切块

脚本：`scripts/kb_build/chunk.py`
产物：`data/kb/chunks/<分类>/<id>.md`、`data/kb/chunk_index.json`、
`data/kb/dify_import_manifest.json`

- **去重**：按 content_hash；跳过策略：纯图片、空正文、纯商业推广、过短、节日问候
- **分块**：按文章类型走不同策略（通知 / 指南 / 新闻 / 政策 / 活动 / 长文），
  在目标区间内不强行切段
- **块头**：每块首行 `《标题》｜公众号｜YYYY-MM-DD`，续块标「（续）」
- **元数据**：YAML frontmatter（title / source / publish_date / url / category /
 use_type / temporal）
- **去噪**：剔除「点击上方关注」「扫码关注」「阅读原文」「编辑/责编/审核/供稿」等尾注
- **PII**：手机号与身份证号脱敏；座机保留（办公电话本身是可用的校园信息）
- **结果**：1164 篇 → **4302 chunks**，均值 **497**
- **合并 OCR 后**：1225 篇 → **4561 chunks**（`data/kb/chunks_ocr/`、
  `data/kb/chunk_index_ocr.json`），多出的 61 篇正是 OCR 补进来的

---

## 5. 阶段四：Dify 知识库建设

通过 Dify Console API（`https://dify.gdufs.edu.cn`，owner 账号）建立。一共建了
**15 个库**，三套并行，原有库全部保留未动：

| 套 | 索引类型 | 文档数 | 用途 |
|---|---|---|---|
| `economy` | 倒排（关键词） | 1164 | D-143/D-144 约束下的第一版 |
| `hq` | high_quality + bge-m3 | 1164 | 同一语料，只换索引 |
| `ocr+hq` | high_quality + bge-m3 | **1225** | 同上，再加 OCR 补全的 61 篇 |

这样切是为了让「换索引」和「加 OCR」两个变量各自可归因，而不是搅在一起。

### 5.1 economy 套（D-143/D-144 约束下的第一版）

| 知识库 | dataset_id | 文档数 | word_count |
|---|---|---|---|
| CampusOS 制度与办事指南 | `c9a471e7-8490-4393-8612-f8976393ce9b` | 229 | 595,513 |
| CampusOS 教务与学生事务 | `8e601346-41b5-4847-810c-e86ba080497b` | 149 | 266,449 |
| CampusOS 校园活动与通知 | `d18dcdba-ca10-4288-a348-2255fd327a4d` | 361 | 622,188 |
| CampusOS 招生就业与升学 | `6feb8e36-f748-4d83-8fb5-4185eb661399` | 198 | 497,418 |
| CampusOS 校园新闻文化与生活 | `65543c02-ed96-46be-8b43-5d35e9be7ef3` | 227 | 373,606 |
| **合计** | | **1164** | **2,355,174** |

### 5.2 hq（向量索引，同一语料）

| 知识库 | dataset_id | 文档数 |
|---|---|---|
| CampusOS 制度与办事指南（向量索引） | `8498f126-1269-4495-be45-9e8e43de023b` | 229 |
| CampusOS 教务与学生事务（向量索引） | `5ec530e2-59d5-4ecc-b988-9b78d76d97be` | 149 |
| CampusOS 校园活动与通知（向量索引） | `77dbe959-9c7d-4e49-a887-115982af1620` | 361 |
| CampusOS 招生就业与升学（向量索引） | `594a61ef-4f6c-4e37-b0cf-72fa02559112` | 198 |
| CampusOS 校园新闻文化与生活（向量索引） | `6ce89309-66c4-4a5a-b3a9-ff16a1eed23b` | 227 |
| **合计** | | **1164** |

### 5.3 ocr+hq（最终交付版）

| 知识库 | dataset_id | 文档数 | word_count |
|---|---|---|---|
| CampusOS 制度与办事指南（OCR+向量） | `06a72bc7-2f65-40c4-a2fd-e303ce8b5b34` | 230 | 612,223 |
| CampusOS 教务与学生事务（OCR+向量） | `ba1e5317-59a9-4e7f-8713-fe77b4b26c0e` | 149 | 267,641 |
| CampusOS 校园活动与通知（OCR+向量） | `2bce2b4a-11af-4d0c-be98-c591b75e1957` | 372 | 644,274 |
| CampusOS 招生就业与升学（OCR+向量） | `542ba084-1155-414a-8fb1-b1ed4ffcff4a` | 225 | 567,934 |
| CampusOS 校园新闻文化与生活（OCR+向量） | `d4f2cb33-9ace-4dab-b15e-906730fe8fd9` | 249 | 414,095 |
| **合计** | | **1225** | **2,506,167** |

- **导入方式**：上传 `.md` → `POST /datasets/{id}/documents`，自定义分段参数
  `separator="\n=====\n"`、`max_tokens=3500`、`remove_extra_spaces=false`、
  `remove_urls_emails=false`
- **幂等**：以 dataset + article_id + state 文件为键，断点续跑；三套最终全部
  100% `completed`，三个失败清单文件都是空数组
- **原有知识库未动**：「CampusOS 校园知识试点」8 篇文档原样保留（未删未改）

### Embedding provider

`bge-m3`，通过 workspace custom model provider
`langgenius/openai_api_compatible/openai_api_compatible` 接入校内网关，
dim=1024，context_size=8192，status=active。实测 **token/char = 0.613**，
语料约 **131.1 万 tokens**。网关单请求上限 **8000 tokens**，超限报
HTTP 422 `当前请求token数:8110,已超过用户key最大token限制:8000`。

### OCR：197 篇纯图片文章

微信有相当一部分文章把整篇内容做成图片，HTML `body_text_chars` <40。这批文章
在最初两套统计里完全不可见。

做法：

1. **抓图**：正则 `<img[^>]+src="(https://[a-z0-9]+\.qpic\.cn/[^"]+)"`。必须匹配
   **子域**——早期写成 `mmbiz\.qpic\.cn`，25 篇被误判为「0 图」，实际有 **283**
   张图。必须带 `Referer: https://mp.weixin.qq.com/`，否则 CDN 拒绝。
2. **OCR**：走校内网关，提示词「把这张图片里的文字完整转录出来，按原顺序输出，
   不要总结、不要评论、不要补充；如果图片里没有文字，只输出空」。
3. **并发模型是「扁平 image-pool」**：一个 job = **一张图**，不是一篇一个 job。
   按篇分 job 时长文章（81 张图）会拖住 worker，短文章早已空闲。
4. **每篇完成立即落盘**：否则进程被 kill 会丢全部进度。

结果：

| 指标 | 数值 |
|---|---|
| OCR 完成篇数（≥40 字） | **196 / 197** |
| 其中单篇可用（≥40 字） | **175** |
| OCR 正文总量 | **278,655 字** |
| 清洗后最终入库 | **61 篇** |

「196 篇完成」和「61 篇入库」之间的差距来自合并后已有的清洗规则：商业推广 48、
正文过短 36、节日问候 10、图片型包装 16。剩下的部分才进库。

最长的一篇是「革命理想高于天」，**21,649 字**，来自 81 张图的超长图集——
这正是纯文本管线会整篇丢掉的情况。

唯一彻底失败的是 `e5974f261cdf9c34`（康师傅抢票攻略），另有若干张图未能返回文字。

### OCR 对两套主题集没有影响，这是设计如此

标题派生题集和自然问法题集的 gold 全部取自本来就有正文的文章，所以纯 OCR 文章
在结构上不可能成为这两套题的 gold。这不是 OCR 的问题，是题集设计的必然。

为此专门建了 `eval_set_ocr.json`（n=40），gold 只从 OCR-only 文章里抽，
数字见 §6。

### 已踩实的 Dify API 契约

1. economy（倒排）库的 `semantic_search` / `hybrid_search` hit-testing **恒返回
   空 records**；只有 `keyword_search` + `reranking_enable=false` 能召回，且
   score 恒为 **0.0**。这意味着 economy 库**无法用 score 做阈值过滤**。
2. `max_tokens=4096` → **0 segments**；2000 / 3500 / 3900 正常。
   `remove_extra_spaces=true` + 小 `max_tokens` 会把中文插空格并切碎。
3. economy 库的 `POST /v1/datasets/{id}/documents/create_by_text` 不可用；
   必须走 `upload_file` + `data_source.info_list.file_info_list.file_ids`（是 dict，
   不是 list）。
4. Console API 写操作必须带 `X-CSRF-Token`（取自 `__Host-csrf_token` cookie），
   否则报 `CSRF token is missing or invalid`。
5. `POST /console/api/apps/{id}/workflows/draft` 第二次保存必须带 `hash`，
   否则报 `409 draft_workflow_not_sync`。
6. **新建应用默认 `features.retriever_resource = false`**。不开这个开关，
   `/v1/chat-messages` 返回的 `metadata.retriever_resources` **恒为空数组**——
   看起来在正常回答，其实一条引用都没有。必须显式设置
   `{"retriever_resource": {"enabled": true}}`。
7. **知识库没有导出接口**。`GET /console/api/datasets/{id}/export` → **404**。
   交付只能靠本地语料，或逐文档 API 重建。

---

## 6. 阶段五：检索评测

### 方法

直接用 Dify 的 hit-testing API，绕开 LLM，把「检索质量」和「生成质量」分开。
三套题，三套后端：

| 题集 | 文件 | n | 说明 |
|---|---|---|---|
| 标题派生 | `data/kb/eval_set.json` | 47 | 真实文章标题 + 分类模板，分层抽样 |
| 自然问法 | `data/kb/eval_set_natural.json` | 19 | 按学生真实问法手写，人工指定 gold |
| OCR-only | `data/kb/eval_set_ocr.json` | 40 | gold 只从 OCR-only 文章里抽 |

三套题都在三套后端上跑，top_k=5。这样「换索引」和「加 OCR」两个变量各自可归因。

### 结果

| 后端 | 标题派生（47） | 自然问法（19） | OCR-only（40） |
|---|---|---|---|
| `eco`（倒排） | **0.851**（40/47） | **0.579**（11/19） | **0.000**（0/40） |
| `hq`（bge-m3） | **1.000**（47/47） | **0.684**（13/19） | **0.000**（0/40） |
| `ocr+hq`（bge-m3 + OCR） | **1.000**（47/47） | **0.684**（13/19） | **1.000**（40/40） |

recall@any：eco 47 题 0.957、自然题 0.684；hq 两套都是 1.000 / 0.684；
ocr+hq 与之相同。

**三个读法：**

1. **换索引是唯一有效的那一步。** 标题派生题集从 0.851 直接到 1.000，一次到位。
   这不是调 prompt、改切块、加分桶能追回来的。
2. **OCR-only 的 0.000 → 1.000 不是「提升」，是从「压根没有这些文档」到「有了」。**
   前两套后端里根本没有这些文档，所以分数必然是 0——不是检索失败，是文档不存在。
3. **自然问法没有被 Embedding 救回来。** 0.579 → 0.684，只多了两题。
   这是本轮最反直觉的一条：向量检索解决了「字面对不上」，没解决「问的和写的
   不是同一件事」。

### 自然问法为什么只到 0.684

把 hq 的 6 个 miss 逐条看了一遍（n-011 / n-014 / n-015 / n-017 / n-019 / n-020），
它们的 gold 文档**全部在语料里**。失败原因是语义近邻干扰：

- 「宿舍条件怎么样」→ gold 是「宿舍默契大比拼活动」，而检索到的是「宿舍文化节」
  「新宿舍入住」这类更贴切的文档。
- 「招生政策」→ eco 命中、hq 反而 miss（n-020），典型的向量检索副作用。

也就是说，剩下的差距一部分是**题目本身的问题**（gold 选得牵强），一部分是
**Dify top_k=5 截断**。要再往上走，需要 rerank（`bge-reranker-v2-m3` 已在
workspace 里注册但未启用），而不是继续换 embedding。

### 两个推翻了原假设的发现

**1. 路由分桶完全没用。** 原本设计了一个「按问题选库」的层。实测：全库同时检索的
recall@5 = **0.851**，与 oracle 路由桶的 recall@5 = **0.851** 完全相同。路由一分
钱没赚，最终版**整层删除**。

**2. 标题回声并没有抬高分数。** 审查意见认为标题回声题抬高了 recall@5。分开统计：
标题回声题（18 条）recall@5 = **0.778**，同题集里的模板化自然问法（29 条）
recall@5 = **0.898**。**结论相反——标题回声反而更难**。照实写进报告。

---
## 7. 阶段六：候选工作流

### 最终结构（`data/kb/candidate_dsl_ocr_notink.json`，8 节点 / 8 边）

```
start ──► retrieve（知识检索，5 个库，top_k=6）
   │           │
   │           ├──► fmt（代码：把检索结果整理成带编号的证据段）
   │           │        │
   │           │        ├──► gate（if-else：证据段是否为空）
   │           │        │        ├── true ──► fallback（兜底话术）
   │           │        │        └── false ─► ans_llm（LLM，temp 0.3，max_tokens 2560）
   │           │        │                          └──► strip（代码：剥掉思考痕迹）
   │           │        │                                    └──► answer
   │           └─ fail-branch ──► fallback（检索层异常时直接兜底）
```

节点清单：`start` / `retrieve` / `fmt` / `gate` / `fallback` / `ans_llm` / `strip` / `answer`。
边：`start→retrieve`、`retrieve→fmt`、`retrieve→fallback`(fail-branch)、
`fmt→gate`、`gate→fallback`(true)、`gate→ans_llm`(false)、`ans_llm→strip`、`strip→answer`。

### 试过但被否决的方案

| 方案 | 结果 |
|---|---|
| LLM 分类器 + 分桶检索 | 分类器 JSON 解析失败率高，一半的运行崩掉；且分桶对检索无收益 |
| 纯关键词路由（`nodes/route.py`） | 准确率只有 **17/47（33%）**；保留为参考实现，写明为何不用 |
| `max_tokens=1536` | 约 25% 的运行答案被截断成空串；提到 2560 后不再出现 |
| 只在提示词里写 `/no_think` | **对 Qwen3.8-27B 完全无效**，思维链照样生成 |
| `reasoning_effort: "none"` / `thinking: {type: disabled}` / `extra_body` | 全部无效 |

### 关掉思考的唯一有效办法

实测四种写法，只有一种真的让 `content > 0` 且 `reasoning = 0`：

```json
"completion_params": {
  "chat_template_kwargs": {"enable_thinking": false},
  "max_tokens": 2560,
  "temperature": 0.3
}
```

Dify 的 llm 节点能把这个字段存进 draft 并持久化（GET draft 确认过），也确实生效。
这是本轮唯一一个「配置对了就立刻见效」的优化。

### 关键 Dify 契约

- `knowledge-retrieval` 的 `query_variable_selector` **必须用 `["sys","query"]`**，
  用 `["start","query"]` 会报 `Query variable is not string type.`
- `answer` 节点必须同时写 `"answer": "{{#strip.out#}}"` 和
  `"variables": ["retrieve.result"]`（扁平点号字符串），否则前端不显示引用来源。
- LLM 节点必须 `"context": {"enabled": true, "variable_selector": ["retrieve","result"]}`，
  否则 `/v1/chat-messages` 的 `metadata.retriever_resources` 恒为 `[]`。
- 代码节点里不能出现 `\n` 字面量或 `</think>`（会被上游吃掉），要用
  `chr(10).join(...)` 和 `'<' + '/think' + '>'`。
- LLM fail-branch 的 `default_value` 必须是 **list**
  `[{"key": "text", "type": "string", "value": "..."}]`，否则 pydantic 报
  `Input should be a valid list`。

---
## 8. 阶段七：新旧对照与故障注入

### 8.1 新旧对照（同一套 47 题，同一时间窗）

| 指标 | 生产版（`39945f9b`） | 候选 v4（`fbe5ce39`） | 候选 v3（`15dce9e8`，关思考） |
|---|---|---|---|
| 成功运行 | 47 / 47 | 46 / 47 | **47 / 47** |
| 返回检索资源的运行 | **0 / 47** | **46 / 47** | **47 / 47** |
| 金标出现在检索结果里 | —（无检索） | **45 / 46** | **47 / 47** |
| 空答案 | 0 | 0 | **1** |
| 答案平均长度 | 933 字 | 659 字 | **752 字** |
| 中位延迟 | **16.9 s** | 37.9 s | **37.4 s** |
| P90 延迟 | **32.0 s** | 100.1 s | **103.9 s** |
| 平均延迟 | 18.4 s | 48.7 s | 45.9 s |
| 网关超时 | 0 | 1（q-017，504） | **0** |

**生产版的实际表现**（不是抽象描述，是原文摘录）：

- 47/47 全部 `n_resources=0`，也就是**没有任何知识库依据**。
- 答案里直接漏出思维链，例如：

> 用户询问的是"2026年东莞市政法系统政治轮训在广外顺利举办的情况是怎样的?"
> 我需要分析这个问题: 1. 时间:2026年(未来时间) 2. 事件:东莞市政法系统政治轮训 …

也就是说，生产版**既没有依据，也没有把思考过程藏起来**。

### 8.2 延迟：唯一真正的代价

`chat_template_kwargs.enable_thinking=false` 修好了「答案泄漏思维链」，
但**没有修好延迟**：

| 版本 | 中位 | P90 | 说明 |
|---|---|---|---|
| 生产（无检索） | 16.9 s | 32.0 s | 只有一次 LLM |
| v2（开资源引用） | 36.2 s | 121.7 s | 检索 + LLM，思维链仍在 |
| v3（关思考） | **37.4 s** | **103.9 s** | P90 只从 121.7 降到 103.9 |

关思考只把 P90 从 121.7 s 压到 103.9 s，离生产基线还很远。原因不在模型本身，
而在**链路变长了**：`knowledge-retrieval`（5 个向量库）→ LLM → 代码节点，
每一跳都是串行。bge-m3 embedding、Qwen3.8-27B 推理、网关排队三者叠加，
P90 就是这么来的。

次要原因是网关抖动。v3 自然集那批跑 19 题，7 题直接 `URLError`（连接失败，
不是业务错误）；同一时段 OCR-only 集只错 1 题。这与模型选择无关。

### 8.3 自然问法子集（19 题）

| 指标 | v3（关思考） |
|---|---|
| 成功运行 | 12 / 19 |
| 返回引用 | 12 / 12 |
| 金标命中 | **11 / 12** |
| 明确拒答 | 1 / 12 |
| 平均延迟 | 50.9 s |

12 题里 11 题命中金标，命中率 92%。这个数字比 v4 的 8/17 高得多，但**样本太小，
不能直接比较**——v3 那批 7 题是 `URLError`，恰好是尾部的题（n-014…n-020），
把它们剔掉等于只看了前面更容易的题。所以这里只写「12 题里 11 题命中」，
不写「命中率提升」。

### 8.4 OCR-only 集（40 题）

| 指标 | v3 |
|---|---|
| 成功运行 | 39 / 40 |
| 返回引用 | 39 / 39 |
| 金标命中 | **39 / 39** |
| 空答案 | 2 |
| 中位延迟 | 45.3 s |
| P90 | 60.0 s |

39/39 全中，且 P90 只有 60 s——比标题派生集还快。原因是 OCR-only 文章篇幅短、
主题集中，向量检索几乎不会跑偏。

### 8.5 故障注入

| 场景 | 做法 | 结果 |
|---|---|---|
| KB 不可用 | dataset_ids 换成不存在的 UUID | **0.8 s** 返回兜底话术，不崩 |
| 模型不存在 | LLM 指向不存在的模型名 | Dify **前置校验**直接拒绝（HTTP 400 `Model no-such-model-xyz not exist.`），不进 runtime |
| 模型运行时失败 | LLM 指向真实但不可用的 DeepSeek-V4-Flash-0731 + fail-branch | **1.6 s** 返回兜底话术 |

两个测试应用是临时产物：
- `CampusOS KB-down test`（`5b2f78d3-5e58-4e59-b990-7912a2925402`）
- `CampusOS LLM-down test`（`c1482c93-1a05-4d21-8ed2-4499051eebc9`）

**关于 fail-branch**：候选版保留了 `knowledge-retrieval` 的
`error_strategy: "fail-branch"`，并有一条 `retrieve --fail-branch--> fallback`
的边。中途一度以为它会让 `retriever_resources` 变空，后来查明是评测脚本读错了
字段（应从 `metadata.retriever_resources` 取，不是顶层），失败分支本身正常。

---

## 9. 阶段八：发布门禁

**交付状态：候选流水线已发布并可用，生产应用未动。**

| 应用 | id | site code | 状态 |
|---|---|---|---|
| CampusOS 问答（OCR+向量） | `15dce9e8-ab4d-4375-8630-2b1a4c343220` | `3a2B9Dxoh5rKh5yv` | **交付版**，已发布 |
| CampusOS 知识库问答（候选 v2） | `fbe5ce39-c204-47df-9409-c179c4abfce9` | `DIhuumJzwkedARXQ` | 中间版本，保留 |
| 广外通·校园助理（Dify试点） | `39945f9b-9ee0-4c2c-a3a0-fc5298b3f861` | `jjHrO04CLQMHlog7` | **生产，未改动** |

公开访问：`https://dify.gdufs.edu.cn/chat/3a2B9Dxoh5rKh5yv`（实测 HTTP 200）。

**交付版冒烟测试**（2026-11-07 23:59，`/v1/chat-messages` blocking）：

| 项 | 结果 |
|---|---|
| 问题 | 「校园网怎么开通？」 |
| 延迟 | **29.1 s** |
| 返回引用 | **6 条** |
| 答案长度 | 492 字 |
| 质量 | 明确说「资料里没有单独写『开通』按钮」，然后给出缴费路径并带 `[1]``[3]``[6]` 引用——**不编造** |

### 回滚方案

```
backups/dify/workflow_dsl_20261106_before.yml    # production DSL, before any change
backups/dify/workflow_draft_20261106_before.json # production draft, before any change
```

生产应用 `39945f9b` **至今未改动**：它的 graph 仍然是 `start → llm → answer`
三个节点。所有改动都在独立应用里，最坏情况是弃用新应用，生产零影响。

### 仍未做的三件事

1. **没有把候选流水线覆盖到生产应用。** P90 = 103.9 s vs 生产 32.0 s，
   直接换会明显劣化体验。需要先解决延迟。
2. **没有启用 rerank。** `bge-reranker-v2-m3` 已在 workspace 注册但未接进
   检索节点。自然问法剩下的差距更可能靠 rerank + top_k=10 解决，而不是换模型。
3. **没有做线上灰度。** Dify Community Edition，没有 A/B 分流能力。

---

## 10. 风险与遗留

| 风险 | 状态 |
|---|---|
| P90 = **103.9 s**，生产基线 32.0 s | **已知，阻塞发布** |
| 自然问法 recall@5 仅 **0.684**（换向量后仍卡在这里） | 已知，需 rerank 或更好的 gold |
| Dify→Cloudflare 外部知识 API 仍失败，见 docs/BLOCKERS.md | 与本试点无关，仍开放 |
| 网关抖动：自然集 7/19 报 `URLError` | 已知，属网络侧 |
| `bge-m3` 单请求上限 **8000 tokens** | 已知，属网关限制 |
| 网关 `/v1/chat/completions` **60 s 硬超时** | 已知，返回 HTTP 504 HTML |
| 分类置信度 <0.5 的 **487 篇** | 已知，需语义分类器 |
| Dify 社区版无知识库导出接口（`404`） | 已知，交付用本地语料 |

---

## 11. 离线交付包（评委打不开网站时的兜底）

负责人要求：万一评委打不开项目网站，就把 Dify 智能体本身作为作品交出去。
脚本 `scripts/kb_build/pack_delivery.py`，输出到
`C:\Users\zhuju\Desktop\v我50_朱俊魁_CampusOS(广外通)\安装包等文件\04_dify智能体\`。

| 文件 | 内容 |
|---|---|
| `CampusOS_dify_delivery.zip` | 1,229 个条目 / 3.3 MB，`testzip` 通过 |

zip 内结构：

```
01_DSL/CampusOS_agent.yml          12,625 bytes / 451 行（应用工作流 DSL）
01_DSL/plugin_requirements.txt     必须预装的插件
02_知识库/<库名>/<article_id>.md   1225 篇，9.2 MB
03_清单/articles.csv               1225 行，UTF-8-sig
03_清单/README.md                  导入说明
```

**为什么必须这么交付**：Dify 社区版**没有知识库导出接口**
（`GET /console/api/datasets/{id}/export` → 404），所以只能把本地切好的
`data/kb/chunks_ocr/` 原样打包；DSL 里 `dataset_ids` 是**加密串**，导入后必须
重新绑定知识库，所以 README 里必须写清「先建库、再导入、再改 DSL」的顺序。

**两个坑**：

- 文件名用中文标题会跨平台出问题，改用 `article_id.md`。
- 源文件按 `category` 分目录，而 Dify 的库是按 `bucket` 分，两者不相等，
  必须经 `kb_import_state_hqocr.json` 映射，不能直接按目录搬。

**zip 内 README 的实测数据表**最初只写了两列（economy / high_quality），
缺 ocr+hq 这一列，已就地更正为三列（0.851 / 0.579 / 0.000 →
1.000 / 0.684 / 1.000），并补上 OCR-only 集的端到端结果（39/40、
中位 45.3 s、P90 60.0 s）。zip `testzip` 复检通过，条目数仍为 1,229。

**分库核对**（来自 zip 实际条目）：制度与办事指南 230、教务与学生事务 149、
校园活动与通知 372、校园新闻文化与生活 249、招生就业与升学 225，合计 1,225。


