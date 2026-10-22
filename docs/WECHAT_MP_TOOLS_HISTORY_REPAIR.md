> 2026-10-22负责人已要求回退至批量下载前v5。EXE及文章界面代码已按原备份恢复，自动补抓进程已取消。下文v6/v6.1与运行进程说明保留为历史记录；当前不再运行这些补抓修改。实际回退见 verification/mp-tools-rollback-v5-2026-10-22.json。

# MP Tools 历史目录故障修复记录（2026-10-22）

## 最新状态：仅修复历史浏览与标题HTML（2026-10-22 14:08，D-065）

负责人在v5回退后收窄任务：恢复真实历史目录浏览，保留单HTML/CDN与标题命名；不继续75账号缺失补抓。已安装v7目录错误处理与标题HTML输出修正，但**真实历史接口仍拒绝访问，历史浏览目标尚未完成**。

- 安装路径：`D:\WeChat MP Tools\WeChat MP Tools.exe`。SHA256：`3db6537660cc4580ff95b403994caf8b7caa37ab12d56ce3ebed1f4c816d5779`。
- 安装/备份/报告：`D:\WeChat MP Tools\data\patches\history-browse-2026-10-22`。构建入口：`services/wechat-collector/patch_mp_tools_browsing.py`。原v5 EXE、文章JS和7个数据JSON已备份。
- 当前原生进程路径已确认为D盘，文章下载页保留78个来源，明确显示历史列表失败/冷却状态。安装前后7个应用数据JSON和460个文章文件逐文件散列一致。旧下载文件没有批量重命名或删除。
- 新成功下载输出`公众号/Windows可用标题/同名标题.html`。保留完整标题元信息；文件名因非法字符/路径长度需要规范化，重名不同URL追加后缀。同URL更新使用一个文件，旧`reading.html`在同一文章成功保存后才迁移；失败不删除既有文章。静态图片、背景、SVG排版继续引用原CDN，不新增media/JSON/原始网页/PDF/Markdown。
- 历史目录以原`mp/chapters`返回为准，正常分页；修正HTTP200业务错误、空页但有后续、同标题不同文章、冷却账号被继续借出、目录失败被置顶成功掩盖。失败返回503并在界面显示原因，不返回“只有一篇”、不展示本地缓存冒充历史。快速切换公众号时，旧请求不能覆盖新账号列表。
- 实际安装包25项离线后端/导出回归、实际安装文章JS的4项离线界面回归通过；其中分页输入/输出由隔离HTTP边界供给，不代表上游实际成功。UI语法与本地Python编译通过。
- 13:54:31北京时间，单次使用原有会话和原目录URL检查广外就业，实际HTTP499/-2014，没有文章数组或分页标记；没有激活终端、变更设备、轮换账号或换接口。重启后原生界面/账号记录仍为目录受限，真实历史成功页数0。已请负责人在手机官方应用核对同一公众号历史目录，不需逐篇链接。
- 排查中曾观察到C盘下载目录运行原始副本；其EXE与最初原版备份逐字节相同（SHA256 `b0d2be34d9a6adc3837f0196cf60f1eb6bb8d2b9b72c3b61b89bf4903094d516`），也显示置顶一篇。负责人随后告知已删除该副本，当前仅操作D盘安装版。
- 同步桥接的本地扫描代码兼容标题HTML与旧reading.html，避免下次启动漏读；本轮未重启同步进程、未联网验收桥接、未部署CampusOS。自动补抓仍取消。

当前证据：`verification/mp-tools-history-browse-2026-10-22.json`。下文v6/v6.1安装与缓存恢复均为历史记录。

## v6/v6.1阶段结论（历史）

程序错误已修正，历史联网能力仍未恢复。不能把本机文章列表的恢复显示称为历史补抓成功。

- 当前安装：`D:\WeChat MP Tools\WeChat MP Tools.exe`，补丁 `campusos-history-directory-v6.1-local-visibility`。
- EXE SHA-256：`caf292b52d9689d76bc8dceb8fc540bbb359cc717dcfa1e65fa010d5f34fbb6a`。
- UI JS SHA-256：`0d66c1cb8cb50c34da904bcc02c8bfa713d8f065bf42908dcc1cbc2920b4b708`。
- 真实历史目录请求返回 HTTP 499、错误码 -2014。没有通过换账号、激活终端、修改设备或替代接口继续访问。
- 本轮新联网文章下载任务：0。2026-10-01 起的缺失历史仍未全部补齐。

## 已确认的软件缺陷

从实际安装 EXE 提取 `backend.articles` 与 `backend.account_pool` 的代码，与本机源文件编译散列匹配后复现：

