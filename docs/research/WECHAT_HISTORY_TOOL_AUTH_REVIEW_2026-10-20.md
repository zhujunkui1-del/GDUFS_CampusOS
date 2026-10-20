# 微信公众号历史采集候选：授权与覆盖静态审查

> 后续本地复核：负责人授权检查 `D:\WeChat MP Tools` 后，已确认安装包 2.2.4 的七个关键模块与本报告固定源码归一化一致，本地已有两篇成功正文导出，其中目标“广外就业中心”一篇记录日期为 2026-09-30。该工具具有历史分页实现，保留为候选；下文的访问路径限制和全量覆盖缺口仍适用。新证据见 [安装包与产物复核](WECHAT_MP_TOOLS_LOCAL_REVIEW_2026-10-20.md)，不能继续把“未运行候选”理解成用户本地没有采集结果。

日期：2026-10-20（北京时间）  
目标：先获取“广外就业中心”`MP_WXS_3293703638` 自 2026-07-01 00:00（北京时间，含当天）起的文章，之后再评估 81 个账号。  
审查对象：[x554960766/wechat-mp-tools](https://github.com/x554960766/wechat-mp-tools)，固定提交 [`5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3`](https://github.com/x554960766/wechat-mp-tools/tree/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3)，源码标注版本 2.2.4。

## 结论

**有历史分页、日期范围与本地导出代码，但不能据此宣布适合当前任务或已采集成功。现阶段不建议原样启动此候选并导入现有凭据。**

原因有二：

1. 它仍依赖微信读书内部接口；扫码后会自动运行模拟移动终端同步，遇到此前已出现的 `499/-2041` 又会尝试激活、重试及轮换账号。因此，它不是已经证实可正常授权的独立历史来源。不能以换工具的名义绕过现有访问限制。
2. 分页失败可以降成“只返回 cover 最新一篇”或“空列表”，日期任务随后可能仍报告已完成；现有代码不能证明 2026-07-01 以后的历史覆盖完整。

**用户不需要逐篇手工找出 81 个账号的全部文章链接。** 自动路线的正确产物应由工具生成目录清单、原始链接、发布时间和缺漏报告。这个候选添加账号通常只需一条种子文章链接，不是每篇历史文章一条；现有 WeRSS 数据能否转换成其账号标识，需要单独核对，不应重新向用户索取 81 份历史清单。[添加入口说明](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/README.md#L69-L73)

## 本轮执行范围

- 只获取公开 GitHub 源码进行静态阅读，没有运行、安装依赖、启动或登录该程序。
- 没有读取 `werss_key.md`、Cookie、现有账号池或其他真实凭据。
- 没有向微信、微信读书的受保护接口发请求，没有重新尝试已失败的历史通道。
- 没有修改或重启 WeRSS，没有调整 81 个订阅及每日任务，没有新增采集文章。
- 没有运行测试；下面的缺陷判断是源码推断，不是实际微信响应的复验。

## 1. 作者声明、源码与实际结果的区别

作者在 README 中宣称支持历史列表、日期导出及处理访问拦截；这是作者声明，本轮没有复现其实际可用性。[声明位置](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/README.md#L21-L28)

| 检查项 | 固定源码中的事实 | 当前能得出的结论 |
|---|---|---|
| 历史目录 | 列表函数含 offset/count、hasMore，读取 chapters 列表并提供备用分支 | 有实现，未证明对目标账号可用 |
| 日期范围 | 接收 start_time/end_time；按目录时间筛选并翻页 | 有实现，目录时间与失败判定有缺口 |
| 单号批量任务 | 以一个 fakeid/account_name 启动后台线程 | 适合先做单号核验；不证明 81 号完整覆盖 |
| 文件导出 | 生成 HTML、Markdown、PDF、正文 JSON 和元数据 | 有实现，仍需独立检查正文和时间正确性 |
| 原始链接 | 从 reviewId 或 review/single 拼装链接 | 原始 ID 的编码处理仍需审查 |
| 真实采集 | 本轮没有启动 | 新增 0 篇，不能写“跑通” |

代码来源：[列表与分页](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L110-L295)、[日期任务参数](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L419-L456)、[日期执行循环](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1003-L1108)、[导出文件](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/downloader.py#L1350-L1431)。

## 2. 授权与访问限制

### 正常用户参与的部分

程序展示二维码，由用户在自己的微信中确认后取得登录回调；登录凭据会保存到本地账号池。手机确认是用户授权步骤，不能由代理代替。[扫码代码](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/auth.py#L133-L172)

程序还加载腾讯的验证码组件，代码意图是让用户手动完成验证后保存返回票据。**用户主动完成平台提供的验证，和自动处理、伪造或绕过验证是不同的事情。** 本轮既没有打开验证，也没有获取或注入票据。[前端人工验证入口](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/frontend/js/utils/waterwall.js#L35-L107)

### 不应在本任务原样执行的部分

- 扫码成功保存账号后，程序立即调用模拟移动端在线同步；不是只有用户显式点击某个“修复”才发生。[登录后的自动动作](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/auth.py#L174-L187)
- 列表请求遇到 `499/-2041`，代码调用终端激活函数，随后重试；仍受限则轮换账号，其他 499 也会走账号轮换。[错误后动作](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L123-L182)
- 终端激活函数自述为对移动协议的逆向，并修改客户端标识；函数发出同步请求后没有校验响应业务状态，就返回 True。因此其“激活成功”日志本身不证明权限恢复。[实现与返回判断](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/weread_signer.py#L191-L232)
- README 的 `-2041` 含义及“彻底攻克”措辞来自作者，不是本轮找到的腾讯官方错误码说明。不能把该错误认定为普通休眠后按项目提示继续突破。

**对当前会话的处理：** 已有 WeRSS 历史目录在用户重新扫码后仍返回 `-2041`。本轮应保留该限制，不用此候选的会话激活、客户端伪装、账号轮换、端点降级继续尝试同一数据访问。可以继续静态研究和寻找通过正常用户界面、明确授权范围完成导出的其他路线。

## 3. 无法保证历史覆盖的具体原因

以下为源码推断，均未经运行验证：

1. **单篇结果可能被误报为历史完成。** 第一页优先加入 cover 最新文章，其 `update_time` 固定为 0。若历史章节失败，仍可能只保留这篇；计算的 total_count 仅由当前数量与 hasMore 推算。日期任务接着到达这个推算总数，即写“已扫描全部文章”并 completed。[cover 时间与章节异常](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L189-L245)、[合成总数](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L291-L295)、[完成条件](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1079-L1091)。
2. **网络或访问失败与“没有更多文章”未严格区分。** 列表分支捕获异常继续；日期循环遇到空 articles 即认为没有更多文章。不能用任务变绿或 downloaded_count>0 证明目录到底。[异常处理](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L217-L245)、[空列表终止](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1033-L1039)。
3. **未知时间直接纳入范围。** 目录时间为 0 时完全跳过日期过滤；正文解析若没有找到时间字段，默认使用下载当前时间。这样无法准确限定“7 月 1 日以后”，并可能让旧文看起来是新文。[范围处理](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1044-L1053)、[正文时间兜底](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/downloader.py#L1137-L1145)。
4. **日期边界依赖排序假设。** 一页全部早于下限就停止，隐含后续页按时间降序排列；源码没有验证该排序，也没有保存边界文章或覆盖证明。[停止条件](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1073-L1083)。
5. **按标题去重可能漏同名文章。** 页面合并时以 title 相等跳过，不是以永久链接或文章标识去重。[去重位置](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L264-L288)。
6. **原文链接仍有编码隐患。** 实现直接截取 reviewId 最后一段、直接拼 originalId，没有在这两处还原已知的 `~`/`_` 编码差异。不能认定能继承当前 WeRSS 已做的修复。[链接构建](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L70-L101)。
7. **任务进度主要在内存。** 日期任务字典及后台线程不等于每个账号有可重启的持久游标；下载历史有保存，但本轮未见日期任务从上次 offset 恢复的机制。[任务创建](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L435-L455)、[循环起点](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1013-L1018)。

## 4. 文件、凭据与外部通信

| 内容 | 静态审查结果 |
|---|---|
| 凭据落点 | 配置定义 `data/account_pool.json`；accessToken、refreshToken、skey、Cookie 与设备资料由通用 JSON 保存函数明文写入 |
| 自动导入 | 账号池为空时会搜索两个本地 session 文件位置并导入；不能在包含现有 WeRSS/其他工具凭据的数据目录中直接试运行 |
| 日志 | signer 中的 session 刷新帮助函数会打印新 token；该帮助函数是否在具体运行路径触发需另查，不能把日志当可自由分享文件 |
| 历史目录与登录 | 所审查主路径直接访问腾讯域名，并非已验证的第三方开放 API |
| 公共中转配置 | 存在默认 `weread.111965.xyz` 设置和 UI，但全仓搜索未见当前运行代码读取该设置发出请求；不能据此声称当前凭据必然外传该站，也不能当作可信端点 |
| 可选文章上传 | RSS 上传默认关闭、URL 为空；启用后会将文章字段/正文和 deviceId POST 到配置地址，需要单独确认目的地和范围 |
| 浏览器外部资源 | 页面引用腾讯验证码脚本和字体站；本轮未加载此客户端页面 |

来源：[路径与默认值](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/config.py#L19-L65)、[普通 JSON 写入](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/config.py#L88-L95)、[凭据字段保存](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/account_pool.py#L490-L515)、[自动本地导入](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/account_pool.py#L82-L140)、[日志帮助函数](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/weread_signer.py#L150-L187)、[可选上传](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/rss_scheduler.py#L301-L327)、[上传开关](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/rss_scheduler.py#L392-L406)、[前端资源](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/frontend/index.html#L11-L18)。

### 可供后续导入的输出

逐篇 `data.json` 保存 `source/author/title/url/cover_url/publish_time/content`；`metadata.json` 还记录摘要、资源数量、导出状态与下载时间。具备转成中间清单的基础，但目前没有验证与 WeRSS 的直接导入契约；不应直接写 WeRSS 数据库。[具体输出](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/downloader.py#L1350-L1417)

## 5. 许可证与使用范围

仓库 LICENSE 主体为 MIT，并另加教育/个人研究免责声明；README 又要求个人学习、本地备份，禁止商业用途。这里存在表述差异，报告不对其法律效力作判断；如要把工具或采集内容并入 CampusOS 正式服务，需要另行核对用途、平台条款与文章来源许可。软件开源许可不代表获得文章再分发权。[LICENSE](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/LICENSE#L1-L23)、[作者使用声明](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/README.md#L106-L110)

## 6. 最少人工步骤及继续条件

用户选择自动采集路线，不应被要求逐篇整理历史链接。一个合适工具预期只需要：

1. 用户在官方页面或客户端中自行登录/扫码，确认确切的授权范围；如平台显示人机验证，由用户完成。
2. 只在账号标识无法自动对应时提供一个种子链接。本轮目标名称与 MP_WXS 标识已经具备，先尝试利用现有公开资料对应，不应重复索取整个文章目录。
3. 确认日期范围为北京时间 2026-07-01 起、确认导出保存位置。目录、筛选、去重、下载、核验和汇总由代理或工具承担。

**此候选的现状还不能进入上述实测：** 原样扫码即会运行模拟同步；必须先选择能通过正常授权界面取得目录的路线。若要继续评估候选改造，只能研究移除自动激活、受限后重试/轮换、错误降级冒充完成等路径，并且不能因改造而继续请求已经被拒绝的历史接口。

后续任何单号实测必须交付：成功读取的页数、实际覆盖起止时间、边界文章、真实发布时间来源、去重后链接清单、正文成功/失败数量、遇到访问限制后的停止记录。只有这些证据齐全，才可报告该号已补齐，再扩到 81 号。

## 7. 本轮建议

保留 WeRSS 每日任务与 81 个订阅，继续评估具有正常用户授权流程的本地历史导出路线。这个新候选保留为**静态参考，暂不启动**。其作者承诺、运行日志或任务 completed 状态都不能代替真实目录覆盖验收。
