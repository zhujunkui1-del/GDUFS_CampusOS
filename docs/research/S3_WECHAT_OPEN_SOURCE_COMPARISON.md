# S3-B/S3-C｜四个开源项目联合研究与选型

2026-10-17（Asia/Shanghai）；CampusOS基线`206e01d`，开始时Git干净。四个本地原包只读；没有将Python、Docker、SQLite或上游程序接入Worker，没有部署/迁移/模型/SMTP/微信账号操作。Dify已按D-045废弃，不参与选型。

配套：[PoC与复现](S3_WECHAT_POC_PLAN.md)、[thu适配](S3_THU_PUSH_ADAPTATION.md)、[实施建议](S3_SOURCE_PIPELINE_RECOMMENDATION.md)。本报告替代中断草稿的“尚未完成”状态；原始快照和Git历史保留。

## 1. 版本、维护与许可

以下默认分支均为`main`，本轮重新读取GitHub公开元数据/固定源码并对照原包；**updated_at不是代码提交时间，下载日期也不是版本号**。原包无Git元数据时，只能证明受检文件与某SHA一致，不能证明整个包均为该提交。

| 项目（按负责人A–D顺序） | 核对SHA / 提交时间                                                           | 仓库updated_at（UTC，本轮快照） | 许可与当前结论                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A weixin_search_mcp     | `a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb` / 2026-08-17 10:28:43 +08         | 2026-10-16 16:48:55             | README/pyproject声明MIT，但固定树没有独立LICENSE、GitHub license=null；正式复制/分发前补清许可证据                                      |
| B WeRSS                 | `9b40351fd1913e7f74cf88f65740cd67a28baf81` / 2026-10-10 09:45:30 +08         | 2026-10-17 08:54:01             | 固定LICENSE为MIT；GitHub自动识别NOASSERTION不推翻文件正文。软件许可不授平台/文章权限                                                    |
| C thu-push              | `19abc55134cf5691e575fbcc74cb88d3801c2b28` / 2026-10-12 00:54:42 +08         | 2026-10-11 16:54:49             | MIT，可参考/移植时保留声明；账号与文章权利另核验                                                                                        |
| D BlogDistiller博萃     | `c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8` / 2026-10-14 23:02:48 +08，v1.2.8 | 2026-10-16 16:49:01             | LICENSE为CC BY-NC-SA 4.0并有个人非商业用途、署名/衍生及企业集成书面授权等附加要求；公开校园服务不自动落入个人离线归档范围，暂缓正式集成 |

维护快照/原包比对：[AB当前版本](../verification/s3-wechat-resumed/ab-current-github.json)、[AB问题与审查](../verification/s3-wechat-resumed/ab-issues-and-review.json)、[WeRSS/thu当前状态](../verification/s3-wechat-resumed/werss-helper-upstream.json)。逐模块代码与许可证据：[AB审计](s3-wechat/ab-audit.md)、[WeRSS/辅助链](s3-wechat/werss-helper-audit.md)、[thu算法](s3-wechat/thu-algorithms-audit.md)。原始资料路径按负责人提供位置，有些包内还嵌套同名目录，不运行原包。

### 当前问题未被“维护活跃”解除

