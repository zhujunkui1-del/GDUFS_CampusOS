import { Map, Search } from "lucide-react";

export function MapWorkspace() {
  return (
    <section className="map-workspace" aria-labelledby="map-title">
      <div className="map-top">
        <div className="map-search">
          <Search size={19} />
          <label className="sr-only" htmlFor="place-search">
            搜索校园地点
          </label>
          <input id="place-search" placeholder="地点数据尚未接入" disabled />
          <kbd>搜索</kbd>
        </div>
        <span className="map-scope">教学区 · 生活区 · 校内通道</span>
      </div>
      <div className="map-empty">
        <div className="map-placeholder-icon">
          <Map size={34} strokeWidth={1.5} />
        </div>
        <span className="overline">广外大学城校区</span>
        <h1 id="map-title">校园地图准备中</h1>
        <p>
          地图与经过核验的地点、步行路网尚未接入。
          <br />
          暂无法查询校园地点或规划路线。
        </p>
        <span className="status-pill">等待地图与路线数据</span>
      </div>
      <div className="map-footer">
        <span>仅定位大学城校区</span>
        <span>地点与路线以核验资料为准</span>
      </div>
    </section>
  );
}
