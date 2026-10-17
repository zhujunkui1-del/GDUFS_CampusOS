# CampusOS｜四项目隔离PoC与准入计划

> 续接完成稿，基线206e01d。四项目静态审计与隔离PoC已完成；真实微信采集未执行，不能把本机合成结果算线上成功。D-045继续生效，Dify不参与方案或阻塞。

日期：2026-10-17。范围：静态审计、合成离线输入与现有代码/Schema核查，不进行未获准真实微信文章访问。配套[比较](S3_WECHAT_OPEN_SOURCE_COMPARISON.md)、[thu适配](S3_THU_PUSH_ADAPTATION.md)、[建议](S3_SOURCE_PIPELINE_RECOMMENDATION.md)。

## 1. 本次与历史证据分开

- 本次GitHub默认分支/固定SHA与问题页面复核，原包只读对照；下载的研究源码只在忽略的scratch，未纳入应用依赖。匿名REST遇403限流后停止该路径，采用公开页面/既有官方只读连接器补充元数据，不换账号/代理规避限流。
- 上轮S3-B同日两个robots探测均HTTP200：搜狗默认UA禁止搜索路径，微信默认UA禁止`/s`文章路径。见[原始政策与10项离线结果](../verification/s3-b/wechat/local-poc.json)。这是既有时刻的观察，不声称再次实时读取或永恒政策；在无新的许可证据前继续停止，不为了本轮成功率重复探测文章。
- 本轮**未做实时文章PoC**：A/B/C/D均无真实广外文章采集、登录、订阅或下一轮更新；没有Cookie、CDP、SMTP、模型、Dify或付费调用。README、上游作者实验和本机离线测试分列，不能作为本机实时链路成功。
- 已有preview D1 [快照](../verification/s3-wechat/campus-baseline.json)来自2026-10-17 06:49:31 UTC、基线e30a939，3篇官网元数据全待审。本轮只审读脚本与快照，不重新查询或改写旧证据；不是新微信成功样本或当前实时计数。

## 2. 四项目×三个候选目标的实时结果

| 项目          | 广东外语外贸大学     | 广外青年   | 广外图书馆 | 文章/真实URL/正文/完整/日期/认证比率 |
| ------------- | -------------------- | ---------- | ---------- | ------------------------------------ |
| Search MCP    | 未测，访问门禁       | 未测，同左 | 未测，同左 | 全部0/0，N/A                         |
| WeRSS         | 未测，授权/登录/正文 | 未测，同左 | 未测，同左 | 全部0/0，N/A                         |
| thu辅助链路   | 未测，无平台管理授权 | 未测，同左 | 未测，同左 | 全部0/0，N/A                         |
| BlogDistiller | 未测，访问+用途许可  | 未测，同左 | 未测，同左 | 全部0/0，N/A                         |

本轮发现/取得正文/完整正文/正确日期/核验主体/重复/新增均0篇，原因是**未发文章请求**，不是0%能力。文章HTTP错误0次、耗时N/A也不是联网成功。搜索无新增、403、登录失效不能相互替代。D消费上游数据，不把它的排序成功算作文章发现率。

目录中GDUFS-SRC-0110（GDUFS-1965）、0117（gwtwgfwx）是待核账号线索；0199图书馆是服务号线索且微信号待核。它们不是已完成认证。官网同名来源不能自动赋予公众号official权限，原文中publisher名称也不能证明认证主体。

## 3. 离线PoC与复现

本轮完成的固定源码证据与探针见[Search/Blog审计](s3-wechat/ab-audit.md)、[WeRSS辅助链](s3-wechat/werss-helper-audit.md)、[thu算法](s3-wechat/thu-algorithms-audit.md)。旧元数据JSON仍保留，不以旧时刻冒充本轮复查。新结果均位于[resumed证据](../verification/s3-wechat-resumed/)。

| 测试对象     | 实测结果                         | 证据/含义                                                                                                                                       |
| ------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Search/Blog  | 18/18合成断言符合                | [结果](../verification/s3-wechat-resumed/ab-offline-probes.json)；含吞阻断/JS日期/缺正文异常及潜在模板分支，非18功能验收                        |
| WeRSS/helper | 26/26检查符合                    | [结果](../verification/s3-wechat-resumed/werss-helper-offline.json)；5上游纯函数（3正常+2局限）、1文档映射、20自有网关/内存账本草案；未启动API  |
| thu          | 81指定上游测试通过，17组探针完成 | [结果](../verification/s3-wechat-resumed/thu-offline.json)；包含不符合CampusOS的行为，非17项功能通过；另5个绑定HTTP端口的测试未执行             |
| 现有CampusOS | 10严格诊断8通过，2失败           | [原始结果](../verification/s3-wechat-resumed/campus-offline.json)；R01/R02的日HH:mm无空格漏时间未修复。研究runner只验证稳定复现，不能当契约通过 |

