"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import "./campus-map.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { usePathname } from "next/navigation";
import { type CampusRoute, type RoutePoint } from "../adapters/amap-adapter";
import type { LocalMapAdapter } from "../adapters/local-map-adapter";
import manifest from "../data/local-map-manifest.json";
import {
  campusData,
  placeLayer,
  type CampusPlace,
  type MapLayer,
} from "../data/campus";
import type { MapMode } from "@/domain/maps/contracts";
import { MapActionSchema } from "@/domain/maps/contracts";
import { type SDKPoi } from "../adapters/amap-types";
import {
  CAMPUS_MIN_ZOOM,
  CAMPUS_MAX_ZOOM,
  CAMPUS_PITCH,
} from "../data/viewport";

type MapContextValue = {
  status: "loading" | "ready" | "error";
  error: string;
  mode: MapMode;
  zone: "all" | "teaching" | "living";
  selected: CampusPlace | null;
  layers: Record<MapLayer, boolean>;
  route: CampusRoute | null;
  start: RoutePoint | null;
  end: RoutePoint | null;
  picking: "start" | "end" | null;
  routeBusy: boolean;
  assistantPlace: CampusPlace | null;
  zoom: number;
  supports3D: boolean;
  retry(): void;
  setZone(zone: "all" | "teaching" | "living"): void;
  setMode(mode: MapMode): void;
  setLayer(layer: MapLayer, visible: boolean): void;
  select(id: string): void;
  closeDetails(): void;
  zoomBy(delta: number): void;
  rotateBy(delta: number): void;
  resetBearing(): void;
  startPicking(which: "start" | "end"): void;
  cancelPicking(): void;
  plan(): Promise<void>;
  clearRoute(): void;
  searchOnline(query: string): Promise<SDKPoi[]>;
  focusOnline(poi: SDKPoi): void;
  askAssistant(place: CampusPlace): void;
  executeAction(action: unknown): void;
};
const MapContext = createContext<MapContextValue | null>(null);
export function useCampusMap() {
  const context = useContext(MapContext);
  if (!context) throw new Error("地图上下文不存在。");
  return context;
}

