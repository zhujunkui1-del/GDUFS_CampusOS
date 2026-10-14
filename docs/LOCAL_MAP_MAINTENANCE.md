# 本地地图数据维护

2026-10-13 负责人确认：本地 OSM 底图，高德仅按需在线查询/路线服务。

## 固定版本

- 当前 `s1-2026-10-14.2`（以local-map-manifest.json为准）：同源静态 GeoJSON + SHA-256 内容文件名 + WGS84。运行时不下载 OSM、不更新底图、不加载高德底图。
- 地点、二维轮廓、未来模型均使用稳定 OSM ID 和这份版本；模型须记录 `mapVersion / footprintId / modelVersion`。模型不单独修正或偏移真实地理坐标。
- 高德服务仅在用户点击在线查询/规划时加载 SDK。结果不进入本地底图库，GCJ02 经 `gcoord` 转为 WGS84 叠加；数学转换已与官方校园控制点比较（误差小于5米），不用于证明入口或现场通行。
- 南苑13栋在原始OSM中已有真实轮廓，旧地点导入遗漏，已补回；来源校园边界仍不声称为实测权属界。
- 静态文件使用内容哈希、长缓存；浏览器首次仍需从 CampusOS 站点取得资产，并非安装在每位用户电脑上的完全离线应用。

## 手动更新步骤

1. 负责人准备新 OSM XML，核查来源和提取范围。校园资料放回文档包 `map.osm`；横屏周边主来源为文档包 `map (1).osm`。可选视口边缘缓冲 XML 放入被忽略的 `docs/research/s1/local-context.osm`。不要用高德/苹果瓦片、截图或模型作为可再分发数据。
2. 周边数据需覆盖当前设备视口四角；当前 bounds `[113.362,23.045,113.424,23.086]` 是旋转/倾斜的显示缓冲，地图中心仅允许校园地物范围及250米缓冲，校园业务仍限教学、生活及真实连接区域。边缘资料不成为新校区。`map (1).osm` 主范围约3公里宽，已用于周边几何优先级；额外缓冲只解决透视/旋转四角覆盖。
3. 名称确认单独维护 `src/features/campus-map/data/owner-labels.json`。不得把参考图像素转换为猜测坐标；缺少轮廓的楼栋继续收集 GIS/实测资料。
4. 明确执行离线准备命令（不会联网）：

```powershell
python scripts/prepare-local-map.py --context 'CampusOS_Codex_完整设计文档_v2/map (1).osm' --buffer docs/research/s1/local-context.osm --version s1-YYYY-MM-DD.N --source-url '缓冲区原始数据下载链接'
```

5. 审查 Git diff、地物增删和坐标差异。生成脚本刷新已有地物几何、保留负责人名称；原地点消失会报错，须人工决定删除/替换。新匿名建筑不会自动得到名称、高度或可导航状态。
6. 执行类型、Lint、单元、真实渲染 E2E、生产构建和 Workers 预览。检查全校区、2D/倾斜、旋转/边缘、手机视口、名称/路线；保留截图、更新来源/进度，确认后部署。
7. 模型与底图同批升级。先校验模型对应的轮廓版本；旧模型不兼容时隐藏对应模型并保留二维轮廓。回滚通过 Git 恢复整套数据/模型版本。

`predev/prebuild` 仅复制已锁定版本 MapLibre worker/开源许可证，不下载或更新地图数据。当前无定时更新任务、Service Worker 高德缓存或内部瓦片抓取代码。

## 当前资料边界

113个校园地点：住宿楼宇、食堂、公共建筑/体育/服务、九个校门和隧道相关标签。教学E/F/G与实验A—E已有分栋标签，仍不是独立实测分栋轮廓；充值点关联北苑1栋，其他服务的所属建筑/开放信息继续核对。师苑四栋已按负责人逐项回复确认：Q1=师苑1栋、Q2=师苑3栋、Q3=师苑4栋、Q4=师苑2栋。

本地地图当前是有真实平面轮廓的倾斜视图，尚无自主立体建筑。OSM缺少校园楼高，不按视觉效果生成默认高度；完整模型按修订建模方案另行实施。

## 步行网络维护补充

更新本地底图后手动运行 `python scripts/prepare-walking-network.py`，同步路网mapVersion和原XML SHA；不要在启动/构建时运行。道路审核名单位于src/features/campus-map/data/walkway-review.json，approved只由负责人身份/通行确认后修改。当前名单仅隧道及两端步道，不能开启整个原始OSM路网。路网与底图版本不一致时拒绝本地规划。名称绑定在owner-labels.json，分栋标签使用原始node及parentId，不能用它们当入口或独立建筑模型。

## 新的全校路网手动准备流程（2026-10-14）

当前需使用scripts/prepare-campus-navigation.py，历史prepare-walking-network.py仅隧道走廊，会拒绝覆盖已批准全校网络。先安装离线工具 `python -m pip install --target .map-tools -r scripts/requirements-map-tools.txt`，再运行 `python scripts/prepare-campus-navigation.py --map-version <准备的地图版本> --network-version <新的路网版本>`，最后用prepare-local-map.py同一地图版本准备底图并格式/类型/单元/浏览器/构建验收。新模块不会在startup/build自动执行或联网更新地图。

owner-map-review.json保存负责人坐标、批准通行策略和已校准停车轮廓；owner-map-additions.json为生成补绘。georeference-owner-parking.py只在新的本地批注图需要配准时运行，依赖Pillow12.2.0与控制照片；普通重新准备可使用已保存轮廓，不需下载个人图片。非校区/禁止步行/水面与未批准穿楼仍是约束，校门不根据图片猜。GPS位置/临时附接节点不能写入入口名录。镜头依实际/目标倾角约束视口，SDK投影接缝锁6.14.0，升级需真实浏览器回归。

## 负责人点位输入（2026-10-14）

`owner-poi-review.json`独立保存已确认校门与服务点的WGS84经纬度、名称、类别、所属区域和父建筑。prepare-local-map.py将它们合并到地点与Point要素，支持更新既有源ID（西南门）而不重复创建；不从图片自动提取坐标。先准备新地图，再以同一mapVersion准备路网并检查版本一致。当前113地点、4521地物，版本s1-2026-10-14.2。
