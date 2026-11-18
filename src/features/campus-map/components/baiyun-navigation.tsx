"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowUpDown, LocateFixed, Navigation, X, MapPin } from "lucide-react";
import data from "../data/baiyun-map.json";
import { FocusedNavigationView } from "./focused-navigation";
import { toGcj02 } from "../adapters/online-services";
import { headingBetween } from "../data/navigation-geometry";
import type { CampusRoute } from "../adapters/amap-adapter";
import type {
  BaiyunRoute,
  BaiyunEndpoint,
  BaiyunCoordinate,
} from "../data/baiyun-routing";
import { projectOnPath } from "../data/route-progress";
import { useRouteSheet } from "./use-route-sheet";

function Endpoint({
  label,
  point,
  onChange,
  onPick,
}: {
  label: string;
  point: BaiyunEndpoint | null;
  onChange(p: BaiyunEndpoint | null): void;
  onPick(): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftPoint, setDraftPoint] = useState<string | null>(
    point?.id ?? null,
  );
  const editing = draft !== null && draftPoint === (point?.id ?? null);
  const query = editing ? draft : (point?.name ?? "");
  return (
    <div className="endpoint-field">
      <div className="route-point-input">
        <span className={`route-dot ${label === "终点" ? "route-end" : ""}`} />
        <input
          aria-label={`导航${label}`}
          placeholder={`输入${label}地点`}
          value={query}
          onChange={(e) => {
            setDraft(e.target.value);
            setDraftPoint(null);
            onChange(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
          }}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={`在地图上选择${label}`}
          onClick={() => {
            setDraft(null);
            onPick();
          }}
        >
          <MapPin size={18} />
        </button>
      </div>
      {editing && query.trim() && (
        <div
          className="endpoint-results"
          role="region"
          aria-label={`${label}地点建议`}
        >
          {data.places
            .filter((p) => p.name.includes(query.trim()))
            .slice(0, 8)
            .map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  onChange(p);
                  setDraft(null);
                }}
              >
                {p.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
export function BaiyunNavigation({
  end: initialEnd,
  initialSnapshot,
  onClose,
  onRoute,
  onPosition,
  onPick,
  onWalking,
  onEndpoints,
  onBearing,
  onResumeFollow,
}: {
  end: BaiyunEndpoint | null;
  initialSnapshot?:
    import("@/domain/maps/skill-contracts").RouteSnapshot | null;
  onBearing(value: number): void;
  onResumeFollow(): void;
  onWalking(value: boolean): void;
  onClose(): void;
  onRoute(route: BaiyunRoute | null): void;
  onPosition(p: BaiyunCoordinate, accuracy?: number): void;
  onEndpoints(start: BaiyunEndpoint | null, end: BaiyunEndpoint | null): void;
  onPick(which: "start" | "end", selected: (p: BaiyunEndpoint) => void): void;
}) {
  const [start, setStart] = useState<BaiyunEndpoint | null>(() =>
      initialSnapshot
        ? {
            id: initialSnapshot.start.placeId ?? "device",
            name: initialSnapshot.start.name,
            coordinate: initialSnapshot.start.coordinate,
          }
        : null,
    ),
    [end, setEnd] = useState<BaiyunEndpoint | null>(() =>
      initialSnapshot
        ? {
            id: initialSnapshot.end.placeId!,
            name: initialSnapshot.end.name,
            coordinate: initialSnapshot.end.coordinate,
          }
        : initialEnd,
    ),
    [route, setRoute] = useState<BaiyunRoute | null>(() =>
      initialSnapshot
        ? {
            path: initialSnapshot.path.coordinates,
            solidPath: initialSnapshot.solidPath?.coordinates,
            guidance: initialSnapshot.guidancePaths?.map(
              (line) => line.coordinates,
            ),
            distanceMeters: initialSnapshot.distanceMeters,
            seconds: initialSnapshot.estimatedSeconds,
            sourceWayIds: [],
            steps: initialSnapshot.steps.map((step) => ({
              instruction: step.instruction,
              distance: step.distanceMeters,
            })),
          }
        : null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [walking, setWalking] = useState(false),
    [remaining, setRemaining] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [trackingRequested, setTrackingRequested] = useState(0),
    [orientation, setOrientation] = useState<"north" | "route">("north"),
    [segment, setSegment] = useState(0);
  const active = useRef(true),
    generation = useRef({ value: 0 });
  const positionCallback = useRef(onPosition);
  const syncEndpoints = useEffectEvent(() => onEndpoints(start, end));
  useEffect(() => {
    syncEndpoints();
  }, [start, end]);
  const { attach, compact, collapsed, header, toggle, collapse, expand } =
    useRouteSheet();
  useEffect(() => {
    positionCallback.current = onPosition;
  }, [onPosition]);
  useEffect(() => {
    active.current = true;
    const requestGeneration = generation.current;
    return () => {
      active.current = false;
      requestGeneration.value++;
    };
  }, []);
  function reset() {
    generation.current.value++;
    setBusy(false);
    setWalking(false);
    setTrackingRequested(0);
    setRoute(null);
    setRemaining(null);
    setError("");
    setLocationStatus("");
    onRoute(null);
  }
  useEffect(() => {
    if (!walking || !route || (start?.id !== "device" && !trackingRequested))
      return;
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (result) => {
        const p: BaiyunCoordinate = [
          result.coords.longitude,
          result.coords.latitude,
        ];
        positionCallback.current(p, result.coords.accuracy);
        if (Date.now() - result.timestamp > 15000) {
          setError("定位信号不稳定，请稍后重试。");
          setRemaining(null);
          return;
        }
        const projected = projectOnPath(p, route.path);
        if (projected.distance > Math.max(60, result.coords.accuracy)) {
          setError("已偏离路线，请重新规划。");
          setRemaining(null);
          return;
        }
        setError("");
        setLocationStatus(
          result.coords.accuracy > 50
            ? `定位误差约${Math.round(result.coords.accuracy)}米`
            : "已定位",
        );
        setSegment(projected.index);
        setRemaining(
          Math.max(0, Math.round(projected.total - projected.along)),
        );
      },
      (error) => {
        setLocationStatus(error.code === 1 ? "没有授予定位权限" : "定位失败");
        setRemaining(null);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    const hide = () => {
      if (document.hidden) setWalking(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      navigator.geolocation.clearWatch(watch);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [walking, route, start?.id, trackingRequested]);
  const rotate = useEffectEvent((value: number) => onBearing(value));
  useEffect(() => {
    if (walking && route)
      rotate(
        orientation === "north"
          ? 0
          : headingBetween(
              route.path[Math.min(segment, route.path.length - 2)],
              route.path[Math.min(segment + 1, route.path.length - 1)],
            ),
      );
  }, [walking, orientation, route, segment]);
  async function plan() {
    if (!start || !end) return;
    const request = ++generation.current.value;
    setBusy(true);
    setError("");
    try {
      const { planBaiyunRoute } = await import("../data/baiyun-routing");
      const result = planBaiyunRoute(start, end);
      if (active.current && request === generation.current.value) {
        setRoute(result);
        onRoute(result);
      }
    } catch (e) {
      if (active.current && request === generation.current.value)
        setError(e instanceof Error ? e.message : "路线规划失败，请重试。");
    } finally {
      if (active.current && request === generation.current.value)
        setBusy(false);
    }
  }
  useEffect(() => {
    onWalking(walking);
    return () => onWalking(false);
  }, [walking, onWalking]);
  function myPosition() {
    if (!navigator.geolocation) {
      setLocationStatus("定位失败");
      return;
    }
    reset();
    setLocationStatus("正在定位…");
    const request = generation.current.value;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        if (!active.current || request !== generation.current.value) return;
        const coordinate: BaiyunCoordinate = [
          result.coords.longitude,
          result.coords.latitude,
        ];
        setLocationStatus(
          result.coords.accuracy > 50
            ? `定位误差约${Math.round(result.coords.accuracy)}米`
            : "已定位",
        );
        setStart({ id: "device", name: "我的位置", coordinate });
        positionCallback.current(coordinate, result.coords.accuracy);
        setBusy(false);
      },
      (error) => {
        if (active.current && request === generation.current.value) {
          setLocationStatus(error.code === 1 ? "没有授予定位权限" : "定位失败");
          setBusy(false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  if (walking && route && start && end) {
    const walked = route.distanceMeters - (remaining ?? route.distanceMeters);
    let step = route.steps.findIndex(
      (_, index) =>
        route.steps
          .slice(0, index + 1)
          .reduce((sum, s) => sum + s.distance, 0) >= walked,
    );
    if (step < 0) step = Math.max(0, route.steps.length - 1);
    const heading = headingBetween(
      route.path[Math.min(segment, route.path.length - 2)],
      route.path[Math.min(segment + 1, route.path.length - 1)],
    );
    const point = (p: BaiyunEndpoint) => ({
      name: p.name,
      coordinateGcj02: toGcj02(p.coordinate as BaiyunCoordinate),
      zone: "connection" as const,
      source:
        p.id === "device"
          ? ("device_location" as const)
          : ("campus_place" as const),
    });
    const adapted: CampusRoute = {
      id: "baiyun-current",
      start: point(start),
      end: point(end),
      pathGcj02: route.path.map(toGcj02),
      distanceMeters: route.distanceMeters,
      seconds: route.seconds,
      steps: route.steps,
      source: "CampusOS.OSM",
      verification: "reviewed_source_network",
    };
    return (
      <FocusedNavigationView
        sourceUrl={data.sourceUrl}
        modeControl={
          <button disabled className="map-mode-button">
            2D
          </button>
        }
        map={{
          route: adapted,
          navigationProgress:
            remaining === null ? null : { remaining, step, heading },
          navigationOrientation: orientation,
          setNavigationOrientation: (value) => {
            setOrientation(value);
          },
          stopNavigation: () => {
            reset();
            onClose();
          },
          locate: () => {
            setLocationStatus("正在定位…");
            onResumeFollow();
            setTrackingRequested((v) => v + 1);
          },
          locationBusy: locationStatus === "正在定位…",
          locationMessage: error || locationStatus,
        }}
      />
    );
  }
  return (
    <aside
      ref={attach}
      className="route-planner"
      aria-label="校园步行路线"
      data-sheet={compact ? (collapsed ? "collapsed" : "expanded") : "desktop"}
      data-navigation={walking ? "walking" : "planning"}
    >
      <div className="results-heading" {...header}>
        <button
          className="route-drawer-handle"
          aria-label="调整步行导航面板"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <span />
        </button>
        <h2>步行导航</h2>
        <button
          className="icon-button"
          aria-label="关闭导航面板"
          data-route-close
          onClick={() => {
            reset();
            onClose();
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div className="route-planner-scroll" inert={compact && collapsed}>
        <div className="route-planner-content">
          <div className="endpoint-list">
            <Endpoint
              label="起点"
              onPick={() => {
                if (compact) collapse();
                onPick("start", (p) => {
                  reset();
                  setStart(p);
                  if (compact) expand();
                });
              }}
              point={start}
              onChange={(p) => {
                reset();
                setStart(p);
              }}
            />
            <Endpoint
              label="终点"
              onPick={() => {
                if (compact) collapse();
                onPick("end", (p) => {
                  reset();
                  setEnd(p);
                  if (compact) expand();
                });
              }}
              point={end}
              onChange={(p) => {
                reset();
                setEnd(p);
              }}
            />
          </div>
          <div className="endpoint-shortcuts">
            <button className="text-link" disabled={busy} onClick={myPosition}>
              <LocateFixed size={15} />
              我的位置作起点
            </button>
            <button
              className="text-link"
              disabled={!start || !end}
              onClick={() => {
                reset();
                setStart(end);
                setEnd(start);
              }}
            >
              <ArrowUpDown size={15} />
              交换
            </button>
          </div>
          {!route && (
            <div className="route-actions">
              <button
                className="primary-button"
                disabled={!start || !end || busy}
                onClick={() => void plan()}
              >
                {busy ? "正在规划…" : "规划步行路线"}
              </button>
              <button
                className="text-link"
                onClick={() => {
                  reset();
                  setStart(null);
                  setEnd(null);
                }}
              >
                重置路线
              </button>
            </div>
          )}
          {locationStatus && (
            <p className="location-feedback" role="status">
              {locationStatus}
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {route && (
            <div className="route-result" data-route-source="baiyun-osm">
              <h3>
                {remaining === null
                  ? Math.round(route.distanceMeters)
                  : remaining}{" "}
                米{" "}
                <span>
                  约{" "}
                  {Math.max(
                    1,
                    Math.round((remaining ?? route.distanceMeters) / 1.2 / 60),
                  )}{" "}
                  分钟
                </span>
              </h3>
              <div className="route-actions">
                <button
                  className="primary-button navigation-start"
                  onClick={() => {
                    if (start?.id === "device" && !navigator.geolocation)
                      return;
                    setWalking((v) => !v);
                  }}
                >
                  <Navigation size={16} />
                  {walking ? "结束步行导航" : "开始步行导航"}
                </button>
                <button className="text-link" onClick={reset}>
                  重置路线
                </button>
              </div>
              <details className="route-steps">
                <summary>路线详情</summary>
                <ol>
                  {route.steps.map((s, i) => (
                    <li key={i}>
                      {s.instruction}
                      <small>{s.distance} 米</small>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
