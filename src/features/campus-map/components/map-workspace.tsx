"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  Map,
  Search,
  UserRound,
  Plus,
  Minus,
  Layers,
  RotateCw,
  Compass,
  Navigation,
  X,
  ExternalLink,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
import {
  campusData,
  categoryNames,
  placeLayer,
  searchCampusPlaces,
  type MapLayer,
} from "../data/campus";
import type { SDKPoi } from "../adapters/amap-types";
import { PlaceDetails } from "./place-details";

const layerNames: Record<MapLayer, string> = {
  buildings: "校园建筑",
  sports: "体育设施",
  dormitories: "宿舍楼栋",
  services: "生活服务",
};
export function MapWorkspace() {
  const map = useCampusMap();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [online, setOnline] = useState<SDKPoi[]>([]),
    [searchBusy, setSearchBusy] = useState(false),
    [searchError, setSearchError] = useState("");
  const [layersOpen, setLayersOpen] = useState(false),
    [routeOpen, setRouteOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const local = searchCampusPlaces(query).slice(0, 12);
  const ready = map.status === "ready";
  const searchAMap = async () => {
    if (!query.trim() || !ready) return;
    const revision = ++generation.current;
    setSearchBusy(true);
    setSearchError("");
    try {
      const result = await map.searchOnline(query.trim());
      if (revision === generation.current) setOnline(result);
    } catch {
      if (revision === generation.current)
        setSearchError("高德查询暂时失败，校园已收录地点仍可搜索。");
    } finally {
      if (revision === generation.current) setSearchBusy(false);
    }
  };
  return (
    <section className="map-workspace" aria-labelledby="map-title">
      <h1 id="map-title" className="sr-only">
        广外大学城校园地图
      </h1>
      <div className="map-top">
        <div className="map-context">
          <Link className="compact-brand" href="/map">
            广外通 <span>CampusOS</span>
          </Link>
          <span className="campus-location">大学城校区</span>
        </div>
        <div className="map-toolbar">
          <form
            className="map-search glass-surface"
            onSubmit={(event) => {
              event.preventDefault();
              setSearchOpen(true);
            }}
          >
            <Search size={19} strokeWidth={1.65} />
            <label className="sr-only" htmlFor="place-search">
              搜索校园地点
            </label>
            <input
              ref={searchInput}
              id="place-search"
              placeholder="搜索地点、宿舍、体育设施"
              value={query}
              enterKeyHint="search"
              autoComplete="off"
              onFocus={() => {
                if (query && !routeOpen) setSearchOpen(true);
              }}
              onChange={(event) => {
                ++generation.current;
                setQuery(event.target.value);
                setSearchOpen(true);
                setOnline([]);
                setSearchBusy(false);
                setSearchError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
              }}
              aria-controls="campus-search-results"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="清空地点搜索"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                  searchInput.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            )}
          </form>
          <Link
            className="mobile-account glass-surface"
            href="/account"
            aria-label="我的账号，当前为游客"
            title="游客模式"
          >
            <UserRound size={20} strokeWidth={1.6} />
          </Link>
        </div>
        <div className="zone-switcher glass-surface" aria-label="校园视角">
          {(
            [
              ["all", "全校区"],
              ["teaching", "教学区"],
              ["living", "生活区"],
            ] as const
          ).map(([zone, label]) => (
            <button
              key={zone}
              disabled={!ready}
              aria-pressed={map.zone === zone}
              onClick={() => {
                map.setZone(zone);
                setSearchOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {searchOpen && (
          <div
            className="map-search-results"
            id="campus-search-results"
            role="region"
            aria-label="校园地点搜索结果"
          >
            <div className="results-heading">
              <span>校园地点</span>
              <button
                className="icon-button"
                aria-label="关闭搜索结果"
                onClick={() => setSearchOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            {local.length ? (
              local.map((place) => (
                <button
                  key={place.id}
                  className="place-result"
                  onClick={() => {
                    map.select(place.id);
                    setSearchOpen(false);
                  }}
                >
                  <span>
                    {place.name}
                    <small>
                      {place.zone === "living" ? "生活区" : "教学区"} ·{" "}
                      {categoryNames[place.category]}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))
            ) : (
              <p className="empty-search">尚未收录匹配地点。</p>
            )}
            <button
              className="text-link online-search"
              disabled={!ready || !query.trim() || searchBusy}
              onClick={() => void searchAMap()}
            >
              {searchBusy ? "正在查询高德…" : "查询高德在线地点"}
              <ExternalLink size={14} />
            </button>
            {searchError && (
              <p className="inline-error" role="alert">
                {searchError}
              </p>
            )}
            {online.map((poi) => (
              <button
                key={poi.id}
                className="place-result"
                onClick={() => {
                  map.focusOnline(poi);
                  setSearchOpen(false);
                }}
              >
                <span>
                  {poi.name}
                  <small>{poi.address || poi.type || "高德在线 POI"}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {online.length > 0 && (
              <p className="source-caption">高德在线结果，不保存为自有 POI。</p>
            )}
          </div>
        )}
      </div>
      {!ready && (
        <div className="map-loading-card" role="status">
          <Map size={26} strokeWidth={1.4} />
          <h2>
            {map.status === "loading" ? "正在加载校园地图" : "地图暂时无法加载"}
          </h2>
          <p>
            {map.status === "loading" ? "正在读取本地校园地图。" : map.error}
          </p>
          {map.status === "error" && (
            <button className="primary-button" onClick={map.retry}>
              <RefreshCw size={16} />
              重新加载
            </button>
          )}
        </div>
      )}
      <div className="map-controls glass-surface" aria-label="地图工具">
        <button
          disabled={!ready || (map.mode === "2d" && !map.supports3D)}
          onClick={() => map.setMode(map.mode === "2d" ? "2.5d" : "2d")}
          aria-label={map.mode === "2d" ? "切换为2.5D" : "切换为2D"}
        >
          {map.mode === "2d" ? "2D" : "2.5D"}
        </button>
        <button
          disabled={!ready}
          onClick={map.resetBearing}
          aria-label="地图朝北"
          title="朝北"
        >
          <Compass size={20} strokeWidth={1.5} />
        </button>
        <button
          disabled={!ready}
          onClick={() => map.rotateBy(30)}
          aria-label="顺时针旋转地图"
          title="旋转"
        >
          <RotateCw size={18} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setLayersOpen(!layersOpen)}
          aria-label="地图图层"
          aria-expanded={layersOpen}
        >
          <Layers size={20} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => {
            setSearchOpen(false);
            setRouteOpen(!routeOpen);
            if (map.route)
              map.executeAction({ type: "SHOW_ROUTE", routeId: map.route.id });
          }}
          aria-label="校园步行导航"
          aria-expanded={routeOpen}
        >
          <Navigation size={20} strokeWidth={1.5} />
        </button>
        <span className="tool-divider" />
        <button
          disabled={!ready}
          onClick={() => map.zoomBy(1)}
          aria-label="放大地图"
        >
          <Plus size={20} strokeWidth={1.5} />
        </button>
        <button
          disabled={!ready}
          onClick={() => map.zoomBy(-1)}
          aria-label="缩小地图"
        >
          <Minus size={20} strokeWidth={1.5} />
        </button>
      </div>
      {layersOpen && (
        <div
          className="map-layers-panel"
          role="group"
          aria-label="地图图层设置"
        >
          <h2>地图图层</h2>
          {(Object.keys(layerNames) as MapLayer[]).map((layer) => (
            <label key={layer}>
              <input
                type="checkbox"
                aria-label={layerNames[layer]}
                checked={map.layers[layer]}
                onChange={(event) => map.setLayer(layer, event.target.checked)}
              />
              <span>{layerNames[layer]}</span>
              <small>
                {
                  campusData.places.filter((p) => placeLayer(p) === layer)
                    .length
                }
              </small>
            </label>
          ))}
          <p>标注随缩放展开，未核验编号不补写。</p>
        </div>
      )}
      {map.picking && (
        <div className="map-pick-notice" role="status">
          在地图道路上点击选择{map.picking === "start" ? "起点" : "终点"}
          <button className="text-link" onClick={map.cancelPicking}>
            取消
          </button>
        </div>
      )}
      {routeOpen && (
        <aside className="route-planner" aria-label="校园步行路线">
          <div className="results-heading">
            <h2>步行导航</h2>
            <button
              className="icon-button"
              aria-label="关闭导航面板"
              onClick={() => {
                setRouteOpen(false);
                map.cancelPicking();
              }}
            >
              <X size={18} />
            </button>
          </div>
          <p className="source-caption">
            在已知可通行的位置选点，建筑中心不作为入口。
          </p>
          <button
            className="route-point"
            disabled={!ready}
            onClick={() => map.startPicking("start")}
          >
            <span className="route-dot" />
            {map.start
              ? `${map.start.name} · ${map.start.zone === "teaching" ? "教学区" : "生活区"}`
              : "在地图上选择起点"}
          </button>
          <button
            className="route-point"
            disabled={!ready}
            onClick={() => map.startPicking("end")}
          >
            <span className="route-dot route-end" />
            {map.end
              ? `${map.end.name} · ${map.end.zone === "teaching" ? "教学区" : "生活区"}`
              : "在地图上选择终点"}
          </button>
          <div className="route-actions">
            <button
              className="primary-button"
              disabled={!ready || !map.start || !map.end || map.routeBusy}
              onClick={() => void map.plan()}
            >
              {map.routeBusy ? "正在规划…" : "规划步行路线"}
            </button>
            <button className="text-link" onClick={map.clearRoute}>
              重置路线
            </button>
          </div>
          {ready && map.error && (
            <p className="inline-error" role="alert">
              {map.error}
            </p>
          )}
          {map.route && (
            <div className="route-result">
              <h3>
                {Math.round(map.route.distanceMeters)} 米{" "}
                <span>
                  约 {Math.max(1, Math.round(map.route.seconds / 60))} 分钟
                </span>
              </h3>
              <p className="source-caption">
                高德步行规划 · 已检查端点和校区范围
                <br />
                当前校内开放情况需以现场为准。
              </p>
              <ol>
                {map.route.steps.map((step, i) => (
                  <li key={i}>
                    {step.instruction}
                    <small>{step.distance} 米</small>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!map.route && (
            <p className="source-caption route-limit">
              跨区隧道入口及通行连接待核验，跨区导航暂不可用。
            </p>
          )}
        </aside>
      )}
      <PlaceDetails
        finalFocus={searchInput}
        onNavigate={() => {
          setSearchOpen(false);
          map.closeDetails();
          setRouteOpen(true);
          map.startPicking("end");
        }}
      />
      <div className="map-attribution">
        <a href={campusData.sourceUrl} target="_blank" rel="noreferrer">
          © OpenStreetMap contributors · ODbL
        </a>
        <span>地点资料核对中</span>
      </div>
    </section>
  );
}
