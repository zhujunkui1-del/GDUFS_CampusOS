"use client";
import { useEffect, useState } from "react";
import {
  Compass,
  LocateFixed,
  LogOut,
  Navigation2,
  ArrowUp,
} from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
import { headingBetween } from "../data/navigation-geometry";
import { toWgs84 } from "../adapters/online-services";
import { campusData } from "../data/campus";

export function FocusedNavigation() {
  const map = useCampusMap(),
    route = map.route!;
  const stop = map.stopNavigation;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const remaining = map.navigationProgress?.remaining ?? route.distanceMeters;
  const step = map.navigationProgress?.step ?? 0;
  const heading =
    map.navigationProgress?.heading ??
    headingBetween(toWgs84(route.pathGcj02[0]), toWgs84(route.pathGcj02[1]));
  const direction = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][
    Math.round(heading / 45) % 8
  ];
  const next = Math.max(
    0,
    route.steps.slice(0, step + 1).reduce((s, p) => s + p.distance, 0) -
      (route.distanceMeters - remaining),
  );
  const minutes = Math.max(1, Math.round(remaining / 75));
  const arrival = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(now + (remaining / 1.25) * 1000));
  return (
    <section className="focused-navigation" aria-label="步行导航模式">
      <h1 className="sr-only">校园步行导航</h1>
      <div className="navigation-direction glass-surface" role="status">
        <div className="navigation-arrow">
          <ArrowUp
            size={28}
            style={{
              transform: `rotate(${map.navigationOrientation === "north" ? heading : 0}deg)`,
            }}
          />
        </div>
        <div>
          <p>
            {Math.round(next)} 米 · 向{direction}
          </p>
          <h2>{route.steps[step]?.instruction || "沿路线步行"}</h2>
          <small>
            {map.navigationProgress
              ? "正在更新步行位置"
              : "定位未连接，按路线指引步行"}
          </small>
        </div>
      </div>
      <div
        className="navigation-controls glass-surface"
        aria-label="步行导航工具"
      >
        <button
          aria-label="导航定位"
          title="定位并恢复跟随"
          disabled={map.locationBusy}
          onClick={map.locate}
        >
          <LocateFixed size={20} />
        </button>
        <button
          aria-label={
            map.navigationOrientation === "north"
              ? "切换路线方向朝上"
              : "切换朝北"
          }
          onClick={() =>
            map.setNavigationOrientation(
              map.navigationOrientation === "north" ? "route" : "north",
            )
          }
          title={map.navigationOrientation === "north" ? "朝北" : "路线朝上"}
        >
          {map.navigationOrientation === "north" ? (
            <Compass size={20} />
          ) : (
            <Navigation2 size={20} />
          )}
        </button>
        <button
          aria-label={map.mode === "2d" ? "切换为2.5D" : "切换为2D"}
          disabled={!map.supports3D && map.mode === "2d"}
          onClick={() => map.setMode(map.mode === "2d" ? "2.5d" : "2d")}
        >
          {map.mode === "2d" ? "2D" : "2.5D"}
        </button>
        <button disabled aria-label="3D建筑尚未就绪" title="尚未接入完整3D建筑">
          3D
        </button>
        <button
          aria-label="退出步行导航"
          title="退出导航，保留路线"
          onClick={map.stopNavigation}
        >
          <LogOut size={20} />
        </button>
      </div>
      <div className="navigation-summary">
        <div className="navigation-metrics">
          <strong>
            {Math.round(remaining)}
            <small>米剩余</small>
          </strong>
          <strong>
            {minutes}
            <small>分钟预计</small>
          </strong>
          <strong>
            {arrival}
            <small>预计到达</small>
          </strong>
        </div>
        <p>
          总路程 {Math.round(route.distanceMeters)} 米 · 前往 {route.end.name}
        </p>
        {map.locationMessage && (
          <p className="navigation-location-status" role="status">
            {map.locationMessage}
          </p>
        )}
        <a
          className="navigation-credit"
          href={campusData.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors · ODbL
        </a>
      </div>
    </section>
  );
}
