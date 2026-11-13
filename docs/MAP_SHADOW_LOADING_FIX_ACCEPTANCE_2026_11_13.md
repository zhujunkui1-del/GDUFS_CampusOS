# 地图投影、旧南7白模与 Edge 加载修复验收

2026-11-13。负责人要求继续原任务，并纠正投影过灰、屋顶条纹问题：以原南苑7栋的明亮材质、方向明暗及淡灰地面投影为参照；2.5D保持纯白体块，不修改已完成3D资产。

## 实际发布

- 网站：`https://gdufs.zhiyuapp.site/map`，既有共享 `campusos-preview`。
- 本轮版本：`92fd53da-c33f-4e93-a90e-73116757e6e6`。
- 发布前版本/回滚点：`da37044a-cceb-4a66-9551-da0190b114e1`；本轮不执行回滚、D1迁移、DNS或Secret变更。
- 最终在主工作区运行原净化构建包装器并部署，保留已提交的其他业务修复，未发布早期隔离目录的旧业务基线。
- 本地原端口 `http://127.0.0.1:3026/map` 同步为最终生产构建。此前报告的早期修复只在隔离3036页复核，未同步用户查看的页面；不把该阶段截图当作已上线结果。

## 原因和改动

1. 旧白模：共享GLB仍加载时，Adapter允许原生南7挤出抢先显示。延迟全部GLB的浏览器回归在旧线上确定失败。现在南7两种模式进入同一共享场景，旧原生体块/院落始终隐藏，不再先显示不同光照的南7。
2. 投影：此前只有独立南7层有地面接收平面，共享模型没有。现全部41项共用太阳、地面平面和缓存PCF深度图。方向沿用南7的 `(-45,90,65)`，环境光2、暖白方向光3，地面opacity 0.17（路线显示时0.05）。模型仍由原材质和方向光形成立面明暗。
3. 灰屋顶/条纹：共享阴影图覆盖大范围时，模型表面接收自身深度阴影产生精度条纹和压灰。最终让模型投射、地面接收，模型表面不再接收该深度阴影；没有涂黑/改色或重建GLB。2.5D保持纯白材质，3D保留明亮米白屋顶与原立面。视野加缓冲确定缓存区域；模型、模式或覆盖区域变化才更新深度图，普通小幅移动复用。
4. Edge：新上下文打开 `http://gdufs.zhiyuapp.site/map` 和 `http://gdufs.ccwu.cc/map` 原先返回HTTP 200，非安全上下文缺Web Crypto，出现 `crypto.randomUUID is not a function`，模型完整性校验也不可用。HTTPS三个域名原本可加载。现Worker对已知公共域名HTTP页面GET/HEAD升级至同址HTTPS，保留查询参数，不重定向凭据API写入。SHA校验保留，缺少安全上下文在资源请求前明确终止。
5. 状态回归：3D失败后保留错误和共享白模回退，回到2D后可重试；在途3D完成不会把2D切回3D。MapLibre上下文丢失会销毁自定义层，恢复后在style就绪时重加共享层；同值ready通知也刷新实际可见状态。

## 测试结果

- `verify-map-model-assets.mjs`：84项通过。82个GLB和原GIS字节不改；2.5D总20,239面/1,258,192字节，3D总317,024面/4,993,256字节，零新增纹理。南7原V2 SHA保持 `54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a`。
- 全仓Lint通过，后续状态恢复修改再次通过相关文件Lint及 `tsc --noEmit`。全量单测158文件/1122项通过，后续相关3文件/13项复验通过。
- `building-model.spec.ts`、`model-loading-consistency.spec.ts`：本地Edge桌面/手机视口18项、Chrome生产构建桌面/手机视口18项通过。覆盖原足迹/拾取、整批3D平移常驻、失败重试、键盘切换、取消加载、上下文恢复、旧白模和缓存阴影。
- 原Worker构建、TypeScript、最终入口dry-run通过，1715个生成文件凭据扫描通过。
- 线上Edge 156：HTTP/HTTPS × `gdufs.zhiyuapp.site`、`gdufs.ccwu.cc`、`campusos.zhiyuapp.site` 六组最终均HTTPS；2.5D 41/41、详细3D 41/41，资源失败0、JS错误0。
- 线上延迟全部GLB首次切换：旧南7原生体块全程none；共享count 0/pending 41时也不显示旧体块。原失败场景转绿。
- 线上南7/南8捕获：两模式41项、41投射者；近景旋转前后阴影更新计数保持3，JS/WebGL错误0。截图确认明亮屋顶、无密集自阴影条纹和两栋地面投影；整片宿舍两模式另有宽屏截图。大视野旋转越出缓存覆盖时重新拟合和更新属于预期。
- 线上82个GLB逐项HTTP 200/SHA匹配；`/map`、`/radar`、`/knowledge`、`/calendar`、`/account`、`/api/health`均200，不代表全部业务功能验收。

## 证据和边界

原失败、修复后回执、部署前后版本、构建日志和截图在Git忽略的 `output/playwright/map-model-loading-2026-11-13/`。关键文件：`first-switch-msedge.json`、`first-switch-msedge-online-after.json`、`edge-origin-before.json`、`edge-origin-after.json`、`shadow-browser-report.json`、`public-assets-after.json`、`shared-shadows-2.5d.png`、`shared-shadows-3d.png`、`public-wide-2.5d.png`、`public-wide-3d.png`。

来源与许可沿用既有审核，未新增照片、纹理或GIS。阴影为静态显示光照，不代表实地日照测量。手机视口模拟不替代物理低端手机GPU、发热、真实手势和帧率验收。已有标签页需重新载入本次客户端代码，不能用发布前留存页面证明当前部署画面。
