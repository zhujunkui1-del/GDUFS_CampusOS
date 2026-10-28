# 搜索服务调研与接入建议（2026-10-29）

目标：提高 AI 助理的**中文校园信息覆盖面**与**低置信度回答**问题，优先不改现有 Agent/RAG 架构、不新增常驻服务、不产生未经批准的费用。

现有能力：自研 D1 检索（FTS/词项/规则重排）＋ Exa 网页搜索（云端已通过 `https://mcp.exa.ai/mcp` 接入）＋ 小红书原生只读后端。现有外部搜索的问题是：中文校园站点覆盖不稳定、结果常为空或偏离（如"大型体育赛事"零命中）、缺少摘要与发布时间。

## 候选对比（只列已核实的价格）

| 服务 | 中文覆盖 | 价格（已核实） | 返回内容 | 适配 Cloudflare Workers |
| --- | --- | --- | --- | --- |
| 智谱 Web Search API | 强（自研 + 搜狗/夸克） | `search_std` 0.01 元/次；`search_pro` 0.03 元/次；搜狗/夸克 0.05 元/次 | 标题、URL、摘要 `content`、站点 `media`、`publish_date`，支持条数/域名/时间范围/摘要长度 | 是，纯 HTTPS；另有官方 MCP |
| Tavily | 中（英文/全球更强） | 免费 1,000 credits/月；basic 搜索 1 credit/次；超出 $0.008/credit | 标题、URL、内容片段、发布时间 | 是，官方 MCP 与 REST |
| Exa（已接入） | 中 | 免费 $10/月（约 2,500 次 lite）；lite $4/千次，auto $7/千次 | 语义搜索、正文/摘要 | 是，已在用 MCP |
| 博查 Bocha | 强（中文） | 未能核实（定价页需登录） | 中文网页结果 | 待核实 |

参考：[智谱联网搜索文档](https://docs.bigmodel.cn/cn/guide/tools/web-search.md)、[智谱定价](https://docs.bigmodel.cn/cn/guide/start/pricing.md)、[Tavily Credits](https://docs.tavily.com/documentation/api-credits)、[Exa Pricing](https://exa.ai/docs/reference/pricing.md)。

## MCP 还是 API

MCP 是传输协议，不是搜索源。本项目的 Worker 已经用 MCP 调 Exa；对新增服务，**直接 REST 更简单**：少一层 JSON-RPC/流式握手、超时和错误码可控、D1 计量不受影响。只有当某服务只提供 MCP（或 MCP 侧有额外能力）时才走 MCP。智谱、Tavily 都同时提供 REST 与 MCP，选 REST。

## 建议的分层接入

1. **中文校园优先用智谱 `search_pro`**（0.03 元/次）：中文站点、公众号转载、学院官网覆盖明显好于英文引擎；返回自带摘要与发布时间，正好补当前 `title_only` 过多的问题。搜狗/夸克仅在百科、医疗等垂直问题按需调用。
2. **保留 Exa 作为语义/英文与全球官方资料**，Tavily 作为免费额度兜底（每月 1,000 次 basic）。
3. **统一 Provider 接口**：输入 query/limit/officialOnly/campus，输出规范化 `ExternalItem`（title/url/snippet/publishedAt/authority/evidenceKind）；沿用现有校园范围过滤、去重、时间窗与引用编号。
4. **按问题路由，而不是全量并发**：中文校园事实 → 智谱；英文/国际 → Exa；空结果或超时才按预算回退，禁止一次请求打满所有供应商。
5. **预算与观测**：每次调用记录 provider、延迟、空结果率、费用与是否回退；设置每日/每对话上限。预览期按 100 次/日估算，智谱约 3 元/日；生产前须负责人批准。

## 为什么这能改善“一问三不知”

当前拒答有两种：真没有资料，和检索没找到。后者占多数（如“大型体育赛事”零命中，而“体育比赛”能命中）。中文引擎 + 查询改写 + 摘要返回能显著降低第二类；但**不能**替代证据校验与来源过滤，也不能保证所有问题都召回。接入后仍需固定问题集对比空结果率、Top3 相关率、回答支持率与费用。

## 需要负责人批准

- 开通智谱 API Key（按次计费，无月费）或确认 Tavily 免费额度即可先试；
- 每日/每月调用上限；
- 是否允许把现有 Exa 默认路由改为“中文优先智谱”。

未获批准前不写入任何真实 Key、不产生调用费用。本轮仅完成调研与现有问题的代码修复。