首次测试失败也保留：Search/Blog首轮15/18，3项为Windows异步驱动内部唤醒socket被禁；修改离线测试驱动后18/18，不放宽网络guard。CampusOS首轮5/10，修正3处隔离夹具（合法HTML结构、任务策略字段及多活动使用既有支持的日期格式）后8/10，前两条原严格断言保持失败，见[campus-initial.json](../verification/s3-wechat-resumed/campus-initial.json)。未修改生产代码或把失败预期改成NULL掩盖。

复现需要本机Python/既有测试依赖和对应固定SHA源码。先审查所列测试没有网络、SMTP、CDP、模型副作用；仅运行指定离线模块，不执行上游main、定时器、Docker、install scripts或环境中的真实凭据。合成正文/URL明确标注测试用途，不进入D1/public。原包前后SHA一致性与联网/离线边界必须保留。

CampusOS回归运行`npm test`，只验证现有模块不回归，不代表微信采集已通；Dify已废弃，不做其测试。下列研究脚本不加入生产测试发现路径，原包和应用代码都不修改。

```powershell
# 在仓库根目录；已有Python需能import bs4/lxml，仅Search/Blog探针使用。
python -B -X utf8 tests/research/wechat_ab_offline_probe.py
python -B -X utf8 tests/research/werss_helper_probe.py --output docs/verification/s3-wechat-resumed/werss-helper-offline.json
# 已有隔离stdlib-only venv和固定19abc551克隆，不在原包运行；准备步骤见thu审计。
.map-tools/wechat-research/thu-venv/Scripts/python.exe tests/research/thu_algorithms_probe.py --upstream .map-tools/wechat-research/thu-push --local-archive CampusOS_Codex_完整设计文档_v2/thu-push-main --output docs/verification/s3-wechat-resumed/thu-offline.json
node tests/research/run-campus-probe.mjs
# 直接运行严格断言会返回1，当前2条失败是实测缺口，不能删除或改预期。
node node_modules/vitest/vitest.mjs run --config tests/research/vitest.config.ts
```

没有相应原包/固定克隆/既有依赖时准确报缺依赖，不从网络自动安装、登录或抓文章。脚本的网络/进程拦截是本次善意已审计程序的防误操作机制，不是对未知恶意程序的系统级沙箱。

### 3.0 十类边界的完成情况

| 用户边界                   | 本轮实际验证                                                                      | 仍需实施/验收                                   |
| -------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| 文章发布时间与活动时间不同 | thu仅发布日期不生成活动；CampusOS原日期保留，但无空格活动时刻提取失败R01          | 修日期词法而不借发布时间填开始                  |
| 截止不等于开始             | thu错误把deadline复制start；CampusOS R02无空格漏deadline，不生成假start           | 独立字段/证据、原严格失败必须修                 |
| 只有日期无时刻             | thu午夜占位可进ICS；CampusOS日期型事件时间丢NULL                                  | date/time/precision DTO与兼容存储，不补23:59    |
| 相对日期无可靠锚点         | thu调用链用执行now；CampusOS下周五留unknown                                       | 锚定原文证据，未知继续待审                      |
| 一文多活动                 | thu只首项；CampusOS支持显式标题的两候选                                           | 更广语法、偏移/修订及逐候选审核                 |
| 同活动多渠道               | SQLite现有event_sources可关联两原文，未自动按标题合并                             | 明确事件身份/证据版本与多渠道状态冲突人工核验   |
| 取消/改期                  | thu ICS仍CONFIRMED；CampusOS可提候选cancelled/postponed但非公开事件更新闭环       | 稳定事件ID、版本/outbox、撤回/日历更新          |
| 缺正文/发布时间            | Search/Blog/thu缺失及fallback缺陷；CampusOS缺容器报错、空容器只作元数据/日期NULL  | 不以非空占位正文算完整率，不造today             |
| 同URL多个发现器            | thu去重丢出处；CampusOS source+URL唯一约束被复现                                  | 稳定文档+有界发现观察，不造sourceId或新文章     |
| 接口阻断即停               | Search吞阻断被复现；WeRSS网关草案暂停；现有CampusOS真DAO+SQLite暂停任务并拒再领取 | 上游实际HTTP门禁/授权未验，不把草案当已部署保护 |

### 3.1 后续正式适配器的验收用例

