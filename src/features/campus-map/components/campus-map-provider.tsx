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
import { executeMapAction } from "../interactions/map-action-controller";
import { campusRouteFromSnapshot } from "../interactions/route-snapshot";
import { type SDKPoi } from "../adapters/amap-types";
import { CAMPUS_MIN_ZOOM, CAMPUS_PITCH } from "../data/viewport";
import { useMapLocation } from "./use-map-location";
import { toGcj02, toWgs84 } from "../adapters/online-services";
import { pointInPolygon } from "../data/geometry";
import { nearestTunnelDistance } from "../data/local-routing";
import { projectOnPath } from "../data/route-progress";
import { headingBetween } from "../data/navigation-geometry";
import { type PilotModelState } from "../data/model-pilot";

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
  modelAvailable: boolean;
  modelState: PilotModelState;
  locationBusy: boolean;
  locationMessage: string;
  navigating: boolean;
  navigationProgress: {
    remaining: number;
    step: number;
    heading: number;
  } | null;
  navigationOrientation: "north" | "route";
  setNavigationOrientation(value: "north" | "route"): void;
  locationNoticeId: string;
  locationNoticeVisible: boolean;
  dismissLocationNotice(id: string): void;
  locate(): void;
  useMyLocation(): void;
  beginNavigation(): void;
  stopNavigation(): void;
  choosePoint(
    which: "start" | "end",
    place: CampusPlace,
    focus?: boolean,
  ): void;
  clearPoint(which: "start" | "end"): void;
  swapPoints(a: RoutePoint, b: RoutePoint): void;
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
  installRoute(snapshot: unknown): void;
  getInteractionVersion(): number;
  getAssistantSelection(): { placeId: string | null; revision: number };
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
  onNavigationStart,
}: {
  children: React.ReactNode;
  onAskAssistant(): void;
  onNavigationStart?(): void;
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
  const [mode, setModeState] = useState<MapMode>("2d");
  const [zone, setZoneState] = useState<MapContextValue["zone"]>("all");
  const [selected, setSelected] = useState<CampusPlace | null>(null);
  const assistantSelection = useRef<{
    placeId: string | null;
    revision: number;
  }>({ placeId: null, revision: 0 });
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
  const [modelAvailable, setModelAvailable] = useState(false);
  const [modelState, setModelState] = useState<PilotModelState>("idle");
  const routeGeneration = useRef(0);
  const interactionVersion = useRef(0);
  const location = useMapLocation();
  const stopLocation = location.stop;
  const [navigationActive, setNavigationActive] = useState(false);
  const [navigationPath, setNavigationPath] = useState(pathname);
  if (navigationPath !== pathname) {
    setNavigationPath(pathname);
    if (pathname !== "/map") setNavigationActive(false);
  }
  const [navigationOrientation, setNavigationOrientation] = useState<
    "north" | "route"
  >("north");
  const [locationRequest, setLocationRequest] = useState(0),
    [dismissedNotice, setDismissedNotice] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const locationFeedback =
    location.busy && !navigationActive
      ? "正在请求设备定位…"
      : location.error || locationMessage;
  const locationNoticeId = locationRequest + ":" + locationFeedback;
  const [navigationProgress, setNavigationProgress] =
    useState<MapContextValue["navigationProgress"]>(null);
  const focusLocation = useRef(false),
    locationAsStart = useRef(false);
  const currentRoute = useRef(route);
  useEffect(() => {
    currentRoute.current = route;
  }, [route]);
  const setPoint = useCallback(
    (which: "start" | "end", point: RoutePoint) => {
      ++interactionVersion.current;
      ++routeGeneration.current;
      adapter.current?.clearRoute();
      setRoute(null);
      setRouteBusy(false);
      setError("");
      stopLocation();
      setNavigationActive(false);
      adapter.current?.setInteractionMode("browse");
      setNavigationProgress(null);
      if (which === "start") setStart(point);
      else setEnd(point);
      pickRef.current = null;
      setPicking(null);
    },
    [stopLocation],
  );
  const choosePoint = useCallback(
    (which: "start" | "end", place: CampusPlace, focus = true) => {
      setPoint(which, {
        name: place.name,
        coordinateGcj02: toGcj02(place.coordinate),
        zone: place.zone,
        source: "campus_place",
        placeId: place.id,
      });
      if (focus) adapter.current?.focusPlace(place.id);
      else adapter.current?.highlightPlace(place.id);
      setLayers((prior) => ({ ...prior, [placeLayer(place)]: true }));
    },
    [setPoint],
  );
  useEffect(() => {
    adapter.current?.showEndpoints(
      route ? { ...route.start, coordinateGcj02: route.pathGcj02[0] } : start,
      route ? { ...route.end, coordinateGcj02: route.pathGcj02.at(-1)! } : end,
    );
  }, [start, end, status, route]);
  useEffect(() => {
    if (pathname !== "/map") {
      stopLocation();
    }
  }, [pathname, stopLocation]);
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) {
        stopLocation();
        setNavigationProgress(null);
        setLocationMessage("定位已暂停。");
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stopLocation]);
  useEffect(() => {
    const position = location.position;
    if (!position) return;
    const update = () => {
      const { coordinate, accuracy, timestamp } = position;
      if (Date.now() - timestamp > 30000) {
        adapter.current?.clearLocation();
        setLocationMessage("定位已过期，请重新定位。");
        setNavigationProgress(null);
        return;
      }
      if (
        !campusData.zones.some((z) => pointInPolygon(coordinate, z.polygon)) &&
        nearestTunnelDistance(coordinate) > 25
      ) {
        adapter.current?.clearLocation();
        setLocationMessage("当前位置在校外，请选择校内起点。");
        setNavigationProgress(null);
        return;
      }
      if (accuracy > 100) {
        adapter.current?.clearLocation();
        setLocationMessage(
          `定位误差约${Math.round(accuracy)}米，暂不用于导航，请重新定位。`,
        );
        setNavigationProgress(null);
        return;
      }
      adapter.current?.showLocation(
        coordinate,
        accuracy,
        focusLocation.current,
      );
      focusLocation.current = false;
      if (locationAsStart.current) {
        locationAsStart.current = false;
        const zone = campusData.zones.find((z) =>
          pointInPolygon(coordinate, z.polygon),
        );
        setPoint("start", {
          name: "我的位置",
          coordinateGcj02: toGcj02(coordinate),
          zone: zone?.id || "connection",
          source: "device_location",
        });
      }
      setLocationMessage(`定位精度约${Math.round(accuracy)}米。`);
      if (!location.tracking || !currentRoute.current) return;
      if (accuracy > 50) {
        setLocationMessage("定位精度不足，请重新定位。");
        setNavigationProgress(null);
        return;
      }
      const r = currentRoute.current;
      const projection = projectOnPath(coordinate, r.pathGcj02.map(toWgs84));
      if (projection.distance > Math.max(25, accuracy)) {
        setLocationMessage("已偏离路线，请重新规划。");
        setNavigationProgress(null);
        return;
      }
      const traveled =
        (projection.along / Math.max(1, projection.total)) * r.distanceMeters;
      let sum = 0,
        step = 0;
      for (let i = 0; i < r.steps.length; i++) {
        sum += r.steps[i].distance;
        step = i;
        if (sum >= traveled) break;
      }
      setNavigationProgress({
        remaining: Math.max(0, r.distanceMeters - traveled),
        step,
        heading: headingBetween(
          toWgs84(r.pathGcj02[projection.index]),
          toWgs84(
            r.pathGcj02[Math.min(r.pathGcj02.length - 1, projection.index + 1)],
          ),
        ),
      });
    };
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [
    location.position,
    location.tracking,
    setPoint,
    status,
    navigationActive,
    navigationOrientation,
  ]);
  const view = useRef<{ mode: MapMode; zone: MapContextValue["zone"] }>({
    mode: "2d",
    zone: "all",
  });

  useEffect(() => {
    if (!mapRequested) return;
    let cancelled = false;
    let disposePick: (() => void) | undefined,
      disposeCoordinate: (() => void) | undefined,
      disposeModel: (() => void) | undefined;
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
        setModelAvailable(next.modelAvailable);
        disposeModel = next.onModelState((state) => {
          if (cancelled) return;
          setModelState(state);
          if (state === "error" && view.current.mode === "3d") {
            view.current.mode = "2.5d";
            setModeState("2.5d");
            next.setDisplayMode("2.5d");
          }
        });
        if (!next.supports3D) {
          view.current.mode = "2d";
          setModeState("2d");
        }
        const lowMemory = (navigator as Navigator & { deviceMemory?: number })
          .deviceMemory;
        if (lowMemory && lowMemory < 4) {
          next.setDisplayMode("2d");
          view.current.mode = "2d";
          setModeState("2d");
        }
        disposePick = next.pickPlace((id) => {
          ++interactionVersion.current;
          if (pickRef.current) {
            const place = campusData.places.find((p) => p.id === id);
            if (place) choosePoint(pickRef.current, place, false);
            return;
          }
          setSelected(campusData.places.find((p) => p.id === id) || null);
          assistantSelection.current = {
            placeId: id,
            revision: assistantSelection.current.revision + 1,
          };
        });
        disposeCoordinate = next.pickCoordinate((point) => {
          const which = pickRef.current;
          if (!which) return;
          const chosen = {
            ...point,
            name: point.placeId
              ? point.name
              : which === "start"
                ? "地图选定起点"
                : "地图选定终点",
          };
          setPoint(which, chosen);
          if (point.placeId) next.highlightPlace(point.placeId);
        });
        next.map.on("zoomend", () => {
          setZoom(next.map.getZoom());
          setMinimumZoom(next.minimumZoom);
        });
        next.map.on("rotateend", () => setBearing(next.map.getRotation()));
        for (const event of [
          "dragstart",
          "zoomstart",
          "rotatestart",
        ] as const) {
          next.native.on(event, (detail) => {
            if (
              event === "dragstart" ||
              ("originalEvent" in detail && detail.originalEvent)
            )
              ++interactionVersion.current;
          });
        }
        if (!cancelled) {
          // Fit only after the real renderer knows its viewport dimensions.
          next.setDisplayMode(view.current.mode, false);
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
      disposeModel?.();
      adapter.current?.destroy();
      adapter.current = null;
    };
  }, [revision, mapRequested, choosePoint, setPoint]);

  const select = useCallback((id: string, manual = true) => {
    ++interactionVersion.current;
    const place = campusData.places.find((p) => p.id === id);
    if (!place) {
      setError("地点不存在或尚未核验。");
      return;
    }
    setSelected(place);
    if (manual)
      assistantSelection.current = {
        placeId: id,
        revision: assistantSelection.current.revision + 1,
      };
    adapter.current?.focusPlace(id);
    setLayers((prior) => ({ ...prior, [placeLayer(place)]: true }));
  }, []);
  const clearRoute = useCallback(() => {
    ++interactionVersion.current;
    ++routeGeneration.current;
    adapter.current?.clearRoute();
    setRoute(null);
    setRouteBusy(false);
    setError("");
    stopLocation();
    setNavigationActive(false);
    setNavigationProgress(null);
  }, [stopLocation]);
  useEffect(() => {
    adapter.current?.setInteractionMode(
      navigationActive ? "navigation" : picking ? "pick" : "browse",
    );
    if (navigationActive) {
      if (
        location.tracking &&
        location.position &&
        route &&
        location.position.accuracy <= 50 &&
        Date.now() - location.position.timestamp < 30000
      ) {
        const path = route.pathGcj02.map(toWgs84),
          projection = projectOnPath(location.position.coordinate, path);
        if (projection.distance <= Math.max(25, location.position.accuracy)) {
          adapter.current?.followLocation(
            location.position.coordinate,
            navigationOrientation === "north"
              ? 0
              : headingBetween(
                  path[projection.index],
                  path[Math.min(projection.index + 1, path.length - 1)],
                ),
          );
          return;
        }
      }
      adapter.current?.setNavigationView(
        navigationOrientation === "north" ? 0 : undefined,
      );
    }
  }, [
    navigationActive,
    navigationOrientation,
    picking,
    route,
    location.position,
    location.tracking,
  ]);
  const plan = async () => {
    ++interactionVersion.current;
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
    modelAvailable,
    modelState,
    locationBusy: location.busy,
    locationMessage: locationFeedback,
    locationNoticeId,
    locationNoticeVisible:
      !!locationFeedback && dismissedNotice !== locationNoticeId,
    dismissLocationNotice: setDismissedNotice,
    navigating: navigationActive,
    navigationOrientation,
    setNavigationOrientation,
    navigationProgress,
    locate: () => {
      ++interactionVersion.current;
      adapter.current?.resumeFollow();
      setLocationRequest((n) => n + 1);
      focusLocation.current = true;
      locationAsStart.current = false;
      location.request(navigationActive);
    },
    useMyLocation: () => {
      setLocationRequest((n) => n + 1);
      focusLocation.current = true;
      locationAsStart.current = true;
      location.request(false);
    },
    beginNavigation: () => {
      if (route) {
        setNavigationActive(true);
        setSelected(null);
        onNavigationStart?.();
        setLocationRequest((n) => n + 1);
        setNavigationProgress(null);
        location.request(true);
      }
    },
    stopNavigation: () => {
      clearRoute();
      setStart(null);
      setEnd(null);
      setSelected(null);
      pickRef.current = null;
      setPicking(null);
      adapter.current?.showEndpoints(null, null);
      adapter.current?.clearSelection();
      adapter.current?.setInteractionMode("browse");
      view.current.mode = "2d";
      setModeState("2d");
      adapter.current?.setDisplayMode("2d");
    },
    choosePoint,
    clearPoint: (which) => {
      clearRoute();
      if (which === "start") setStart(null);
      else setEnd(null);
    },
    swapPoints: (a, b) => {
      clearRoute();
      setStart(b);
      setEnd(a);
      pickRef.current = null;
      setPicking(null);
    },
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
      ++interactionVersion.current;
      if (next !== "2d" && !adapter.current?.supports3D) return;
      if (next === "3d" && !adapter.current?.modelAvailable) return;
      view.current.mode = next;
      setModeState(next);
      adapter.current?.setDisplayMode(next);
    },
    setLayer: (layer, visible) => {
      setLayers((prior) => ({ ...prior, [layer]: visible }));
      adapter.current?.setLayerVisibility(layer, visible);
    },
    select,
    closeDetails: () => setSelected(null),
    zoomBy: (delta) => {
      ++interactionVersion.current;
      adapter.current?.zoomBy(delta);
    },
    rotateBy: (delta) => {
      ++interactionVersion.current;
      const map = adapter.current?.map;
      if (map) map.setRotation(map.getRotation() + delta);
    },
    resetBearing: () => {
      ++interactionVersion.current;
      adapter.current?.map.setRotation(0);
    },
    startPicking: (which) => {
      ++interactionVersion.current;
      clearRoute();
      setSelected(null);
      pickRef.current = which;
      setPicking(which);
      adapter.current?.setInteractionMode("pick");
    },
    cancelPicking: () => {
      pickRef.current = null;
      setPicking(null);
      adapter.current?.setInteractionMode("browse");
    },
    plan,
    clearRoute,
    searchOnline: async (query) =>
      adapter.current ? adapter.current.onlineSearch(query) : [],
    focusOnline: (poi) => {
      ++interactionVersion.current;
      adapter.current?.focusOnline(poi);
    },
    askAssistant: (place) => {
      ++interactionVersion.current;
      setAssistantPlace(place);
      assistantSelection.current = {
        placeId: place.id,
        revision: assistantSelection.current.revision + 1,
      };
      setSelected(null);
      onAskAssistant();
    },
    executeAction: (input) => {
      if (!adapter.current) throw new Error("地图尚未就绪。");
      executeMapAction(input, {
        hasPlace: (id) => campusData.places.some((p) => p.id === id),
        hasRoute: (id) => currentRoute.current?.id === id,
        focusPlace: (id) => select(id, false),
        showPlaceDetails: (id) => {
          const place = campusData.places.find((p) => p.id === id)!;
          setSelected(place);
          setLayers((prior) => ({ ...prior, [placeLayer(place)]: true }));
        },
        showPlaces: (ids) => adapter.current!.showPlaces(ids),
        showRoute: (id) => adapter.current!.renderRoute(id),
        clearRoute: context.stopNavigation,
        setViewMode: (next) => {
          if (
            (next !== "2d" && !adapter.current?.supports3D) ||
            (next === "3d" && !adapter.current?.modelAvailable)
          )
            throw new Error("当前设备不支持此地图模式。");
          context.setMode(next);
        },
        setLayer: context.setLayer,
      });
    },
    installRoute: (input) => {
      if (!adapter.current) throw new Error("地图尚未就绪。");
      const result = campusRouteFromSnapshot(input);
      ++routeGeneration.current;
      stopLocation();
      setNavigationActive(false);
      setNavigationProgress(null);
      adapter.current.installRoute(result);
      currentRoute.current = result;
      setRoute(result);
      setStart(result.start);
      setEnd(result.end);
      setRouteBusy(false);
      setError("");
      setSelected(null);
      pickRef.current = null;
      setPicking(null);
      adapter.current.setInteractionMode("browse");
      view.current.mode = "2d";
      setModeState("2d");
    },
    getInteractionVersion: () => interactionVersion.current,
    getAssistantSelection: () => assistantSelection.current,
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
