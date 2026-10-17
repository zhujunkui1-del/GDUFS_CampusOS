# Search MCP 与 BlogDistiller：续接只读审计及离线 PoC

日期：2026-10-17（Asia/Shanghai）。CampusOS 基线：`206e01d`。本报告只涉及 A/B；不修改 Console、采集器、地图、Agent、D1、部署或四份联合主报告。Dify 已按 D-045 废弃，不作为本研究候选路线。

## 1. 结论与证据等级

**A 暂缓正式发现器接入；B 暂缓公开服务集成。** 两者可保留为本地隔离研究对象，均没有在本轮证明能稳定采集广外公众号。A 默认分支仍有错误被当空结果、JS 日期和真链验证缺口；B 除许可边界外，还存在缺正文后的模板与日期真实性风险。官网既有通道和经批准的人工导入应独立保留。

- **文档声明**：README/注释描述的功能，不等于本轮成功。
- **静态代码证据**：固定 SHA 上可见实现、分支和缺口；不推断外部平台现状。
- **上游作者/维护者报告**：Issue/PR 中的外部实验，注明报告人和时间；不算 CampusOS 实测。
- **本机离线**：只执行选定函数 AST、合成 HTML/JSON 和固定假响应。18/18 断言通过，其中部分断言是“缺陷得到复现”，不是 18 项功能通过。
- **实时采集**：本轮未访问搜狗/微信文章、登录、使用 Cookie、激活软件或启动服务；真实文章样本 0，发现率/真链准确率/正文完整率/日期准确率均 **0/0，未测**，不是 0% 或 100%。

## 2. 当前上游版本与原包核对

本轮重新通过公开 GitHub 分支、仓库及 PR API 读取，不把旧 JSON 的核查时间冒充本轮时间。完整字段见 [新快照](../../verification/s3-wechat-resumed/ab-current-github.json)。仓库 `updated_at` 不是代码提交时间，不能证明采集链路已修复。

| 字段（UTC）                | A：fancyboi999/weixin_search_mcp           | B：yibeigen/wechat-article-exporter        |
| -------------------------- | ------------------------------------------ | ------------------------------------------ |
| 默认分支                   | main                                       | main                                       |
| 当前精确 SHA               | `a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb` | `c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8` |
| HEAD author/committer 时间 | 2026-08-17T02:28:43Z / 相同                | 2026-10-14T15:02:48Z / 相同                |
| HEAD 主题                  | stdio UTF-8 修复（#7）                     | v1.2.8，微博/知乎扫码登录修复              |
| updated_at                 | 2026-10-16T16:48:55Z                       | 2026-10-16T16:49:01Z                       |
| pushed_at                  | 2026-08-17T02:28:43Z                       | 2026-10-14T15:11:24Z                       |
| 开放 Issue / PR            | 0 / 1（PR #9）                             | 1（#1）/ 0                                 |

原包只读位置：`CampusOS_Codex_完整设计文档_v2/weixin_search_mcp-main/`；B 位于 `wechat-article-exporter-main/wechat-article-exporter-main/`。先核对已保存的 [AB 旧证据](ab-github-evidence.json)，再对 7 个补充关键文件从固定 SHA 重新读取、只在内存比对哈希，全部相同，详见 [本轮源码核对](../../verification/s3-wechat-resumed/ab-local-source-check.json)。最终离线运行前后对 A 全目录 14 文件、B 外层全目录 200 文件（含原 ZIP）按相对路径/字节数/内容哈希聚合，均完全相同，见 [原包完整性](../../verification/s3-wechat-resumed/ab-reference-integrity.json)；5 个被测文件也在脚本内分别复验。

旧证据中的 unauthenticated REST 曾 403 限流；没有更换出口、绕限流或扩权。后续使用会话已经授权的 GitHub 只读 connector 查询公共 repo。未保存上游静态 Cookie、激活口令或任何用户凭据；原包未修改，未安装依赖。

### 2.1 A PR #9 的准确现状