1. Search返回`real_url=""`或反爬HTML：BLOCKED/UNRESOLVED，不得存搜狗中转为真实原文或返回no_new。
2. Search日期为JS片段：published_at=NULL+解析错误，不执行script，不回填今天。
3. Blog正文模板/日期fallback/空article：拒绝为完整正文；人工元数据可保存但标明unknown。
4. WeRSS中同文章update_time改变但正文无变化：仅观察，不新发布；真实内容变化回待审修订。
5. WeRSS接口200但认证重定向/业务错误：AUTH_REQUIRED，不推进检查点。
6. thu返回未知结束/相对时间/缺年：保留证据与推断，不生成精确已核验时间；截止和开始分开。
7. 相同标题不同年份/机构：不能合并；同source+规范URL+hash重跑幂等。
8. 上游夹带approved/adminId/SQL/MapAction或私有定位：拒绝；上游无权配置来源/权限。
9. 超量JSON/恶意URL/跨域重定向/私人IP/ICS换行：明确拒绝，不放宽既有SafeFetcher。
10. 来源许可撤销/任务取消/租约过期后迟到提交：现有DAO guard拒绝，公开gate与outbox同步失效。

这些是下一轮适配器验收用例设计，不能表述为本轮已实现所有转换器。

## 4. 实时试验前逐项门槛

| 门槛                | 所需证据                                                             | 当前结论                      |
| ------------------- | -------------------------------------------------------------------- | ----------------------------- |
| 平台/账号及访问许可 | 目标账号主体、访问范围与适用规则；robots/条款核对，许可矛盾交负责人  | 未满足，不做文章访问          |
| 源码使用许可        | 固定LICENSE；Blog公开服务用途需明确许可，Search独立许可证据需补      | 尚未满足；MIT不赋文章版权     |
| 真实凭据            | 若确需授权，由合法账号持有者按平台规则操作；限定用途/过期撤销        | 未提供、不索取Cookie/学校密码 |
| 本地隔离            | 无上游默认静态Cookie、无真实SMTP/LLM/CDP自动启动；限制网络/输出目录  | 仅离线静态分支可执行          |
| 运行边界            | 每工具每目标≤10篇、单站频率从严、请求/总时间预算、人工启动与停止开关 | 本轮实际文章数0               |
| 数据用途            | 全文/图片/附件/摘要/RAG分别审批；个人信息最小化                      | 默认不存第三方全文            |

未来确获许可时先1篇人工抽检，通过再上限10；已出现403/429/验证码/身份限制/明确禁止即停止该目标及相关路径，不尝试账号池、换身份或重试风暴。官方明确可用API与网页抓取是不同权限，不能互相借用。

## 5. 后续真实样本的统一记录模板

每批记录runId/toolCommit/adapterVersion/sourceId/政策证据/时间范围/预算；每条保存脱敏sampleId、真实原文URL、publisher核验证据、原始日期及精度、获取/观察时间、HTTP/业务错误码、请求及总耗时、正文状态/长度/人工完整判定、重复键及新增结果。**不记录Cookie/Token/私人位置/授权二维码。**

分母独立：发现率需要预先批准且人工确认的近期文章参照集；没有参照集只能报告发现数量。URL正确率=可确认原文且目标发布者正确/已检查线索；正文完整率=与原文逐段抽检完整/已抓取有效文章；时间/主体准确率分别计，缺失也统计，不剔除失败美化。重复率含同批及跨轮；新增监测至少第二次运行并有已知新文章参照。报告0/0=N/A，而非0%或100%。

WeRSS七层需逐层保存实际证据：启动→授权→订阅→真实文章→真实正文→第二轮新增→稳定API。每层通过不能替代下一层；只有后两层及安全/许可达标才可讨论长期服务。跨重启/凭据到期/429暂停、schema变化、批次重放与取消需另测。

## 6. 停止与交付

本轮交付研究、可复现离线证据、现有单元回归与Git，不启动S3-C或邮件推送。网络文章阻塞、BlogDistiller用途许可、账号主体核验、WeRSS七层、生产CPU/长期运维和真实手机仍为未验证项。官网+受控人工资料保留为无需新服务器的独立路径。

工程回归：[checks.json](../verification/s3-wechat-resumed/checks.json)记录typecheck/Lint、283单元、Chrome/Edge各8项本地Shell和Next/OpenNext安全构建；[研究汇总](../verification/s3-wechat-resumed/research-summary.json)检查四报告/20能力/本地链接及运行源码无变更。1347产物私密值扫描0命中。它们不代表两项时间契约已修复、真实模型/微信服务或手机实机通过。
