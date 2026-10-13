# 校园地物数据

`campus.json` 从 OpenStreetMap 官方 API 的关系 13900183 派生，仅包含大学城教学区与生活区。© OpenStreetMap contributors，依据 [ODbL 1.0](https://www.openstreetmap.org/copyright) 提供和再分发；代码许可不覆盖此独立数据库。公开数据接口 `/api/map/data` 包含完整派生数据与署名、来源、采集时间。

坐标为 WGS84，本地 MapLibre 直接使用；高德按需服务结果经明确的 GCJ02/WGS84 转换叠加。标签位置由真实 OSM 地物几何计算，不是经核验的建筑入口。`source_mapped` 表示可追溯的公开地物记录，不表示已实地核验通行、开放时间或学校认证。未具备来源的名称、楼栋编号和出入口不补写。

当前生成流程：校园 map.osm、横屏 map (1).osm、可选离线边缘缓冲 → `python scripts/prepare-local-map.py --version ... --buffer ...` → Schema/范围/来源检查 → 与负责人图逐项核对。旧 prepare-osm-campus.mjs 仅为历史初始导入，不作为正式更新入口。名称覆写独立保存，复合建筑保留外轮廓与内庭各环。完整宽范围原始快照仅本地研究；交付包含校内派生地物和待核验路径记录，不包含高德瓦片、模型或 POI 数据库。

待核验路网在 `docs/research/s1/pending-path-network.json`，全部 `verified=false`，不接入正式自有路线计算。图算法仅使用已经核验的边；跨区隧道及其两端入口缺少完整证据时禁止给出跨区导航。高德在线查询结果及路线仅当前页面内存使用，不合并进此数据库。