[PR #9](https://github.com/fancyboi999/weixin_search_mcp/pull/9)仍 `open`、`merged=false`，最后更新 2026-09-08T02:49:29Z；head 为 `79fb75fc4e2b1c5a3522f2c9fb58fd64f63f712e`，base 即当前 `a5a70a2`。维护者审核为 `CHANGES_REQUESTED`，见 [审核快照](../../verification/s3-wechat-resumed/ab-issues-and-review.json)。PR 的非空 `merge_commit_sha` 是预合并对象，**不是已合并证明**。

PR 提议会话复用、清除静态 Cookie、明确部分反爬错误、转换 JS 时间。作者报告过修后 10/10 真链与正文；维护者也报告过一次真链/正文改善，但要求补齐：时间时区合同，以及 RequestException/解析异常在默认单页路径仍被吞成空列表。维护者后续远端实验被反爬阻断，不能由一次成功推断长期稳定。[PR 讨论与维护者审查](https://github.com/fancyboi999/weixin_search_mcp/pull/9#pullrequestreview-5136798174)

本轮只读 PR 源码：[`_readable_time` 仍用宿主机 fromtimestamp](https://github.com/wpk865147933/weixin_search_mcp/blob/79fb75fc4e2b1c5a3522f2c9fb58fd64f63f712e/weixin_search_mcp/tools/weixin_search.py#L36)；[单页异常仍可 return []](https://github.com/wpk865147933/weixin_search_mcp/blob/79fb75fc4e2b1c5a3522f2c9fb58fd64f63f712e/weixin_search_mcp/tools/weixin_search.py#L127)。新增 robustness 文件有 10 个 `test_`，加默认分支原有 1 个 stdio 测试，合计 11；这是用例静态计数，本轮没有运行 PR 全应用/依赖测试，也没有套用未合并代码。

### 2.2 B 的开放问题

[#1 安装启动问题](https://github.com/yibeigen/wechat-article-exporter/issues/1)仍 Open。报告者在 2026-10-15 回复称调整环境变量后自行恢复；这属于对方自报，没有明确根因或我们机器上的安装验证，不能归结为所有安装均失败/已修复。

## 3. A：发现能力、接口及限制

关键代码为 [`weixin_search.py`](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/tools/weixin_search.py)。

| 能力          | 证据与判断                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 关键词与分页  | [L19–126](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/tools/weixin_search.py#L19)：搜狗关键词、单页参数、多页最多默认 10 页；多页遇真正空页即停止。没有完整历史发现、订阅游标或增量数据库。                                                                                                                          |
| 账号过滤/身份 | 返回 title/link/real_url/publish_time/page，没有已认证主体字段，也没有可靠的指定账号精确过滤合同。把账号名放关键词不等于核验发布者。                                                                                                                                                                                                                                                      |
| 真链          | [L129–164](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/tools/weixin_search.py#L129)含静态 Cookie，拼接重定向脚本片段，异常/无片段返回空。未对最终主机、路径、响应正文证据做完整校验；不复用/公开其 Cookie。                                                                                                          |
| 时间          | [L71–94](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/tools/weixin_search.py#L71)直接 text_content，JS 不会执行；zip 标题与时间节点会截掉缺时间的一部分文章。不能把该字符串直接存为原发布时间。                                                                                                                       |
| 正文          | [L172–206](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/tools/weixin_search.py#L172)读取 js_content 纯文本，缺正文可返回空字符串，异常是普通失败字符串；没有正文完整率证据、附件结构或图片归档合同。传入 URL 没有精确 allowlist，不能暴露给公网任意调用。                                                             |
| 错误          | 默认单页 strict=False 将 HTTP 错误、反爬、请求/解析异常变成 []；多页调用 strict=True 可抛错。这与“没有新增”必须分开。超时 15s，页间 sleep 1s 不能替代来源政策。                                                                                                                                                                                                                           |
| MCP           | [`main.py:47–78`](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/main.py#L47)注册 3 工具；支持 stdio/HTTP。get_weixin_article_content 的 referer 虽标 Optional，签名没有默认值，不能只按 README 假定可省略。Codex 等 MCP 客户端未来可用隔离本地 stdio，但不等于 CampusOS 学生端自动获得这些工具。此次未配置或运行 MCP。 |

依赖：[`pyproject.toml`](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/pyproject.toml#L1)版本 0.2.1、Python>=3.12、FastMCP 2.x、MCP 1.x、requests、lxml、FastAPI/uvicorn 等。默认分支仅看到 [stdio 编码测试](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/tests/test_stdio_encoding.py)，不是搜索/正文可靠性测试。Python 常驻服务不能直接放入 Workers。

## 4. B：已知链接、合集、导出及真实性风险

### 4.1 支持范围与历史能力

[`README:49`](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/README.md#L49)声明公开单篇/多篇 URL、appmsgalbum 合集；同时明确微信全历史旧通道暂停。源码中仍有 profile_ext/登录/桌面历史调用，不代表已恢复。[web 分支](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L127)对公众号名称输入明确报已下线；[`frontend:1364`](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/frontend/app.html#L1364)也有全历史维护公告。旧分支注释中的“零风控”“全网任意号”是作者描述，不作为许可或真实可用证据。

[合集解析 L641 起](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L641)有 DOM、内嵌 JSON、AJAX 续页、多合集 URL 去重；依赖 msgid/itemidx、响应结构和继续标志，未实测在线分页。需特别拒绝两种不可信替代：

- [L1128](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L1128)把 update_time 也作为 create_time 候选，混淆原发布时间与更新时间。
- [L1141](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L1141)缺 URL 时拼出 sn 为空的链接。该构造不能冒充可打开的真实原文 URL。

### 4.2 缺正文与日期：必须阻断导入

[`wechat.py:1465–1517`](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L1465)在未提取正文后准备生成通用文章模板，未知日期填运行当天。分支还引用 `html.escape`，而模块顶部仅有 `html as html_module`：

1. **本机未修改函数逻辑的合成失败页**：实际抛 `NameError: html`，没有取得正文（B05）。这不是抓取成功。
2. **隔离命名空间显式补一个标准库 html 别名**：不改原文件，只为暴露潜在路径，返回通用模板、today、默认 is_failed=false（B06）。这是明确依赖修补下的风险演示，**不是未修改应用的正常成功结果**。
3. 有合成正文的成功分支在未知日期时保留空串（B07），不能说 B 所有缺日期都会填 today。此测试正文清洗器用确定性替身，只检查字段流，不证明真实正文清洗质量。

若未来只修 NameError 而保留模板，可能把伪内容当成功：[task_manager:847](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/task_manager.py#L847)主要按 is_failed、非空正文与少数错误字样统计。CampusOS 必须对空正文/阻断页标失败，禁止模板、编造摘要/日期进入候选正文或索引。

另有字段与时区不一致：[custom_urls 元数据解析](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/custom_urls.py#L78)明确 +08:00；[微信时间转换](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L1209)和 [正文时间](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py#L1300)依赖宿主时区。列表有 publish_time，正文起始只读 create_time，不能不加治理地透传。

### 4.3 自动化、导出、缓存、激活

- [FastAPI](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/main.py#L423)有 extract-links、任务创建/状态/SSE、暂停/续跑/取消与下载；[CLI](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/cli.py#L20)可自动化导出。这些是源码接口，未启动验证，不直接暴露为 CampusOS 公网 API。
- [任务快照](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/task_manager.py#L63)存原始请求和进度；[请求序列化](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/task_manager.py#L241)可能包含凭据字段，不能把快照/缓存/调试 HTML 直接提交或上传。客户端 client_id 不是可信管理员鉴权。
- [SQLite cache](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/core/cache.py#L18)以 URL 为键、覆盖缓存正文；不是 CampusOS 审核与文章版本库。模块导入会建目录/初始化 DB，本轮因此不 import 整个上游包。
- [格式枚举](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/models.py#L17)有 MD/PDF/HTML/原 HTML/Word/TXT，无全文 JSON 导出枚举。README 的 `.json`描述纯链接；extract-links 是 JSON 元数据接口，不等于标准化全文 JSON 导出。当前 [合并 Markdown](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/exporters/md_exporter.py#L12)是标题/来源/时间/正文排版，不能仅凭 README 将其当稳定 YAML frontmatter 合同。
- ArticleItem 有 HTML/Markdown/图片及互动评论字段，但无统一附件校验实体。正文完整、图片许可、附件权利未测；CampusOS 不导入评论/个人信息，不下载或公开镜像未经许可图片附件。
- 运行依赖见 [requirements](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/requirements.txt)：Python、FastAPI、httpx、bs4/lxml、markdownify、Playwright/Chromium（PDF）、python-docx、Pillow 等；桌面为 [Electron 1.2.8 项目](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/desktop/package.json#L1)。不能部署进 Workers 请求链路。
- README 要求向作者渠道获取免费激活口令；[前端激活检查](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/frontend/app.html#L5862)是本地 UI 状态，不是 CampusOS 服务端权限。未运行激活、未复用或记录口令，也不以能绕过 UI 作为许可证授权。

## 5. 许可证与数据用途分别核验

### A

[README](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/README.md#L172)和 [pyproject](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/pyproject.toml#L7)声明 MIT，但当前完整 Git tree 没有 LICENSE，GitHub license 元数据为 null。正式复制/再分发前补足准确版权通知与完整许可文本；不能把声明扩展为对搜狗/微信内容、账号和自动访问的授权。

### B

[固定 SHA 的 LICENSE](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/LICENSE#L9)为 CC BY-NC-SA 4.0 加额外条款：限定个人非商业学习/研究/离线归档；商业及企业内网集成须作者书面许可；署名、仓库/公众号信息保留及衍生同许可开源有额外要求。GitHub SPDX 为 NOASSERTION，不能简单标为“宽松开源”。

校园免费比赛和公开内容服务不自动落入个人离线自用。**本轮无法确认 CampusOS 公网服务作为采集组件/衍生软件/输出再发布是否获许可，故暂停集成与批量输出导入。** 后续先由负责人取得明确用途的作者许可，并单独核实文章作者/平台权利。软件许可不授予第三方全文、图片、附件转载权。这是工程准入结论，不替代法律意见。

## 6. 20 项能力对照（本轮边界）

表内“代码”不是实时成功，“未见”限定已审计代码面；所有真实网络能力本轮均未测。

| 能力                | A                                                | B                                                 |
| ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| 1 公众号发现        | 关键词文章发现代码；不是完整账号目录             | 网页名称通道已停用，旧桌面/登录代码不等于可用     |
| 2 身份/认证主体核验 | 不提供可信认证主体                               | 昵称提取代码，不等于认证主体                      |
| 3 已知文章链接      | 正文函数代码，错误/URL门禁不足                   | 单/多链接代码；离线元数据与失败路径已测           |
| 4 全历史发现        | 不提供完整性保证                                 | README 声明旧全历史暂停                           |
| 5 新文增量          | 无订阅检查点实现                                 | 缓存/重跑不同于持续订阅新增监测                   |
| 6 正文提取          | js_content 纯文本代码，空正文无明确状态          | 提取代码；缺正文 NameError/潜在模板风险已复现     |
| 7 发布时间准确性    | JS 原文错误已复现                                | 元数据 +08:00 可解析，其他路径时区/回填有缺口     |
| 8 搜索与分页        | 单/多页代码；阻断与真空在单页混淆                | 合集 JSON/AJAX 分页代码，在线分页未测             |
| 9 批量导出          | 多结果聚合，不提供出版导出器                     | 多格式及分批代码，未实际生成出版文件              |
| 10 API              | MCP HTTP/stdio，非正式 REST 数据交换合同         | FastAPI/CLI 源码存在，未启动                      |
| 11 MCP              | 3 项工具代码，未启动 MCP                         | 未见对应 MCP 工具界面                             |
| 12 去重             | 多页重复已复现                                   | URL 合集去重/SQLite 缓存，不替代文档版本/多出处   |
| 13 中文活动时间     | 不提供业务时间解析                               | 未提供符合 CampusOS 时间精度合同的解析            |
| 14 报名截止         | 不支持结构化截止证据                             | 未提供可靠截止实体                                |
| 15 摘要/推荐        | 交给外部调用模型，不是项目自带可靠推荐           | summary/category 字段不等于已验证分类/推荐        |
| 16 ICS              | 未提供                                           | 未提供                                            |
| 17 邮件通知         | 未提供                                           | 未提供                                            |
| 18 运行依赖         | Python3.12/FastMCP/requests/lxml                 | Python/FastAPI/解析与出版依赖，Electron 桌面可选  |
| 19 Workers/D1 适配  | 独立本地发现候选→严格交换格式；不可原样上 Worker | 独立本地已知链接导入；不共享写缓存 DB/搬原 Schema |
| 20 许可/公网用途    | MIT 声明需补通知；平台权限另核                   | NC/SA/额外条款，当前公网用途不明，暂停集成        |

## 7. 可执行离线 PoC 与失败记录

执行：

```powershell
python -B -X utf8 tests/research/wechat_ab_offline_probe.py
```

使用本机现有 Python 3.12、bs4/lxml；不安装任何包。脚本不 import 上游项目，AST 只保留指定函数、移除装饰器、替换静态 Cookie 字面量，检查没有函数内 import/open/exec/eval。requests 是假对象，DNS/socket connect 和子进程由 Python audit hook 拒绝；不创建上游 SQLite、写调试文件、运行模型或服务。

[最终结果](../../verification/s3-wechat-resumed/ab-offline-probes.json)：18/18 断言通过、0 断言失败、原文件哈希不变。A01–A10：真正空、HTTP/反爬错误、strict 区别、缺真链、JS 日期、标题/时间数量不齐、错误主机、空正文、多页重复。B01–B07：带时区元数据、未知日期、内嵌合集多文章、错误主机、实际缺正文异常、显式依赖修补后的模板风险、合成正文未知日期。AB01 是**研究夹具交换格式**，5 输入→2 条候选、1 重复、2 拒绝；未知时间保留 null，日期不补时刻，全部 metadata_only/pending。没有写 D1，也不是已接生产 Adapter。

[第一次尝试](../../verification/s3-wechat-resumed/ab-offline-probes-first-attempt.json)保留：15/18 断言符合，3 个 B 协程用例因 Windows asyncio 自建唤醒 socket 被研究网络 guard 拒绝，是测试 harness 错误，不是上游功能结果。改为直接驱动无挂起 raw_html 协程，不放宽网络 guard 后复跑通过。没有删除失败证据或把模板回填说成正文成功。

## 8. 对 CampusOS 的最小准入建议

1. **A 仅本地发现候选**：先修正并独立验收错误/真空、时间偏移、真链与账号身份；PR9 只是参考，不自动套用。正式网络 PoC 前重新确认平台规则/robots和账号权限，遇限制即停止。
2. **B 先许可与真实性门槛**：明确作者对 CampusOS 用途的许可，去掉任何伪正文/回填日期成功路径，严格验证原文 URL；当前只保留本地研究，不导入其整库/全文。
3. **统一受控交换**：发现渠道 A/B 不当来源身份；按已核验 source_id 映射公众号，真实 canonical URL/稳定文章标识去重，保留多发现出处，分离 published/fetched/source-updated/system-updated 时间及时间精度。原文修改形成新修订，不继承旧批准。
4. **复用既有治理**：候选进入 knowledge_documents/原文版本、ingestion_jobs/D1 租约与检查点、Console 审核/审计及失效 outbox；不搬上游缓存库，不直写公开结果，不允许上游成功标记跳过正文/权利/版本门禁。
5. **默认无额外基础设施**：现有官网+经许可人工元数据/链接导入可以独立支持初版演示。A/B 若未来运行，先管理员本地小批次、导出经审核交换文件；无服务器就不宣称持续订阅。公开服务、长期进程、模型预算、许可和实时成功率均需后续另行验收。

本轮完成即停止，没有正式集成、部署、迁移、采集、发布或进入 S3-C。
