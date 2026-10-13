"use client";
import { useState } from "react";
import { LocateFixed, MapPin, X, ArrowUpDown, Navigation } from "lucide-react";
import { useCampusMap } from "./campus-map-provider";
import { searchCampusPlaces, zoneName } from "../data/campus";
import type { RoutePoint } from "../adapters/amap-adapter";

function EndpointInput({
  which,
  point,
}: {
  which: "start" | "end";
  point: RoutePoint | null;
}) {
  const map = useCampusMap();
  const signature = point ? point.name + point.coordinateGcj02.join(",") : null;
  const [draft, setDraft] = useState<{
    query: string;
    signature: string | null;
  }>({ query: "", signature: null });
  const [open, setOpen] = useState(false);
  const value = signature !== draft.signature ? point?.name || "" : draft.query;
  const results = value.trim() ? searchCampusPlaces(value).slice(0, 8) : [];
  const label = which === "start" ? "起点" : "终点";
  return (
    <div className="endpoint-field">
      <div className="route-point-input">
        <span className={"route-dot " + (which === "end" ? "route-end" : "")} />
        <input
          aria-label={`导航${label}`}
          placeholder={`输入${label}地点`}
          value={value}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => {
            setDraft({ query: e.target.value, signature: null });
            setOpen(true);
            map.clearPoint(which);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={`在地图上选择${label}`}
          title={`地图选${label}`}
          disabled={map.status !== "ready"}
          onClick={() => {
            setOpen(false);
            map.startPicking(which);
          }}
        >
          <MapPin size={18} />
        </button>
      </div>
      {open && (
        <div
          className="endpoint-results"
          role="region"
          aria-label={`${label}地点建议`}
        >
          {results.length ? (
            results.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  map.choosePoint(which, p);
                  setOpen(false);
                }}
              >
                {p.name}
                <small>{zoneName(p.zone)}</small>
              </button>
            ))
          ) : (
            <p>未找到地点。请修改名称或在地图上选点。</p>
          )}
        </div>
      )}
    </div>
  );
}
export function WalkingNavigation({ onClose }: { onClose(): void }) {
  const map = useCampusMap(),
    route = map.route;
  const ready = map.status === "ready";
  return (
    <aside
      className="route-planner"
      aria-label="校园步行路线"
      data-navigation={map.navigating ? "walking" : "planning"}
    >
      <div className="results-heading">
        <h2>步行导航</h2>
        <button
          className="icon-button"
          aria-label="关闭导航面板"
          onClick={() => {
            onClose();
            map.cancelPicking();
            map.stopNavigation();
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div className="endpoint-list">
        <EndpointInput which="start" point={map.start} />
        <EndpointInput which="end" point={map.end} />
      </div>
      {map.picking && (
        <div className="route-picking-tip" role="status">
          在地图上选择{map.picking === "start" ? "起点" : "终点"}
          <button className="text-link" onClick={map.cancelPicking}>
            取消
          </button>
        </div>
      )}
      <div className="endpoint-shortcuts">
        <button
          className="text-link"
          disabled={!ready || map.locationBusy}
          onClick={map.useMyLocation}
        >
          <LocateFixed size={15} />
          {map.locationBusy ? "正在定位…" : "我的位置作起点"}
        </button>
        <button
          className="text-link"
          disabled={!map.start || !map.end}
          onClick={() => {
            const a = map.start!,
              b = map.end!;
            // The same selection path also supports coordinate and device endpoints.
            map.swapPoints(a, b);
          }}
        >
          <ArrowUpDown size={15} />
          交换
        </button>
      </div>
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
      {map.error && (
        <p className="inline-error" role="alert">
          {map.error}
        </p>
      )}
      {map.locationMessage && (
        <p className="location-feedback" role="status">
          {map.locationMessage}
        </p>
      )}
      {route ? (
        <div className="route-result">
          <h3>
            {Math.round(route.distanceMeters)} 米{" "}
            <span>约 {Math.max(1, Math.round(route.seconds / 60))} 分钟</span>
          </h3>
          <p className="source-caption">
            {route.source === "CampusOS.OSM"
              ? "本地 OSM 步行网络 · 已核对节点连接"
              : "高德步行规划 · 已检查端点和校区范围"}
            <br />
            {route.source === "CampusOS.OSM"
              ? "校园本地步行路网，跨区默认经下沉隧道。教学、实验区域可穿行；建筑周边就近到达。开放状态以现场为准，时间按步行速度估算。"
              : "目的地为附近道路，建筑入口与当前开放情况以现场为准。"}
            {route.undergroundPathGcj02?.length
              ? " 隧道段以虚线标示，包含台阶。"
              : ""}
          </p>
          <button
            className="primary-button navigation-start"
            onClick={map.navigating ? map.stopNavigation : map.beginNavigation}
          >
            <Navigation size={16} />
            {map.navigating ? "结束步行导航" : "开始步行导航"}
          </button>
          {!map.navigating && (
            <p className="source-caption">
              开始导航时请求设备定位；位置仅在本页使用，离开地图页停止追踪。
            </p>
          )}
          {map.navigating && (
            <p className="walking-status" role="status">
              {map.navigationProgress
                ? `距终点约 ${Math.round(map.navigationProgress.remaining)} 米`
                : "正在等待可靠定位；路线指引已保留。"}
            </p>
          )}
          <ol>
            {route.steps.map((step, i) => (
              <li
                key={i}
                aria-current={
                  map.navigating && map.navigationProgress?.step === i
                    ? "step"
                    : undefined
                }
              >
                {step.instruction}
                <small>{step.distance} 米</small>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="source-caption route-limit">
          地点可输入或点选。
          优先使用校园本地步行路网，跨区默认经下沉隧道；教学、实验楼可穿行，建筑终点就近到达。
        </p>
      )}
    </aside>
  );
}