- [Search PR9](https://github.com/fancyboi999/weixin_search_mcp/pull/9)仍Open、merged=false，review为CHANGES_REQUESTED；默认HEAD仍a5a70a2。PR的merge_commit_sha可能是测试合并提交，不能当成已合并证明。本轮没有套用PR或其静态Cookie。作者自报的真链/耗时结果不是本机实测。
- [WeRSS #463](https://github.com/rachelos/we-mp-rss/issues/463)、[#476](https://github.com/rachelos/we-mp-rss/issues/476)仍Open；[PR478](https://github.com/rachelos/we-mp-rss/pull/478)仍Open/未合并，head a76517ba，base9b40351。用户评论和PR描述不是微信官方公告，也不证明所有账号均失败或已恢复。
- BlogDistiller新增[启动问题#1](https://github.com/yibeigen/wechat-article-exporter/issues/1)仍Open；这不证明所有安装均失败，本轮未安装客户端/激活或复现启动。
- thu的81项指定测试通过后仍复现多个时间/ICS/反馈缺陷；“没有Issue”不等于符合CampusOS契约。

## 2. 职责与关键代码

| 项目          | 能解决的部分                                                              | 关键模块及不能外推的范围                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search MCP    | 关键词文章发现、分页线索、候选发布者与真链、MCP工具入口                   | [main.py](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/main.py)、[weixin_search.py](https://github.com/fancyboi999/weixin_search_mcp/blob/a5a70a26ca36dc7ebb201ce9d9bb54a746758ecb/weixin_search_mcp/tools/weixin_search.py)；搜索覆盖率不等于全账号历史，名称不等于认证主体                                                              |
| WeRSS         | 订阅管理、任务调度、列表/正文同步、RSS/REST及本地存储                     | [mps API](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/apis/mps.py)、[article_content](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/article_content.py)、[weread_mp](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/wx/model/weread_mp.py)；长期增量是待实测能力，不是本轮已运行 |
| thu-push      | 消费WeRSS数据，时间候选/确定性评分、ICS/日报/反馈；另有授权订阅导入辅助链 | [notice_digest](https://github.com/thu-lawyer/thu-push/tree/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest)、[weread-push](https://github.com/thu-lawyer/thu-push/tree/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push)；不是独立全量公众号采集器，旧PKUKnow链不是当前主通道                                                                                                                     |
| BlogDistiller | 已知URL批处理、公开合集及多格式导出、正文清洗参考                         | [wechat.py](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/wechat.py)、[custom_urls.py](https://github.com/yibeigen/wechat-article-exporter/blob/c5e56bfba4bab6c81cb1a9cd8c196040d0baebb8/backend/app/scrapers/custom_urls.py)；已知链接批量处理不等于恢复全历史发现；优先结构数据，不选PDF视觉还原为入库格式                         |

## 3. 能力矩阵：20项

标记：**码**=固定代码/文档存在；**测**=有独立离线测试；**本**=本机合成/纯函数或SQLite实测；**部**=部分/需适配；**故**=已知缺陷；**无**=未发现该项目提供；**未**=尚未验证。每格证据范围由三份模块审计及PoC解释，**所有四项目的真实微信文章实机成功均未验证**，本机离线成功不升级为实时成功。

| 能力              | Search MCP                              | WeRSS                                               | thu-push                                              | BlogDistiller                                            |
| ----------------- | --------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| 1 账号/文章发现   | 码/部：关键词搜索                       | 码/部：订阅/搜索入口需登录                          | 码/部：searchbiz辅助，需平台会话                      | 部：已知链接/合集，不承诺按名称发现                      |
| 2 认证主体核验    | 无：名称匹配不认证                      | 部：账号标识，不等于主体核验                        | 部：nickname/biz/fakeid不授认证                       | 部：发布者元数据，不核验组织权利                         |
| 3 已知URL处理     | 码/未：正文工具                         | 码/部/未：列表后正文与回退                          | 部/本：消费已有URL元数据                              | 码/本/故：抓取器空正文fallback有问题                     |
| 4 全历史发现      | 无：搜索不保证全历史                    | 码/部/未：取决上游会话/分页，可能cover回退仅最新1篇 | 无：依赖WeRSS，不独立采集                             | 部：README全历史恢复限制，合集仅其成员                   |
| 5 新文增量        | 无：需外部任务/游标                     | 码/部/未：主候选，未做两轮实机                      | 码/本/部：本地sent去重，不是来源同步                  | 部/未：批次重跑不等于稳定监测                            |
| 6 正文提取        | 码/未                                   | 码/故/未：改版故障仍待验证                          | 无：主微信投影只有标题/URL等                          | 码/本/故：空内容模板及异常需拒绝                         |
| 7 发布时间准确    | 本/故：JS时间未转换                     | 部/未：时间字段/新结构兼容要核                      | 本/故：字符串时间NameError、now锚点                   | 本/故：缺日期today fallback、update/create混用风险       |
| 8 搜索与分页      | 码/本/部：合成解析，真实覆盖未知        | 码/部/未：分页/任务                                 | 部：辅助查账号；只读SQL过滤有局限                     | 码/部/未：合集/已知链接批次                              |
| 9 批量导出        | 部：结果列表，非归档器                  | 码/部/未：RSS/API/导出格式                          | 码/测/本：日报/ICS，本地数据                          | 码/部/未：MD/HTML等；JSON限链接/提取接口，非完整正文导出 |
| 10 API可用性      | 部：本地MCP为主，无成熟业务REST证明     | 码/本/部：形状可解析，安全与实时未验                | 码/未：反馈HTTP未启动，本机仅测渲染/SQLite            | 码/部/未：本地后端/任务接口，需鉴权/激活审计             |
| 11 MCP            | 码：stdio工具，端到端未测               | 无：本轮未发现原生MCP契约                           | 无                                                    | 无                                                       |
| 12 去重           | 部：需CampusOS身份/版本                 | 码/部：上游ID/URL，不替代本地审核                   | 测/本/故：rawURL及标题去重可能丢出处/误合并           | 码/部：批次不能替代持久文章身份                          |
| 13 中文活动时间   | 无                                      | 无                                                  | 测/本/故：覆盖多语法但语义不合冻结契约                | 无：发布日期不是活动日期                                 |
| 14 独立报名截止   | 无                                      | 无                                                  | 测/本/故：截止混入start，区间end混入deadline          | 无                                                       |
| 15 AI摘要/排序    | 无：调用方Agent另有能力                 | 部：扩展/AI配置未调用                               | 码/测/本：确定性评分+模型失败fallback；未调用真实模型 | 部/未：摘要/分类字段不证明模型提纯                       |
| 16 ICS            | 无                                      | 无：未发现可替代审核活动ICS能力                     | 测/本/部/故：格式有价值，取消/单项更新需重写          | 无：非其主职责                                           |
| 17 邮件通知       | 无                                      | 码/未：通知配置，未发信                             | 码/部/未：SMTP/日报，未发信                           | 无：未作为自动邮件候选                                   |
| 18 运行依赖       | 码：Python、requests/lxml、MCP进程      | 码：Python/浏览器驱动/数据库、可选Docker与常驻任务  | 码/本：通知算法可标准库；CDP助手另依赖websocket       | 码：Python后端/浏览器、前端/桌面封装与激活要求           |
| 19 Workers/D1适配 | 部：本地发现→有界交换；不能直接运行进程 | 部：独立受限只读导出，需运行载体                    | 部：窄算法TS实现可行；不搬SQLite/SMTP/systemd         | 部/高风险：只交换获准数据，不嵌整个后端                  |
| 20 许可/公开服务  | 部：MIT声明需补许可证据；平台权利未得   | MIT软件可用，平台/内容/凭据另审                     | MIT可窄移植；私人反馈/平台会话不能照搬                | 故/暂缓：附加非商业/署名/衍生限制，公开用途需明确许可    |

矩阵中的“无”指本轮受检版本没有该职责或实现证据，不是穷尽全部历史插件。所有真实正文/日期准确率都为N/A（无在线分母），不从代码/单测计算百分比。

## 4. 实测边界与已知故障

| 独立试验                | 实际结果                                                                         | 不能宣称                                |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------- |
| Search+Blog合成探针     | 18/18复现/格式断言符合，Search吞阻断/JS日期及Blog缺正文异常被复现                | 18项业务功能通过、真实文章成功率        |
| WeRSS/helper            | 26项离线检查完成；含上游纯函数与明确隔离的交换门禁草案                           | 真实登录/订阅/正文/增量/API稳定已通过   |
| thu                     | 指定上游81项通过；17组边界探针完成                                               | 17组均符合CampusOS或全套上游测试通过    |
| CampusOS现有代码/Schema | 10项严格诊断8通过、2未通过：中文日HH:mm无空格漏提时间；日期精度/出处等缺口另记录 | 当前事件提取/公开ICS已完成；已修复这2项 |

详细结果与初次错误保留在 [resumed证据目录](../verification/s3-wechat-resumed/)。研究runner验证故障稳定复现时可退出0，但原10项断言仍有2项failed，未放宽预期或修改生产代码。

关键结论：Search最接近**发现器**职责，但PR9及许可/访问门槛未过；WeRSS最接近**持续监测候选**，七层实机验证全未做；Blog只适合先做获准已知URL研究，既有缺正文路径实际NameError，另在隔离补标准库别名后观察到模板+today潜在误报，二者不可混称默认正常输出；thu适合规则/格式思路参考，时间和发布语义需重写。

## 5. WeRSS七层真实验证结果

| 层级                     | 本轮状态                                     |
| ------------------------ | -------------------------------------------- |
| 启动服务                 | 未做；纯函数加载不等于服务启动               |
| 微信登录/授权            | 未做，不使用任何现有Cookie/CDP会话           |
| 添加订阅                 | 未做；源码显示添加可立即同步，不能当只读登记 |
| 发现真实广外文章         | 未做                                         |
| 取得真实正文并对照完整性 | 未做                                         |
| 下一轮发现已知新文章     | 未做                                         |
| 稳定服务与API输出        | 未做；合成API形状验证不替代                  |

`weread-push`的132账号历史运维记录属于作者环境，未授CampusOS采集权限；GET任务run会触发同步，不纳入只读白名单。部分WeRSS文章/RSS端点缺少每路由鉴权，不能直接公网暴露引擎或全文，需独立受限网关及权利判断。

## 6. 当前技术选择

近期采用**方案A的受限版本：官网Connector + 获准人工链接/资料**，搜索分支保持关闭直至权限与缺陷验收；为未来方案C保留可替换交换协议。方案B保留长期候选，不新增服务器或强行实现全天候微信采集。无需四项目全部成功才继续CampusOS：官网和审核主干独立运行，真实批准后才能公开展示。具体任务、人日估算和验收门槛见[实施建议](S3_SOURCE_PIPELINE_RECOMMENDATION.md)。
