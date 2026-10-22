# CampusOS 公众号采集同步进程

> 2026-10-22 D-065：D盘MP Tools当前为v7目录错误/标题HTML修正，新下载文件为`公众号/标题/标题.html`；旧reading.html继续兼容。最新安装入口是`patch_mp_tools_browsing.py`，补丁备份在data/patches/history-browse-2026-10-22。25+4项离线回归通过，真实目录仍499/-2014，不能称历史已恢复。下文v4/v5构建说明保留历史。桥接扫描已适配任意带合法内嵌元信息的标题HTML，本轮没有重启桥接或部署网站。

> 2026-10-21 D-057修正：阅读HTML保留图片引用、背景和原排版。先前文字版实现已废弃；下文旧“移除媒体样式”说明由本条取代。图片文件仍在原图CDN，本地旧media为备份，Cloudflare不新增媒体副本。

Python 3.12 标准库即可运行，无新云服务、媒体存储或数据库依赖。当前适配 WeChat MP Tools 完成下载后的本地导出。它不调用 WeRSS，也不把桌面程序开放到公网。

## 运行

日常操作见 [公众号同步使用说明](../../docs/WECHAT_SYNC_USER_GUIDE.md)。这台电脑已配置连接，双击 `D:\WeChat MP Tools\启动 CampusOS 同步.cmd` 即可；网页已移除逐行选择、采集/展示耦合开关和凭据签发控件。

首次开发配置使用 `scripts/setup-wechat-collector.mjs --apply`，通过正常管理员接口签发限源凭据；`config.example.json` 说明本地配置格式。凭据和状态只能放在本地数据目录，不能提交到 Git。也可以在项目根目录运行：

```powershell
python services/wechat-collector/collector.py --config "D:\WeChat MP Tools\data\CampusOS_collector\config.json"
python services/wechat-collector/collector.py --config "D:\WeChat MP Tools\data\CampusOS_collector\config.json" --watch
```

`--watch` 每60秒同步已完成导出；中断后依靠 SQLite 回执续传。同一个请求重试不产生第二篇文章。更新替换当前正文，不保存正文历史。没有本地正文、没有原文时间、来源不在范围内时跳过，并在 `last-sync.json` 记录原因。原始发布时间不使用文件修改时间或下载时间代替。

Windows 常驻启动/停止入口是本目录 `start.ps1` / `stop.ps1`；`install-shortcuts.ps1` 在 MP Tools 目录生成双击入口。启动只连接 CampusOS，自带单进程锁；不是自动开机任务，重启电脑后需要再次启动。当前连接已设为长期有效、可撤销（expires_at_ms=0），管理员与来源作用域校验仍保留。日志不含凭据或正文，只在状态改变时写入。

`patch_mp_tools_export.py --install` 为已审阅的 2.2.4 + 短链修补版安装 HTML 输出适配器，程序必须先关闭。v4修正了此前把保存钩子插到网络获取前的错误：现在在获取、页面错误判断、日期解析和标题确定完成后，创建媒体目录之前保存。只有 `backend.downloader` 输出分支变化，保留短链补丁与原抓取、登录功能。新下载按稳定URL目录原子覆盖 `reading.html`，元信息嵌入不执行代码的meta标签，不另存JSON；原文时间取不到仍保存HTML并标记未知，同步跳过该文件，不伪造下载时间。补丁和备份在 `D:\WeChat MP Tools\data\patches\campusos-reading-2026-10-21`。只构建时写staged-report.json，成功安装才更新report.json，避免覆盖当前安装身份。

## 格式与空间

v5以文章标题作为目录名，通过HTML内规范原文URL识别同一篇文章；同URL覆盖、改标题移动原目录、不同URL重名追加短后缀。命名处理Windows保留设备名、非法字符和路径长度，移动前检查解析后的绝对路径属于当前公众号目录；URL身份缓存失效时重新核对元信息，保护不相关目录。rename_article_folders.py --root 指定单个账号 --apply 可迁移既有campusos-哈希目录，同步修正下载历史/RSS/本地回执路径，备份在程序data/patches，HTML字节保持。

每篇新下载只输出 `reading.html`。旧metadata.json/data.json导出继续兼容。HTML保留原文图片地址、背景CSS、文字、标题、列表、表格和链接；图片由浏览器按原地址加载，不另存媒体、原始网页、PDF、Markdown、纯文本副本。不会删除用户原有的其他格式下载。

服务端保留样式和图片引用，移除脚本、事件处理器、表单和不安全链接；正文通过禁止脚本的独立HTML框架展示，原文CSS不会覆盖CampusOS界面。列表只返回元信息，单篇阅读才请求HTML。正文上限1.5MB。公众号身份标识必须与信息源范围一致，不会把同名或改名账号自动合并。

## 原文更新和下架

新的、成功的导出通过 `observedAt` 排序。更新后以相同规范原文URL覆盖当前文章；不同URL作为新文章。公众号短链接只修正路径中的 `~` 为 `_`，保留完整短链，不从 `_` 拆尾段。

直接原文检查器可以写入 `dataDirectory/upstream-observations.jsonl`：每行 `sourceId,url,observedAt,outcome`。outcome 只能是 `http404/http410/platform_deleted/access_failed`。两次明确下架证据须间隔至少30分钟且每次检查在一小时以内。授权失效、验证码、429、超时、目录遗漏都只能作为访问失败，不能下架。确认下架后云端清空HTML、移除搜索派生数据，本地集成目录也清除该阅读版，保留小型防重复墓碑。

进程也读取 MP Tools 下载历史中准确的“文章已被作者删除/内容已被作者删除”失败记录，按实际检查时间提交同一协议。其他错误不作为删除。该能力不能代替原站定时巡检，也不证明未被检查的旧文章仍然可访问。

**边界：**本进程的定时扫描不是上游历史采集。后台的同步间隔为上游采集适配器预留；当前桥接模式由 MP Tools 自己的下载/RSS任务产生导出。没有成功完成原文的在线复查时，不能声称已经自动发现原文更新/删除，也不能声称78个账号历史已补齐。已有受限接口不会通过换账号、伪装设备、激活或浏览器兜底继续访问。
