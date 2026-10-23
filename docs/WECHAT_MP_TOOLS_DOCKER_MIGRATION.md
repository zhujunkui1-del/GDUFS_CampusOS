# MP Tools 本机 Docker 迁移（2026-10-23）

负责人授权把桌面版轻量 HTML/CDN 补丁、公众号订阅和已有文章接入本机 Docker，并检查 `-2014`。Docker 仍运行在本机；CampusOS 采集入口未切换，Cloudflare 未重新部署。实施脚本为 `services/wechat-collector/migrate_mp_tools_docker.py`，目标源码位于 `D:\tlydcg\Codex_work\wechat_mp_tools\wechat-mp-tools`。

## 实际数据与存储

| 项目 | 迁移结果 |
| --- | --- |
| 收藏公众号 | 79，合并容器内已有的两个同身份账号，没有重复创建 |
| RSS 订阅 | 79，原来的 enabled 和时间间隔保留，全局自动采集暂停 |
| 下载历史 | 753 条，其中 749 条成功，四条失败记录保留 |
| 阅读 HTML | 749 篇，39,491,395 字节，与桌面备份逐文件 SHA-256 一致 |
| RSS 文章缓存 | 从原数据复制，保持原有文章列表 |
| 登录 | 保留容器里较新的登录记录，没有用桌面旧 Token 覆盖 |

配置、缓存和历史在 `deploy/docker/data`。历史中的 Windows 路径已映射成 `/app/data/articles_full/...`。原文章库 `D:\WeChat MP Tools_v2.3.1\data\articles_full` 作为额外 bind mount 挂到这个容器路径；**必须保留该宿主机目录**。没有移动或删除原 HTML，现有 Windows CampusOS 桥接继续使用同一目录。

桌面备份 `C:\Users\zhuju\Desktop\WeChat MP Tools_v2.3.1` 的 HTML 已全部核对。`collector.lock` 是运行时排他锁，不迁移、不删除来冒充停止进程。暂停原桥接后额外生成 `data/CampusOS_collector/state.consistent-2026-10-23.sqlite3` 一致性备份，SQLite quick_check 为 ok，原同步配置不变。

迁移前容器配置及修改前源码备份在：

`D:\tlydcg\Codex_work\wechat_mp_tools\wechat-mp-tools\deploy\docker\data\migration-backups\20261023T082521Z`

迁移报告、接口检查及本地阅读结果在同一 `data` 根目录中的 `docker-migration-report.json`、`migration-frequency-check.json`、`migration-local-validation.json`、`migration-browser-validation.json`。这些目录含凭据和个人数据，均在目标项目既有 Git 忽略规则内，不提交仓库。

## 轻量导出补丁

从桌面实际安装版本的 `downloader.shared-library.py` 只移植下载函数及 HTML 导出辅助函数；没有把旧版整个下载器覆盖到新源码。共享文章库及 HTML 清理器与桌面补丁报告记录的 SHA-256 精确一致。

输出仍是每篇一个 HTML，保留原微信 CDN 图片、背景和样式引用；不另存图片、视频、原始网页、Markdown 或 PDF。元信息嵌在 HTML 中，按规范原文 URL 去重。读取已有文章后再下载会直接复用文件。共享历史合并和 HTML 元信息扫描一并迁移。

## 限频修正与实测

- 微信读书数据请求在单进程内串行，默认间隔 4 秒，关闭 HTTP 适配器自动重试。
- 冷却账号不再被借出；排队中的请求在发送前重查状态。
- 收到 `-2014` 等拒绝时保留 HTTP/业务错误码，暂停 RSS，按本地可配置退避延长等待；默认从 300 秒起，最高本地退避 3600 秒，并尊重更长的 Retry-After。这些是请求节奏参数，不是腾讯承诺的解限时间。
- RSS 工作线程上限为 1；每个已排队任务开始时重新检查全局暂停状态。
- 目录只使用原 `mp/chapters` 接口；失败不再用置顶文章或替代接口伪装目录成功。错误返回非 200，页面显示原因，失败结果不进入页面缓存。登录脚注区分冷却状态。
- 公众号管理页的“恢复自动采集/暂停自动采集”控制全局暂停。当前保持暂停，订阅数据没有取消。
- `weread-diagnostics.jsonl` 只保留最近 100 个请求的时间、接口路径、HTTP 状态、业务码和耗时；不记录请求头、Cookie、Token、正文或完整查询串。

北京时间 **16:29:36** 对“广外就业”发起一次 count=1 的真实目录查询。上游 **`/mp/chapters` 返回 HTTP 499 / -2014**，用时 0.317 秒；上游请求共 **1 次**。本地 API 返回 **429**、`directory_complete=false` 和真实错误，自动采集保持暂停。没有继续换账号、激活设备或调用备用目录接口。

**本次迁移没有解除腾讯限制。** 不能据此把 Docker 宣称为限频解决方案，也没有把 CampusOS 的公众号来源改成这个受限目录接口。

## 已检查与边界

- 新镜像已构建并启动，容器 running/healthy，宿主机 5200 正常映射到容器。
- 8 个 Python 模块及修改的前端 JS 语法检查通过。
- 实际 API 返回 79 个公众号、753 条历史；749 条成功记录在容器内均有文件。
- 三篇真实文章 HTTP 阅读成功，返回正文 SHA-256 与原文件一致；全部 749 篇原文件仍保持原散列。
- 调用实际下载函数处理一篇已有文章，得到 success/already_exists、resources=0、无 PDF/Markdown、无新增上游请求。
- Edge 实际页面显示 79 个公众号、749 篇历史、恢复自动采集按钮及本地阅读 iframe，pageerror 为 0。检查时阻止浏览器访问外站，未验收 CDN 图片在线可达性。
- 没有新增或运行测试套件。受上游拒绝影响，本轮没有成功获取新的目录页或下载新文章，不声称实时采集已恢复。

原 CampusOS 桥接在迁移后恢复运行，WeRSS 容器及其原配置保持。后续需在停止重复请求后按实际响应检查账号恢复；没有确定的官方解限时长。真实目录稳定成功之前，自动采集维持暂停。
