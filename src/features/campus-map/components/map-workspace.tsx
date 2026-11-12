"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  ArrowRight,
  RefreshCw,
  LocateFixed,
  BarChart3,
} from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
import {
  campusData,
  categoryNames,
  placeLayer,
  searchCampusPlaces,
  type MapLayer,
  zoneName,
} from "../data/campus";
import { PlaceDetails } from "./place-details";
import { WalkingNavigation } from "./walking-navigation";
import { routeSheetMediaQuery } from "./use-route-sheet";
import { LocationNotice } from "./location-notice";
import { FocusedNavigation } from "./focused-navigation";
import { MapViewButtons } from "./map-view-buttons";
import { useAccount } from "@/features/account/account-context";
import { TrafficPanel } from "@/features/console/dashboard-panels";

async function requestPublicTraffic<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(result.error?.message || "暂时无法获取，请重试。");
  return result.data as T;
}

const layerNames: Record<MapLayer, string> = {
  buildings: "校园建筑",
  sports: "体育设施",
  dormitories: "宿舍楼栋",
  services: "生活服务",
};
export function MapWorkspace() {
  const map = useCampusMap();
  const user = useAccount().session?.user;
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false),
    [routeOpen, setRouteOpen] = useState(false);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const local = searchCampusPlaces(query).slice(0, 12);
  const ready = map.status === "ready";
  const selectPlace = map.select;
  useEffect(() => {
    if (!ready) return;
    const id = new URLSearchParams(window.location.search).get("place");
    if (id && campusData.places.some((place) => place.id === id))
      selectPlace(id);
  }, [ready, selectPlace]);
  useEffect(() => {
    if (!trafficOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTrafficOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [trafficOpen]);
  if (map.navigating && map.route) return <FocusedNavigation />;
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
              setSearchOpen(!!query.trim());
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
              onPointerDown={() => {
                if (query && !routeOpen) setSearchOpen(true);
              }}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(!!event.target.value.trim());
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
                if (event.key === "ArrowDown" && query && !routeOpen)
                  setSearchOpen(true);
              }}
              aria-controls="campus-search-results"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="清空地点搜索"
                onClick={() => {
                  searchInput.current?.focus();
                  setQuery("");
                  setSearchOpen(false);
                }}
              >
                <X size={16} />
              </button>
            )}
          </form>
        </div>
        {searchOpen && !!query.trim() && (
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
                      {zoneName(place.zone)} · {categoryNames[place.category]}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))
            ) : (
              <p className="empty-search">尚未收录匹配地点。</p>
            )}
          </div>
        )}
      </div>
      <Link
        className="mobile-account glass-surface map-account-fixed"
        href="/account"
        aria-label={
          user ? `我的账号，${user.username}` : "我的账号，当前为游客"
        }
        title={user ? user.username : "游客模式"}
      >
        {user ? (
          <span className="map-account-avatar" aria-hidden="true">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <UserRound size={20} strokeWidth={1.6} />
        )}
      </Link>
      <button
        type="button"
        className="map-traffic-trigger glass-surface"
        aria-label="访问量"
        aria-expanded={trafficOpen}
        aria-controls="public-traffic-panel"
        onClick={() => setTrafficOpen((value) => !value)}
      >
        <BarChart3 size={21} />
      </button>
      {trafficOpen && (
        <div
          className="map-traffic-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTrafficOpen(false);
          }}
        >
          <section
            className="map-traffic-popover"
            id="public-traffic-panel"
            aria-label="网站访问量"
            role="dialog"
            aria-modal="true"
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                const panel = event.currentTarget;
                const focusable = Array.from(
                  panel.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
                  ),
                ).filter((element) => element.getClientRects().length > 0);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="map-traffic-popover-heading">
              <h2>
                <BarChart3 size={21} />
                访问量
              </h2>
              <button
                autoFocus
                type="button"
                aria-label="关闭访问量"
                onClick={() => setTrafficOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <TrafficPanel
              request={requestPublicTraffic}
              revision={0}
              publicRead
            />
          </section>
        </div>
      )}
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
          disabled={!ready}
          aria-label="定位我的位置"
          title={map.locationTracking ? "关闭定位" : "开启定位"}
          aria-pressed={map.locationTracking}
          onClick={map.locate}
        >
          <LocateFixed size={20} strokeWidth={1.5} />
        </button>
        <MapViewButtons
          onChange={() => {
            setSearchOpen(false);
            setLayersOpen(false);
          }}
        />
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
            if (routeOpen && window.matchMedia(routeSheetMediaQuery).matches)
              return;
            setSearchOpen(false);
            setRouteOpen(!routeOpen);
            if (routeOpen) {
              map.cancelPicking();
              map.stopNavigation();
            } else if (map.route)
              map.executeAction({ type: "SHOW_ROUTE", routeId: map.route.id });
          }}
          aria-label="校园步行导航"
          aria-expanded={routeOpen}
        >
          <Navigation size={20} strokeWidth={1.5} />
        </button>
        {map.route && (
          <button
            onClick={map.stopNavigation}
            className="clear-route-button"
            aria-label="清除路线"
            title="清除路线"
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        )}
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
      {!routeOpen && <LocationNotice />}
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
        </div>
      )}
      {routeOpen && <WalkingNavigation onClose={() => setRouteOpen(false)} />}
      <PlaceDetails
        finalFocus={searchInput}
        onNavigate={() => {
          setSearchOpen(false);
          map.closeDetails();
          setRouteOpen(true);
          if (map.selected) map.choosePoint("end", map.selected);
        }}
      />
      <div className="map-attribution">
        <a href={campusData.sourceUrl} target="_blank" rel="noreferrer">
          © OpenStreetMap contributors · ODbL
        </a>
      </div>
    </section>
  );
}
