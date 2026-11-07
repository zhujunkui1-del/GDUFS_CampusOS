# CampusOS 知识库与 Dify 问答流水线试点报告（2026-11-07）

> 只记录实际跑过并拿到结果的东西。所有数字都能在 `data/kb/` 下找到对应产物。
> 没验证过的判断一律写「未验证」。候选流水线尚未发布到生产，等负责人确认。

## 1. 结论

| 项目 | 结果 |
|---|---|
| 文章全量扫描 | 1456 篇 / 115 个公众号 / 正文 200.2 万字 |
| 可入库文章 | 1164 篇（去重、跳过纯图片、纯广告、过短） |
| 切块 | 4302 块，最短 99 / 中位 395 / 最长 1171，均值 497 |
| Dify 知识库 | 新建 5 个（economy 倒排索引），合计 1164 篇文档，重名 0 |
| 检索（全库 top5） | 47 题 recall@5 = 0.851；19 题自然问法 recall@5 = 0.579 |
| 候选流水线 | 8 节点：start → retrieve → fmt → gate → LLM → strip → answer |
| 候选回答 | 46/46 带检索资源，45/46 命中金标文章，0 条空答案 |
| 生产基线 | 无检索，47/47 n_resources=0，且把思维链直接吐给用户 |
| 故障注入 | KB 不可用 → 0.8s 兜底；模型不可用 → 1.6s 兜底 |

最关键的一条：这次不是「优化现有检索」，而是从零加检索。生产 Chatflow
只有 start → llm → answer，没有任何知识库节点。所以所有对照都按「基线是坏的」
来写，不写「提升 x%」。

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

**已知缺口**：197 篇纯图片文章无法入库，需要 OCR 或人工补录。本轮不计入
「已覆盖」，也不假装它们存在。稳定 ID = `sha1(规范化 URL)[:16]`；旧版微信
URL（`?__biz=&mid=&idx=&sn=`）必须保留这四个参数，否则会全部塌成同一个 id
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

---

## 5. Dify 知识库建设

通过 Dify Console API（`https://dify.gdufs.edu.cn`，owner 账号）建立，全部为
**economy（倒排）索引**，符合 D-143/D-144 的「免 Embedding」约束。

| 知识库 | dataset_id | 文档数 | word_count |
|---|---|---|---|
| CampusOS 制度与办事指南 | `c9a471e7-8490-4393-8612-f8976393ce9b` | 229 | 595,513 |
| CampusOS 教务与学生事务 | `8e601346-41b5-4847-810c-e86ba080497b` | 149 | 266,449 |
| CampusOS 校园活动与通知 | `d18dcdba-ca10-4288-a348-2255fd327a4d` | 361 | 622,188 |
| CampusOS 招生就业与升学 | `6feb8e36-f748-4d83-8fb5-4185eb661399` | 198 | 497,418 |
| CampusOS 校园新闻文化与生活 | `65543c02-ed96-46be-8b43-5d35e9be7ef3` | 227 | 373,606 |
| **合计** | | **1164** | **2,355,174** |

- **导入方式**：上传 `.md` → `POST /datasets/{id}/documents`，自定义分段参数
  `separator="\n=====\n"`、`max_tokens=3500`、`remove_extra_spaces=false`、
  `remove_urls_emails=false`
- **幂等**：以 dataset + 文件名 + state 文件为键，断点续跑；最终状态 100% `completed`
- **失败清单**：`data/kb/dify_import_failures.json` 为空数组
- **索引核验**：逐页翻完并**按名去重**，五个库的文档数与上表逐一相等，重名 0
- **原有知识库未动**：「CampusOS 校园知识试点」8 篇文档原样保留（未删未改）

### 已踩实的 Dify API 契约

1. economy（倒排）库的 `semantic_search` / `hybrid_search` hit-testing **恒返回空
   records**；只有 `keyword_search` + `reranking_enable=false` 能召回，且 score
   恒为 0.0。五个库全部定为后者。
2. `max_tokens=4096` → **0 segments**；2000 / 3500 / 3900 正常。
   `remove_extra_spaces=true` + 小 `max_tokens` 会把中文插空格并切碎。
3. `POST /v1/datasets/{id}/documents/create_by_text` 在 economy 库不可用；
   必须走 `upload_file` + `data_source.info_list.file_info_list.file_ids: []`
   （是 dict，不是 list）。
4. Console API 写操作必须带 `X-CSRF-Token`（取自 `__Host-csrf_token` cookie），
   否则 `CSRF token is missing or invalid`。
