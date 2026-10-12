# 校园地物数据

`campus.json` 从 OpenStreetMap 官方 API 的关系 13900183 派生，仅包含大学城教学区与生活区。© OpenStreetMap contributors，依据 [ODbL 1.0](https://www.openstreetmap.org/copyright) 提供和再分发；代码许可不覆盖此独立数据库。公开数据接口 `/api/map/data` 包含完整派生数据与署名、来源、采集时间。

坐标为 WGS84，显示前必须由高德正式坐标转换服务转为 GCJ-02。标签位置由真实 OSM 地物几何计算，不是经核验的建筑入口。`source_mapped` 表示可追溯的公开地物记录，不表示已实地核验通行、开放时间或学校认证。未具备来源的名称、楼栋编号和出入口不补写。

生成流程：从已许可官方 OSM API 保存去除用户身份字段的研究快照 → `node scripts/prepare-osm-campus.mjs` → Schema/范围/来源检查 → 与校方资料和高德底图逐项核对。完整宽范围原始快照仅本地研究；交付包含校内派生地物和待核验路径记录，不包含高德瓦片、模型或 POI 数据库。

待核验路网在 `docs/research/s1/pending-path-network.json`，全部 `verified=false`，不接入正式自有路线计算。图算法仅使用已经核验的边；跨区隧道及其两端入口缺少完整证据时禁止给出跨区导航。高德在线查询结果及路线仅当前页面内存使用，不合并进此数据库。
