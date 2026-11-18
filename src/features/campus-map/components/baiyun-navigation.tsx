"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, LocateFixed, Navigation, X, MapPin } from "lucide-react";
import data from "../data/baiyun-map.json";
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
          onClick={onPick}
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
  onClose,
  onRoute,
  onPosition,
  onPick,
}: {
  end: BaiyunEndpoint | null;
  onClose(): void;
  onRoute(route: BaiyunRoute | null): void;
  onPosition(p: BaiyunCoordinate): void;
  onPick(which: "start" | "end", selected: (p: BaiyunEndpoint) => void): void;
}) {
  const [start, setStart] = useState<BaiyunEndpoint | null>(null),
    [end, setEnd] = useState<BaiyunEndpoint | null>(initialEnd),
    [route, setRoute] = useState<BaiyunRoute | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [walking, setWalking] = useState(false),
    [remaining, setRemaining] = useState<number | null>(null);
  const active = useRef(true),
    generation = useRef({ value: 0 });
  const positionCallback = useRef(onPosition);
  const { attach, compact, collapsed, header, toggle } = useRouteSheet();
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
    setRoute(null);
    setRemaining(null);
    setError("");
    onRoute(null);
  }
  useEffect(() => {
    if (!walking || !route || start?.id !== "device") return;
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (result) => {
        const p: BaiyunCoordinate = [
          result.coords.longitude,
          result.coords.latitude,
        ];
        if (
          result.coords.accuracy > 100 ||
          Date.now() - result.timestamp > 15000
        ) {
          setError("定位信号不稳定，请稍后重试。");
          setRemaining(null);
          return;
        }
        const projected = projectOnPath(p, route.path);
        positionCallback.current(p);
        if (projected.distance > 60) {
          setError("已偏离路线，请重新规划。");
          setRemaining(null);
          return;
        }
        setError("");
        setRemaining(
          Math.max(0, Math.round(projected.total - projected.along)),
        );
      },
      () => {
        setWalking(false);
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
  }, [walking, route, start?.id]);
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
  function myPosition() {
    if (!navigator.geolocation) {
      return;
    }
    reset();
    const request = generation.current.value;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        if (!active.current || request !== generation.current.value) return;
        const coordinate: BaiyunCoordinate = [
          result.coords.longitude,
          result.coords.latitude,
        ];
        setStart({ id: "device", name: "我的位置", coordinate });
        positionCallback.current(coordinate);
        setBusy(false);
      },
      () => {
        if (active.current && request === generation.current.value) {
          setBusy(false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
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
              onPick={() =>
                onPick("start", (p) => {
                  reset();
                  setStart(p);
                })
              }
              point={start}
              onChange={(p) => {
                reset();
                setStart(p);
              }}
            />
            <Endpoint
              label="终点"
              onPick={() =>
                onPick("end", (p) => {
                  reset();
                  setEnd(p);
                })
              }
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