5. `POST /console/api/apps/{id}/workflows/draft` 第二次保存必须带 `hash`，
   否则 `409 draft_workflow_not_sync`。

---

## 6. 阶段五：检索评测

### 方法

直接用 Dify 的 hit-testing API，绕开 LLM，把「检索质量」和「生成质量」分开。
两套题：

1. **标题派生题集**（`data/kb/eval_set.json`，n=47）：按真实文章标题 + 分类模板
   生成，分层抽样。
2. **自然问法题集**（`data/kb/eval_set_natural.json`，n=19）：按学生的真实问法
   手写，人工指定金标文章。

两套都在同样的五个库上以 top_k=5 检索。

### 结果

| 题集 | recall@5 | recall@any |
|---|---|---|
| 标题派生（n=47） | **0.851** | 0.957 |
| 自然问法（n=19） | **0.579** | 0.684 |

### 两个推翻了原假设的发现

**1. 路由分桶完全没用。** 原本设计了一个「按问题选库」的路由层。实测发现：
全库同时检索的 recall@5 = **0.851**，与 oracle 路由桶的 recall@5 = **0.851**
完全相同。路由一分钱没赚，最终版**整层删除**。

**2. 标题回声并没有抬高分数。** 审查意见认为标题回声题抬高了 recall@5。分开统计：
标题回声题（18 条）recall@5 = **0.778**，同题集里的模板化自然问法（29 条）
recall@5 = **0.898**。**结论相反——标题回声反而更难**。这一点照实写进报告。

### 自然问法为什么只有 0.579

五个库是倒排索引，靠字面重合。自然问法里「校园卡丢了怎么补办」与金标文章
「校园卡补办」重合度不够。这是 economy 索引的固有局限，不是数据问题。
启用 Embedding 需要负责人另行授权（D-143 明确写了必须单独确认）。

---

## 7. 阶段六：候选工作流

### 最终结构（`data/kb/candidate_dsl.json`，8 节点 / 8 边）

```
start ──► retrieve（知识检索，五个库，top_k=6）
              │
              ├──► fmt（代码：把检索结果整理成带编号的证据段）
              │        │
              │        ├──► gate（if-else：证据段是否为空）
              │        │        ├── true ──► fallback（兜底话术）
              │        │        └── false ─► ans_llm（LLM，temp 0.3，max_tokens 2560）
              │        │                          └──► strip（代码：剥掉思考块）
              │        │                                    └──► answer（{{#strip.out#}}）
```

### 试过但被否决的方案

| 方案 | 结果 |
|---|---|
| LLM 分类器 + 分桶检索 | 分类器 JSON 解析失败率高，一半的运行崩掉；且分桶对检索无收益 |
| 纯关键词路由（`nodes/route.py`） | 准确率只有 **17/47（33%）**；保留为参考实现，写明为何不用 |
| knowledge-retrieval 自带 fail-branch | **最终保留**（中途一度误判为导致资源变空，实为评测脚本 bug） |
| `max_tokens=1536` | 约 25% 的运行答案被截断成空串；提到 2560 后不再出现 |

### 关键 Dify 契约

- `knowledge-retrieval` 的 `query_variable_selector` **必须用 `["sys","query"]`**，
  用 `["start","query"]` 会报 `Query variable is not string type.`
- `answer` 节点必须同时写 `"answer": "{{#strip.out#}}"` 和
  `"variables": ["retrieve.result"]`，否则前端不显示引用来源。
- LLM 节点必须 `"context": {"enabled": true, "variable_selector": ["retrieve","result"]}`，
  否则 `/v1/chat-messages` 的 `metadata.retriever_resources` 恒为 `[]`。
- 代码节点里不能出现 `\n` 字面量或 `</think>`（会被上游吃掉），要用
  `chr(10).join(...)` 和 `'<' + '/think' + '>'`。

---

## 8. 阶段七：新旧对照与故障注入

### 8.1 新旧对照（同一套 47 题，同一时间窗）

| 指标 | 生产版 | 候选版 |
|---|---|---|
| 返回检索资源的运行 | **0 / 47** | **46 / 47** |
| 金标文章出现在检索结果里 | —（无检索） | **45 / 46** |
| 答案平均长度 | 933 字 | 659 字 |
| 中位延迟 | 16.9 s | **37.9 s** |
| P90 延迟 | 32.0 s | **100.1 s** |
| 网关超时（504） | 0 | **1**（q-017） |

**生产版的实际表现**（不是抽象描述，是原文摘录）：

