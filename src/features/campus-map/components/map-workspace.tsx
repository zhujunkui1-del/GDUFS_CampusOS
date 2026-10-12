import Link from "next/link";
import { Map, Search, UserRound } from "lucide-react";

export function MapWorkspace() {
  return (
    <section className="map-workspace" aria-labelledby="map-title">
      <div className="map-top">
        <div className="map-context">
          <Link className="compact-brand" href="/map">
            广外通 <span>CampusOS</span>
          </Link>
          <span className="campus-location">大学城校区</span>
          <span className="map-scope">教学区 · 生活区</span>
        </div>
        <div className="map-toolbar">
          <div className="map-search glass-surface">
            <Search size={19} strokeWidth={1.65} />
            <label className="sr-only" htmlFor="place-search">
              搜索校园地点
            </label>
            <input
              id="place-search"
              placeholder="地点数据尚未接入"
              disabled
              enterKeyHint="search"
            />
          </div>
          <Link
            className="mobile-account glass-surface"
            href="/account"
            aria-label="我的账号，当前为游客"
            title="游客模式"
          >
            <UserRound size={20} strokeWidth={1.6} />
          </Link>
        </div>
      </div>
      <div className="map-empty">
        <div className="map-placeholder-icon">
          <Map size={31} strokeWidth={1.2} />
        </div>
        <h1 id="map-title">校园地图准备中</h1>
        <p>
          真实地点与步行路网尚未接入。
          <br />
          准备完成后，即可查找地点和规划路线。
        </p>
      </div>
    </section>
  );
}
