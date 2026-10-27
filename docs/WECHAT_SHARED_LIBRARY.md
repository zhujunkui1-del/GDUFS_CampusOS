# WeRSS、MP Tools 与 CampusOS 共享文章库

> 2026-10-28：来源不再固定78。当前80个本地账号已全部接入（78公众号、2服务号）；常驻同步按公开账号ID/biz自动发现新增账号，忽略.campusos-locks，清单无变化不重复注册。来源启用无需先核验，手动停运/删除仍优先；新号文章沿原流程自动发布。详[本轮验收](WECHAT_ACCOUNT_DISCOVERY_2026_10_28.md)。

负责人于 2026-10-22 授权实施，决策 D-066。正式共享目录为 `D:\WeChat MP Tools_v2.3.1\data\articles_full`。

## 当前流程

1. WeRSS 容器继续执行原有的六小时采集任务，正文由其原有正文任务取得。
2. 本机 `collector.py --watch` 每分钟先通过 `localhost:8001` 的正常 AK-SK API 读取已完成文章。读取不会触发 WeRSS 刷新或新的微信请求。
3. 文章必须精确匹配 MP Tools 当前清单中的订阅身份。MP Tools `fakeid` 为公开 `__biz` 的 Base64，解码数字与 WeRSS `MP_WXS_<数字>` 一一对应。
4. 按规范原文 URL 查重。已有文件直接保留；正文尚未取得的新文章等待下轮。新文章生成 `公众号/标题/reading.html`，内嵌原文日期、URL、账号、保存观察时间与来源元信息，不另存媒体文件。
5. WeRSS 写入器和 MP Tools 下载保存钩子使用同一个按 URL 加锁的跨进程文件锁，落盘前再次检查。MP Tools 提前发现已有文章时不获取原文，竞争发生在获取期间时也不会覆盖先完成的文件。同标题不同 URL 使用不同目录。
6. 原子写入完成后登记 MP Tools 下载历史；其原有历史扫描已兼容内嵌元信息，`reading.html` 能通过原有阅读入口打开。下载历史使用同一把锁合并，防止 MP Tools 较早读取的列表覆盖刚导入的文章。
7. CampusOS 同步器扫描完整 HTML，以已有来源映射和限源凭据提交 `/api/collector/articles`。保留来源、日期、原始时间、管理员保护和幂等检查。每轮最多上传 20 篇，新文件优先，既有文件逐轮续传。

## 只增改，不同步删除

本地文件消失、目录被移走或删除、下载历史清空、WeRSS 标记文章不存在、旧 `upstream-observations.jsonl` 和原文删除提示，全部不能删除或撤回 CampusOS 文章。客户端没有发送删除观察的代码，云端 `/api/collector/observations` 与全部 DELETE 请求在读取数据库前拒绝。管理员主动进行的管理操作属于另一个独立流程。

旧观察表和历史数据保留，没有清表。正文更新仍按原 URL 和较新成功观察替换当前内容；旧观察不会覆盖较新内容，重复请求不会创建第二篇文章。版本 2 和 3 的既有阅读 HTML 均可接入；被清除的媒体通过内嵌 `media_omitted` 保持部分正文标记。

## HTML 和图片

优先使用 WeRSS 保存的 `content` 原始文章正文，它保留原来的背景和排版；`content_html` 经 Markdown 往返，作为没有原始正文时的后备。所有正文仍通过本地和云端清洗，禁止脚本。已知微信 CDN 的 HTTP 引用规范为 HTTPS，保留图片和背景的外部引用，Cloudflare 不保存图片副本。CSP、原文链接、1.5 MB 正文限制保持。

没有正文或原始发布时间的记录不产生伪造阅读页。此实现没有增加元数据专用自动上传通道。

## 日常操作

- 启动：双击 `D:\WeChat MP Tools_v2.3.1\启动 CampusOS 同步.cmd`。
- 停止：双击同目录的 `停止 CampusOS 同步.cmd`，停止本机 WeRSS 导入和 CampusOS 上传进程；WeRSS 容器和 MP Tools 自身的采集继续按各自配置运行。
- Windows 当前用户登录后，由任务 `CampusOS-WeChat-SharedLibrary` 启动同一个本机进程；重复启动只保留一个实例。电脑关机或休眠时没有本机同步。
- WeRSS 已设置 Docker 重启策略 `unless-stopped`，Docker Desktop 本身仍需运行。没有重建容器或改变其数据库位置；`/app/data/db.db` 当前仍在容器可写层，没有宿主机数据卷。
- 本机连接和回执在 `D:\WeChat MP Tools_v2.3.1\data\CampusOS_collector`。`last-werss-sync.json` 显示本地导入，`last-sync.json` 显示云端结果，`worker.stdout.log` / `worker.stderr.log` 用于故障定位。配置和密钥不得公开。
- 网站不可用时，本地 WeRSS 导入仍会执行；上传保留回执，网络恢复后重试。限流或服务不可用时不在同轮连续尝试整库。

## 安装与回退依据

目标 EXE 补丁和原 EXE 备份位于 `data/patches/shared-article-library-2026-10-22`，安装器为 `services/wechat-collector/patch_mp_tools_library.py`。它核对实际 v2.3.1 模块及选定函数，保留其他模块和程序资源。回退需要先退出 MP Tools，再由该目录的原 EXE 备份恢复；本机文件库和云端文章不随程序回退删除。

本次把 v2.2.4 目录内的原限源凭据复用到 v2.3.1，复制 SQLite 回执并重定位 445 条路径。旧配置与旧状态保留。未新增付费服务、微信访问路径、订阅账号或全历史采集任务。预览验收与正式环境部署分开记录。