- 47/47 全部 `n_resources=0`，也就是**没有任何知识库依据**。
- 答案里直接漏出思维链，例如：
  > 用户询问的是"2026年东莞市政法系统政治轮训在广外顺利举办的情况是怎样的?"
  > 我需要分析这个问题: 1. 时间:2026年(未来时间) 2. 事件:东莞市政法系统政治轮训 …
- 也就是说，生产版现在**既没有依据，也没有把思考过程藏起来**。

**候选版的代价**：中位延迟从 16.9 s 涨到 37.9 s，P90 从 32 s 涨到 100 s。
原因是 Qwen3.8-27B 会先生成大段思维链，再由 `strip` 节点剥掉。这是真实的
用户体验退化，不是可以忽略的细节。**如果要上线，需要先解决延迟**（见第 10 节）。

### 8.2 自然问法子集（19 题）

| 指标 | 候选版 |
|---|---|
| 返回检索资源 | 17 / 17（成功的） |
| 金标命中 | **8 / 17** |
| 拒答（明确说资料里没有） | 12 / 17 |
| 平均延迟 | 48.8 s |

自然问法下金标命中率只有 47%，与检索层的 recall@5 = 0.579 吻合。**拒答题多
不是坏事**——它宁可说不知道，也不编。但这意味着自然问法场景下可用性还不够。

### 8.3 故障注入

| 场景 | 做法 | 结果 |
|---|---|---|
| KB 不可用 | dataset_ids 换成不存在的 UUID | **0.8 s** 返回兜底话术，不崩 |
| 模型不可用 | LLM 指向不存在的模型名 | Dify **前置校验**直接拒绝（HTTP 400 `Model no-such-model-xyz not exist.`），不进 runtime |
| 模型运行时失败 | LLM 指向真实但不可用的 DeepSeek-V4-Flash-0731 + fail-branch | **1.6 s** 返回兜底话术 |

两个测试应用是临时产物：
- `CampusOS KB-down test`（id `5b2f78d3-5e58-4e59-b990-7912a2925402`）
- `CampusOS LLM-down test`（id `c1482c93-1a05-4d21-8ed2-4499051eebc9`）

**关于 fail-branch**：候选版保留了 `knowledge-retrieval` 的 `error_strategy:
"fail-branch"`，并有一条 `retrieve --fail-branch--> fallback` 的边。中途一度以为
它会让 `retriever_resources` 变空，后来查明是评测脚本读错了字段（应从
`metadata.retriever_resources` 取，而不是顶层），失败分支本身是正常的。

---

## 9. 阶段八：发布门禁

候选流水线**已保存并发布到候选应用**（`fbe5ce39-c204-47df-9409-c179c4abfce9`，
key `app-gXXxUzNmOiYSxX0dLtbLDlA5`），但**没有覆盖生产应用**。

### 回滚方案

```
backups/dify/workflow_dsl_20261106_before.yml    # production DSL, before any change
backups/dify/workflow_draft_20261106_before.json # production draft, before any change
```

生产应用 `39945f9b-9ee0-4c2c-a3a0-fc5298b3f861` **至今未改动**：它的 graph
仍然是 `start → llm → answer`，三个节点。候选版的全部改动都在独立应用里。

### 发布前需要负责人拍板的三件事

1. **延迟**：P90 = 100 s。生产同样的问题现在是 32 s。要不要接受？
2. **模型**：`Qwen3.8-27B` 不支持关思考；`DeepSeek-V4-Flash-0731` 在模型网关
   上注册了但实际调用报 `Model not found`。要压低延迟，得先确认校内网关到底
   哪个模型的 thinking 能关掉。
3. **覆盖率**：自然问法 recall@5 = 0.579。要么接受「经常说不知道」，要么申请
   启用 Embedding（需 D-143 之外的授权）。

---

## 10. 风险与遗留

| 风险 | 状态 |
|---|---|
| 197 篇纯图片文章未入库，需 OCR 或人工补录 | 已知，未覆盖 |
| 自然问法 recall@5 仅 **0.579** | 已知，需 Embedding 或更好的切块 |
| P90 延迟升到 **100 s** | 已知，**阻塞发布** |
| 倒排索引对所有结果都返回 score **0.0**，无法按相关性阈值过滤 | 已知，属架构限制 |
| 分类置信度 < 0.5 的 **487** 篇 | 已知，需语义分类器 |
| Dify→Cloudflare 外部知识 API 调用仍失败，见 docs/BLOCKERS.md | 与本试点无关，仍开放 |