export function CampusMapProvider({
  children,
  onAskAssistant,
}: {
  children: React.ReactNode;
  onAskAssistant(): void;
}) {
  const pathname = usePathname();
  const [mapRequested, setMapRequested] = useState(pathname === "/map");
  if (pathname === "/map" && !mapRequested) setMapRequested(true);
  const element = useRef<HTMLDivElement>(null);
  const adapter = useRef<LocalMapAdapter | null>(null);
  const pickRef = useRef<"start" | "end" | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<MapContextValue["status"]>("loading");
  const [error, setError] = useState("");
  const [mode, setModeState] = useState<MapMode>("2.5d");
  const [zone, setZoneState] = useState<MapContextValue["zone"]>("all");
  const [selected, setSelected] = useState<CampusPlace | null>(null);
  const [assistantPlace, setAssistantPlace] = useState<CampusPlace | null>(
    null,
  );
  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({
    buildings: true,
    sports: true,
    dormitories: true,
    services: true,
  });
  const [route, setRoute] = useState<CampusRoute | null>(null);
  const [start, setStart] = useState<RoutePoint | null>(null),
    [end, setEnd] = useState<RoutePoint | null>(null);
  const [picking, setPicking] = useState<MapContextValue["picking"]>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [zoom, setZoom] = useState(15.5);
  const [bearing, setBearing] = useState(0);
  const [minimumZoom, setMinimumZoom] = useState(CAMPUS_MIN_ZOOM);
  const [supports3D, setSupports3D] = useState(true);
  const routeGeneration = useRef(0);
  const view = useRef<{ mode: MapMode; zone: MapContextValue["zone"] }>({
    mode: "2.5d",
    zone: "all",
  });

  useEffect(() => {
    if (!mapRequested) return;
    let cancelled = false;
    let disposePick: (() => void) | undefined,
      disposeCoordinate: (() => void) | undefined;
    const abort = new AbortController();
    void (async () => {
      try {
        const { LocalMapAdapter } =
          await import("../adapters/local-map-adapter");
        if (cancelled || !element.current) return;
        const next = await LocalMapAdapter.create(
          element.current,
          abort.signal,
        );
        if (cancelled) {
          next.destroy();
          return;
        }
        adapter.current = next;
        setSupports3D(next.supports3D);
        if (!next.supports3D) {
          view.current.mode = "2d";
          setModeState("2d");
        }
        const lowMemory = (navigator as Navigator & { deviceMemory?: number })
          .deviceMemory;
        if (lowMemory && lowMemory < 4) {
          next.setPitch(0);
          view.current.mode = "2d";
          setModeState("2d");
        }
        disposePick = next.pickPlace((id) => {
          setSelected(campusData.places.find((p) => p.id === id) || null);
        });
        disposeCoordinate = next.pickCoordinate((point) => {
          const which = pickRef.current;
          if (!which) return;
          const chosen = {
            ...point,
            name: which === "start" ? "地图选定起点" : "地图选定终点",
          };
          if (which === "start") setStart(chosen);
          else setEnd(chosen);
          pickRef.current = null;
          setPicking(null);
          setError("");
        });
        next.map.on("zoomend", () => {
          setZoom(next.map.getZoom());
          setMinimumZoom(next.minimumZoom);
        });
        next.map.on("rotateend", () => setBearing(next.map.getRotation()));
        if (!cancelled) {
          // Fit only after the real renderer knows its viewport dimensions.
          next.setPitch(view.current.mode === "2d" ? 0 : CAMPUS_PITCH);
          await next.initializeViewport();
          if (view.current.zone !== "all") next.setZone(view.current.zone);
          if (cancelled) return;
          setStatus("ready");
          setZoom(next.map.getZoom());
          setBearing(next.map.getRotation());
          setMinimumZoom(next.minimumZoom);
        }
      } catch (failure) {
        if (!cancelled) {
          setStatus("error");
          setError(
            failure instanceof Error
              ? failure.message
              : "地图加载失败，请重试。",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      disposePick?.();
      disposeCoordinate?.();
      adapter.current?.destroy();
      adapter.current = null;
    };
  }, [revision, mapRequested]);

  const select = useCallback((id: string) => {
    const place = campusData.places.find((p) => p.id === id);
    if (!place) {
      setError("地点不存在或尚未核验。");
      return;
    }
    setSelected(place);
    adapter.current?.focusPlace(id);
    setLayers((prior) => ({ ...prior, [placeLayer(place)]: true }));
  }, []);
  const clearRoute = useCallback(() => {
    ++routeGeneration.current;
    adapter.current?.clearRoute();
    setRoute(null);
    setRouteBusy(false);
    setError("");
  }, []);
  const plan = async () => {
    if (!start || !end || !adapter.current) return;
    const generation = ++routeGeneration.current;
    setRouteBusy(true);
    setError("");
    adapter.current.clearRoute();
    setRoute(null);
    try {
      const result = await adapter.current.planRoute(start, end);
      if (generation === routeGeneration.current) {
        adapter.current?.renderRoute(result.id);
        setRoute(result);
        view.current.mode = "2d";
        setModeState("2d");
      }
    } catch (failure) {
      if (generation === routeGeneration.current)
        setError(failure instanceof Error ? failure.message : "路线规划失败。");
    } finally {
      if (generation === routeGeneration.current) setRouteBusy(false);
    }
  };
  const context: MapContextValue = {
    status,
    error,
    mode,
    zone,
    selected,
    layers,
    route,
    start,
    end,
    picking,
    routeBusy,
    assistantPlace,
    zoom,
    supports3D,
    retry: () => {
      adapter.current?.destroy();
      adapter.current = null;
      setStatus("loading");
      setError("");
      setRevision((n) => n + 1);
    },
    setZone: (next) => {
      view.current.zone = next;
      setZoneState(next);
      adapter.current?.setZone(
        next,
        window.innerWidth < 761 ? [170, 150, 30, 60] : [40, 40, 110, 70],
      );
    },
    setMode: (next) => {
      if (next === "2.5d" && !adapter.current?.supports3D) return;
      view.current.mode = next;
      setModeState(next);
      adapter.current?.setPitch(next === "2d" ? 0 : CAMPUS_PITCH);
    },
    setLayer: (layer, visible) => {
      setLayers((prior) => ({ ...prior, [layer]: visible }));
      adapter.current?.setLayerVisibility(layer, visible);
    },
    select,
    closeDetails: () => setSelected(null),
    zoomBy: (delta) => {
      const current = adapter.current;
      const map = current?.map;
      if (map && current)
        map.setZoom(
          Math.max(
            current.minimumZoom,
            Math.min(CAMPUS_MAX_ZOOM, map.getZoom() + delta),
          ),
        );
    },
    rotateBy: (delta) => {
      const map = adapter.current?.map;
      if (map) map.setRotation(map.getRotation() + delta);
    },
    resetBearing: () => adapter.current?.map.setRotation(0),
    startPicking: (which) => {
      clearRoute();
      setSelected(null);
      pickRef.current = which;
      setPicking(which);
    },
    cancelPicking: () => {
      pickRef.current = null;
      setPicking(null);
    },
    plan,
    clearRoute,
    searchOnline: async (query) =>
      adapter.current ? adapter.current.onlineSearch(query) : [],
    focusOnline: (poi) => {
      adapter.current?.focusOnline(poi);
    },
    askAssistant: (place) => {
      setAssistantPlace(place);
      setSelected(null);
      onAskAssistant();
    },
    executeAction: (input) => {
      const action = MapActionSchema.parse(input);
      if (!adapter.current) throw new Error("地图尚未就绪。");
      if (
        action.type === "FOCUS_PLACE" ||
        action.type === "OPEN_PLACE_DETAILS"
      ) {
        if (!campusData.places.some((p) => p.id === action.placeId))
          throw new Error("地点不存在。");
        select(action.placeId);
      } else if (action.type === "SHOW_PLACES")
        adapter.current.showPlaces(action.placeIds);
      else if (action.type === "SHOW_ROUTE")
        adapter.current.renderRoute(action.routeId);
      else if (action.layer === "buildings" || action.layer === "services")
        adapter.current.setLayerVisibility(action.layer, action.visible);
      else throw new Error("该图层尚未接入。");
    },
  };
  return (
    <MapContext.Provider value={context}>
      <div
        ref={element}
        className="campus-map-canvas"
        style={{ visibility: pathname === "/map" ? "visible" : "hidden" }}
        aria-label="大学城校区本地地图"
        data-testid="campus-map"
        data-status={status}
        data-mode={mode}
        data-zoom={zoom.toFixed(2)}
        data-bearing={bearing.toFixed(2)}
        data-engine="maplibre-local"
        data-map-version={manifest.version}
        data-scope="campus-and-visible-context"
        data-min-zoom={minimumZoom.toFixed(2)}
      />
      {children}
    </MapContext.Provider>
  );
}