1. `mp/chapters` 失败时，已有的 `mp/cover` 置顶文章继续作为完整列表返回，`can_msg_continue=0`。同一请求因此可显示一篇且任务完成。
2. 冷却中的唯一账号仍会被借出，后续请求继续延长冷却。
3. 置顶请求成功会清空历史目录失败的 `last_error`，掩盖真实异常。
4. HTTP 200 包含业务错误码时没有作为失败处理。
5. 旧列表路由将异常包装为 HTTP 200、空数组，界面显示“该公众号暂无文章”。本轮最初 v6 安装后暴露了这一界面缺陷，已在 v6.1 纠正。

## 修正范围

- 历史目录以真实章节列表为准，失败即中断该目录请求；不拿置顶文章代替目录，不进行隐藏重试或账号轮换。
- 正确区分 HTTP/业务错误、未知响应结构、空页但仍有下一页、相同标题的不同文章。
- 尊重冷却截止时间，保留错误码；不借出仍冷却的账号，不进行终端激活或自动刷新失效会话。
- 浏览列表遇到目录失败时展示真实本地导出，标注“当前显示本机已下载 N 篇；历史目录未恢复”。返回 `list_origin=local_downloads`、`directory_complete=false`。
- 正常目录响应明确返回 `list_origin=upstream_history`、`directory_complete=true`。这里表示本次上游目录页成功，整个账号仍须逐页检查 `can_msg_continue` 和日期边界；后续补抓不得把单页或本地回退数据当作全目录。
- 只变更 EXE 内 `backend.articles` 和 `backend.account_pool`，以及磁盘上的 `frontend/js/components/articles.js`。v5 `backend.downloader` 压缩负载保持逐字节相同，单 HTML、标题目录和原图 CDN 输出分支保留。

## 文件恢复与实际显示

排查时 `data/articles_full` 仍有407个 reading.html、下载历史409条，并未被本轮安装清空。当前旧 `D:\WeChat MP Tools\广外就业` 原始导出目录已不存在，但本机 CampusOS 阅读副本仍有53篇。

从 `data/CampusOS_collector/reading/MP_WXS_3083007618` 恢复这53篇到 `data/articles_full/广外就业/<标题>/reading.html`：

- 只创建缺失文件，不覆盖已有文章；不删除其他来源、文章或媒体。
- 保留真实原文发布时间、原观察时间、原文 URL、HTML 内容、图片及背景引用。元信息嵌入单 HTML，无另存 JSON。
- 来源文件是阅读 HTML 片段时，仅补独立文档外壳和禁止脚本的 CSP。
- 真实新联网请求0。恢复记录不伪称本次重新抓取。
- 当前物理 reading.html 总数460；排除指定三个账号后，75个目标账号中2026-10-01至当前的原文 URL 去重可用文章412篇。

实际网页界面已观察：广外青年7篇；广外就业54篇，第一页20篇、可分页，均明确标注本地列表。Windows 原生输入遇到最小化/用户输入/几何不可用，界面最终核对使用同一运行中应用的 localhost 网页，未宣称独立原生窗口点击验收完成。

## 验证

沿用负责人已明确允许的离线回归授权。原安装包的最小5项回归中4项失败、健康目录1项通过，能复现具体故障；最终实际安装包目录/本地列表11项、HTML输出10项均通过。

```powershell
python -m unittest discover -s tests/regression -p test_mp_tools_history_patch.py -v
python -m unittest discover -s tests/regression -p test_mp_tools_html_patch.py -v
```

网络 socket 被禁止，HTTP和账户存储仅在隔离边界使用测试输入，不读取真实凭据、不写真实下载历史。旧原始HTML/JSON夹具当前不存在，HTML回归使用真实已保存单HTML的正文和元信息重建获取页面外壳；不把这项离线验证称为新的原站访问验证。

日志位于补丁目录的 `regression-history-installed.log`、`regression-html-installed.log`。UI JS语法检查通过。未运行无关网站测试或部署 CampusOS。

## 文件位置和剩余工作

- 补丁、原EXE、原应用数据备份、UI备份、修复报告：`D:\WeChat MP Tools\data\patches\history-directory-2026-10-22`。
- 构建/安装：`services/wechat-collector/patch_mp_tools_history.py`。
- UI补丁：`services/wechat-collector/patch_mp_tools_history_frontend.py`。
- 本地阅读副本恢复：`services/wechat-collector/restore_local_reading.py`。
- 待补抓状态：补丁目录内 `resume-missing-state.json`，登记75账号、三个排除账号和412篇可用文章的URL/路径；`completed=false`。

原生 MP Tools 本地请求冷却120秒不表示上游一定在120秒后恢复。必须先取得真实目录成功响应并确认分页，再按已有原文URL和文件去重补抓；遇到499/-2014等限制停止。当前不能宣布75账号历史完整或缺失文章补齐。
