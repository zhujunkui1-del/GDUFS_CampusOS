import {
  Map as LibreMap,
  Marker,
  MercatorCoordinate,
  LngLat,
  type GeoJSONSource,
  setWorkerUrl,
  type EaseToOptions,
} from "maplibre-gl";
import type { MapAdapter, MapMode } from "@/domain/maps/contracts";
import {
  campusData,
  buildingLabelParts,
  placeLayer,
  type Coordinate,
  type MapLayer,
} from "../data/campus";
import manifest from "../data/local-map-manifest.json";
import { boundsOf, pointInPolygon } from "../data/geometry";
import { viewportFootprint } from "../data/local-viewport";
import {
  CAMPUS_MAX_ZOOM,
  CAMPUS_MIN_ZOOM,
  CAMPUS_PITCH,
  campusViewport,
} from "../data/viewport";
import {
  onlineSearch,
  planOnlineRoute,
  toGcj02,
  toWgs84,
} from "./online-services";
import { sdkCoordinate, type SDKPoi } from "./amap-types";
import type { CampusRoute, RoutePoint } from "./amap-adapter";
import { nearestTunnelDistance, planLocalRoute } from "../data/local-routing";
import walkwayReview from "../data/walkway-review.json";
import { cameraDuration, mapEase } from "../data/map-motion";
import { projectOnPath } from "../data/route-progress";
import { headingBetween } from "../data/navigation-geometry";
import {
  modelPilot,
  modelPilotAvailable,
  pilotVolume,
  pilotCourtyard,
  pilotModelCorners,
  type PilotModelState,
} from "../data/model-pilot";
import type { Nanyuan7ModelLayer } from "../layers/nanyuan7-model-layer";

type CameraEvent = "zoomend" | "rotateend" | "moveend" | "pitchend";
// Dataset geometry is immutable for this release; do not rescan it per gesture frame.
const cameraScope = campusViewport(
  campusData.places.flatMap((p) => p.geometry || [p.coordinate]),
);
const scopeWestNorth = MercatorCoordinate.fromLngLat([
  cameraScope.southwest[0],
  cameraScope.northeast[1],
]);
const scopeEastSouth = MercatorCoordinate.fromLngLat([
  cameraScope.northeast[0],
  cameraScope.southwest[1],
]);
export class LocalMapAdapter implements MapAdapter {
  readonly native: LibreMap;
  readonly supports3D: boolean;
  readonly map;
  private markers = new Map<
    string,
    { marker: Marker; button: HTMLButtonElement; visible: boolean }
  >();
  private zoneMarkers: Marker[] = [];
  private endpointMarkers: Marker[] = [];
  private listeners = new Set<(id: string) => void>();
  private routes = new Map<string, CampusRoute>();
  private activeRouteId?: string;
  private layers: Record<MapLayer, boolean> = {
    buildings: true,
    sports: true,
    dormitories: true,
    services: true,
  };
  private observer?: ResizeObserver;
  private routePanelObserver?: ResizeObserver;
  private observedRoutePanel?: Element;
  private selected?: string;
  private destroyed = false;
  private interaction: "browse" | "pick" | "navigation" = "browse";
  private cameraTargetZoom?: number;
  private followSuspended = false;
  private navigationHasPosition = false;
  private navigationPanelObserver?: ResizeObserver;
  private lastFollow?: Coordinate;
  private pendingPitch?: number;
  private cameraRevision = 0;
  private cameraTargetKey?: string;
  private displayMode: MapMode = "2d";
  private modelLayer?: Nanyuan7ModelLayer;
  private modelLoading = false;
  private modelState: PilotModelState = "idle";
  private modelListeners = new Set<(state: PilotModelState) => void>();
  get modelAvailable() {
    return modelPilotAvailable && this.supports3D;
  }
  private constructor(private element: HTMLElement) {
    setWorkerUrl("/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs");
    const memory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;
    this.supports3D = !(memory && memory < 4);
    this.native = new LibreMap({
      container: element,
      bearing: 0,
      pitch: 0,
      center: [113.392, 23.066],
      zoom: 16,
      // MapLibre's 512px world is one zoom level above the old 256px SDK scale.
      minZoom: CAMPUS_MIN_ZOOM - 1,
      maxZoom: CAMPUS_MAX_ZOOM,
      maxPitch: CAMPUS_PITCH,
      attributionControl: false,
      renderWorldCopies: false,
      refreshExpiredTiles: false,
      canvasContextAttributes: {
        antialias: false,
        powerPreference: "low-power",
      },
      style: {
        version: 8,
        sources: { campus: { type: "geojson", data: manifest.url } },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#f2f1ec" },
          },
          {
            id: "land",
            type: "fill",
            source: "campus",
            filter: ["==", ["get", "kind"], "land"],
            paint: { "fill-color": "#eeede7" },
          },
          {
            id: "green",
            type: "fill",
            source: "campus",
            filter: ["==", ["get", "kind"], "green"],
            paint: { "fill-color": "#d5e3cf" },
          },
          {
            id: "water",
            type: "fill",
            source: "campus",
            filter: [
              "all",
              ["==", ["get", "kind"], "water"],
              ["==", ["geometry-type"], "Polygon"],
            ],
            paint: { "fill-color": "#bfdae2" },
          },
          {
            id: "sports",
            type: "fill",
            source: "campus",
            filter: [
              "all",
              ["==", ["get", "kind"], "sports"],
              ["==", ["geometry-type"], "Polygon"],
            ],
            paint: {
              "fill-color": [
                "case",
                [
                  "in",
                  ["get", "sourceId"],
                  [
                    "literal",
                    campusData.places
                      .filter((p) => p.category === "swimming")
                      .map((p) => p.id),
                  ],
                ],
                "#bfdae2",
                [
                  "match",
                  ["get", "sport"],
                  "soccer",
                  "#b8d0a1",
                  "basketball",
                  "#d4b6a2",
                  "tennis",
                  "#b0c9bd",
                  "#ccd3c0",
                ],
              ],
              "fill-outline-color": "#fafaf6",
            },
          },
          {
            id: "roads-outline",
            type: "line",
            source: "campus",
            filter: ["==", ["get", "kind"], "road"],
            paint: {
              "line-color": "#d7d5ce",
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                15,
                4,
                19,
                22,
              ],
            },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "plazas",
            type: "fill",
            source: "campus",
            filter: ["==", ["get", "kind"], "plaza"],
            paint: { "fill-color": "#e9e9e5", "fill-outline-color": "#b9bcb9" },
          },
          {
            id: "parking",
            type: "fill",
            source: "campus",
            filter: ["==", ["get", "kind"], "parking"],
            paint: { "fill-color": "#e6e6e1", "fill-outline-color": "#b9bcb9" },
          },
          {
            id: "roads",
            type: "line",
            source: "campus",
            filter: ["==", ["get", "kind"], "road"],
            paint: {
              "line-color": "#fffef9",
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                15,
                2,
                19,
                18,
              ],
            },
            layout: { "line-join": "round", "line-cap": "round" },
          },
          {
            id: "buildings",
            type: "fill",
            source: "campus",
            filter: ["==", ["get", "kind"], "building"],
            paint: { "fill-color": "#e0d8ce", "fill-outline-color": "#bdb5aa" },
          },
          {
            id: "underground",
            type: "line",
            source: "campus",
            filter: ["==", ["get", "tunnel"], "yes"],
            paint: {
              "line-color": "#7c8894",
              "line-width": 4,
              "line-dasharray": [2, 2],
            },
          },
          {
            id: "selected",
            type: "fill",
            source: "campus",
            filter: ["==", ["get", "sourceId"], ""],
            paint: {
              "fill-color": "#1261bb",
              "fill-opacity": 0.35,
              "fill-outline-color": "#1261bb",
            },
          },
        ],
      },
    });
    this.native.setTransformConstrain((center, zoom) =>
      this.constrain(center, zoom),
    );
    // Keep the business interface independent of the renderer's camera vocabulary.
    this.map = {
      on: (name: CameraEvent, fn: () => void) =>
        this.native.on(name === "rotateend" ? "rotateend" : name, fn),
      getZoom: () => this.native.getZoom(),
      getRotation: () => this.native.getBearing(),
      setZoom: (zoom: number) => this.animateCamera({ zoom }),
      setRotation: (bearing: number) => this.animateCamera({ bearing }),
      setZoomAndCenter: (zoom: number, center: Coordinate) =>
        this.animateCamera({ center, zoom }),
    };
    this.native.on("moveend", () => {
      this.element.dataset.cameraMoving = String(this.native.isMoving());
      this.updateLabels();
    });
    this.native.on("move", () => {
      this.element.dataset.cameraFrameCount = String(
        Number(this.element.dataset.cameraFrameCount || 0) + 1,
      );
    });
    this.native.on("idle", () => {
      if (this.native.isStyleLoaded())
        this.element.dataset.sportsFeatureCount = String(
          this.native.queryRenderedFeatures({ layers: ["sports"] }).length,
        );
    });
    this.native.on("dragstart", () => {
      this.followSuspended = true;
      ++this.cameraRevision;
    });
    this.native.on("zoomend", () => {
      this.cameraTargetZoom = undefined;
    });
    this.native.on("click", (event) => {
      if (this.interaction !== "browse") return;
      const feature = this.native.queryRenderedFeatures(event.point, {
        layers: [
          "buildings",
          "sports",
          "plazas",
          "underground",
          "roads",
          "parking",
        ],
      })[0];
      let id =
        this.pickedPilot(event.point)?.id || feature?.properties.sourceId;
      id = campusData.places.find((p) => p.id === id)?.labelPlaceId || id;
      const children = id ? buildingLabelParts(id) : [];
      if (children.length)
        id = children.sort((a, b) => {
          const x = this.native.project(a.coordinate),
            y = this.native.project(b.coordinate);
          return (
            Math.hypot(x.x - event.point.x, x.y - event.point.y) -
            Math.hypot(y.x - event.point.x, y.y - event.point.y)
          );
        })[0].id;
      if (campusData.places.some((p) => p.id === id)) {
        this.focusPlace(id);
        this.listeners.forEach((fn) => fn(id));
      }
    });
    this.native.on("webglcontextlost", () => {
      element.dataset.renderState = "context-lost";
    });
    this.native.on("webglcontextrestored", () => {
      element.dataset.renderState = "ready";
    });
  }
  static async create(element: HTMLElement, signal: AbortSignal) {
    const adapter = new LocalMapAdapter(element);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("本地地图数据加载超时，请重试。")),
          15000,
        );
        const cancel = () => {
          clearTimeout(timeout);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        signal.addEventListener("abort", cancel, { once: true });
        adapter.native.once("load", () => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", cancel);
          resolve();
        });
        adapter.native.once("error", () => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", cancel);
          reject(
            new Error("本地地图渲染失败，请检查浏览器 WebGL 支持后重试。"),
          );
        });
      });
      adapter.initializePilot();
      for (const place of campusData.places) {
        if (place.labelPlaceId && place.labelPlaceId !== place.id) continue;
        const button = document.createElement("button");
        button.className = `campus-marker marker-${placeLayer(place)}`;
        button.textContent = place.name;
        button.setAttribute("aria-label", `查看${place.name}`);
        button.dataset.placeId = place.id;
        button.onclick = (e) => {
          e.stopPropagation();
          if (adapter.interaction === "navigation") return;
          if (adapter.interaction !== "pick") adapter.focusPlace(place.id);
          adapter.listeners.forEach((fn) => fn(place.id));
        };
        const marker = new Marker({ element: button, anchor: "bottom" })
          .setLngLat(place.coordinate)
          .addTo(adapter.native);
        adapter.markers.set(place.id, { marker, button, visible: true });
      }
      for (const zone of campusData.zones) {
        const [sw, ne] = boundsOf(zone.polygon);
        const label = document.createElement("span");
        label.className = "campus-zone-label";
        label.textContent = zone.id === "teaching" ? "教学区" : "生活区";
        adapter.zoneMarkers.push(
          new Marker({ element: label, anchor: "center" })
            .setLngLat([(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2])
            .addTo(adapter.native),
        );
      }
      adapter.updateLabels();
      element.dataset.renderState = "ready";
      return adapter;
    } catch (error) {
      adapter.destroy();
      throw error;
    }
  }
  get minimumZoom() {
    return this.minimumZoomForPitch(
      Math.max(
        this.native.getPitch(),
        this.pendingPitch ?? this.native.getPitch(),
      ),
    );
  }
  private minimumZoomForPitch(pitch: number) {
    const a = MercatorCoordinate.fromLngLat([
      manifest.bounds[0],
      manifest.bounds[3],
    ]);
    const b = MercatorCoordinate.fromLngLat([
      manifest.bounds[2],
      manifest.bounds[1],
    ]);
    const diameter = Math.hypot(
      this.element.clientWidth,
      this.element.clientHeight,
    );
    // A cloned camera invokes constraints before the main map exposes new angles.
    const footprint = viewportFootprint(diameter, diameter, pitch, 0);
    return Math.max(
      CAMPUS_MIN_ZOOM - 1,
      Math.log2(
        Math.max(
          footprint.width / (b.x - a.x),
          footprint.height / (b.y - a.y),
        ) / 512,
      ) + 0.025,
    );
  }
  private constrain(
    center: LngLat,
    proposedZoom: number,
    pitch = Math.max(
      this.native.getPitch(),
      this.pendingPitch ?? this.native.getPitch(),
    ),
  ) {
    const zoom = Math.max(
      this.minimumZoomForPitch(pitch),
      Math.min(CAMPUS_MAX_ZOOM, proposedZoom),
    );
    const a = MercatorCoordinate.fromLngLat([
        manifest.bounds[0],
        manifest.bounds[3],
      ]),
      b = MercatorCoordinate.fromLngLat([
        manifest.bounds[2],
        manifest.bounds[1],
      ]);
    const diameter = Math.hypot(
      this.element.clientWidth,
      this.element.clientHeight,
    );
    const footprint = viewportFootprint(diameter, diameter, pitch, 0);
    const x = footprint.width / (2 * 512 * 2 ** zoom),
      y = footprint.height / (2 * 512 * 2 ** zoom);
    const point = MercatorCoordinate.fromLngLat(center);
    return {
      center: new MercatorCoordinate(
        Math.max(
          a.x + x,
          scopeWestNorth.x,
          Math.min(b.x - x, scopeEastSouth.x, point.x),
        ),
        Math.max(
          a.y + y,
          scopeWestNorth.y,
          Math.min(b.y - y, scopeEastSouth.y, point.y),
        ),
      ).toLngLat(),
      zoom,
    };
  }
  async initializeViewport() {
    this.setZone(
      "all",
      this.element.clientWidth < 761 ? [160, 110, 18, 18] : [40, 40, 110, 70],
    );
    this.observer = new ResizeObserver(() => {
      if (!this.destroyed) {
        this.native.resize();
        this.native.triggerRepaint();
        if (this.activeRouteId) this.fitRoute(this.activeRouteId);
      }
    });
    this.observer.observe(this.element);
  }
  setView(center: readonly [number, number], zoom: number) {
    this.animatePoints(
      [[...center]],
      this.native.getPitch(),
      this.native.getBearing(),
      zoom,
    );
  }
  setPitch(pitch: number) {
    const next = this.supports3D
      ? Math.max(0, Math.min(CAMPUS_PITCH, pitch))
      : 0;
    const route = this.routes.get(this.activeRouteId || ""),
      place = campusData.places.find((p) => p.id === this.selected);
    if (this.navigationHasPosition && this.lastFollow)
      this.animatePoints(
        [this.lastFollow],
        next,
        this.native.getBearing(),
        this.native.getZoom(),
      );
    else if (route)
      this.animatePoints(
        route.pathGcj02.map(toWgs84),
        next,
        this.native.getBearing(),
        18,
      );
    else if (place)
      this.animatePoints(
        place.geometry && place.geometry.length > 3
          ? place.geometry
          : [place.coordinate],
        next,
        this.native.getBearing(),
        Math.max(
          place.id === modelPilot.placeId ? 19.2 : 17.2,
          this.native.getZoom(),
        ),
      );
    else this.animateCamera({ pitch: next });
  }
  private initializePilot() {
    if (!this.modelAvailable) return;
    this.native.addSource("nanyuan7-volume", {
      type: "geojson",
      data: pilotVolume(),
    });
    this.native.addSource("nanyuan7-courtyard", {
      type: "geojson",
      data: pilotCourtyard(),
    });
    this.native.addLayer({
      id: "nanyuan7-courtyard",
      type: "fill",
      source: "nanyuan7-courtyard",
      paint: { "fill-color": "#c7d3b9" },
    });
    this.native.addLayer({
      id: "nanyuan7-volume",
      type: "fill-extrusion",
      source: "nanyuan7-volume",
      minzoom: 16.7,
      paint: {
        "fill-extrusion-color": "#e4d9c6",
        "fill-extrusion-height": modelPilot.heightMeters,
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    });
    this.element.dataset.modelPlaceId = modelPilot.placeId;
    this.element.dataset.modelHeight = String(modelPilot.heightMeters);
    this.element.dataset.modelVersion = modelPilot.modelVersion;
    this.element.dataset.modelVolumeVersion = modelPilot.volumeVersion;
    this.element.dataset.modelState = "idle";
    this.updateModelVisibility();
  }
  onModelState(listener: (state: PilotModelState) => void) {
    this.modelListeners.add(listener);
    listener(this.modelState);
    return () => {
      this.modelListeners.delete(listener);
    };
  }
  private setModelState(state: PilotModelState) {
    if (this.destroyed) return;
    this.modelState = state;
    this.element.dataset.modelState = state;
    this.updateModelVisibility();
    this.modelListeners.forEach((fn) => fn(state));
  }
  setDisplayMode(mode: MapMode, animate = true) {
    if (mode !== "2d" && !this.supports3D) mode = "2d";
    if (mode === "3d" && !this.modelAvailable) mode = "2.5d";
    this.displayMode = mode;
    if (mode === "2d" && this.modelState === "error")
      this.setModelState("idle");
    this.updateModelVisibility();
    if (mode === "3d") void this.loadDetailedModel();
    if (animate) this.setPitch(mode === "2d" ? 0 : CAMPUS_PITCH);
  }
  private async loadDetailedModel() {
    if (
      this.modelLoading ||
      this.modelState === "loading" ||
      this.modelLayer?.ready
    )
      return;
    this.modelLoading = true;
    this.setModelState("loading");
    try {
      const { Nanyuan7ModelLayer } =
        await import("../layers/nanyuan7-model-layer");
      if (this.destroyed) return;
      if (this.displayMode !== "3d") {
        this.setModelState("idle");
        return;
      }
      if (this.native.getLayer("nanyuan7-model"))
        this.native.removeLayer("nanyuan7-model");
      this.modelLayer = new Nanyuan7ModelLayer((state) =>
        this.setModelState(state),
      );
      this.native.addLayer(
        this.modelLayer,
        this.native.getLayer("route") ? "route" : undefined,
      );
      this.modelLayer.setAppearance(
        this.selected === modelPilot.placeId,
        !!this.activeRouteId,
      );
      this.updateModelVisibility();
    } catch {
      if (!this.destroyed) this.setModelState("error");
    } finally {
      this.modelLoading = false;
    }
  }
  private updateModelVisibility() {
    if (!this.native.getLayer("nanyuan7-volume")) return;
    const detailed = this.displayMode === "3d" && !!this.modelLayer?.ready;
    const volumeVisible = this.displayMode !== "2d" && !detailed;
    this.native.setLayoutProperty(
      "nanyuan7-volume",
      "visibility",
      volumeVisible ? "visible" : "none",
    );
    this.native.setLayoutProperty(
      "nanyuan7-courtyard",
      "visibility",
      this.displayMode === "2d" ? "none" : "visible",
    );
    this.native.setPaintProperty(
      "nanyuan7-volume",
      "fill-extrusion-opacity",
      this.activeRouteId ? 0.4 : 1,
    );
    if (this.modelLayer) this.modelLayer.visible = detailed;
    this.element.dataset.modelVolume = volumeVisible ? "visible" : "none";
    this.element.dataset.modelDetailed = detailed ? "visible" : "none";
    this.native.triggerRepaint();
  }
  private pickedPilot(point: { x: number; y: number }) {
    if (this.displayMode === "2d" || !this.modelAvailable) return undefined;
    const hit =
      this.modelLayer?.pick(point) ||
      this.native.queryRenderedFeatures([point.x, point.y], {
        layers: ["nanyuan7-volume"],
      }).length > 0;
    if (hit)
      this.element.dataset.modelPickCount = String(
        Number(this.element.dataset.modelPickCount || 0) + 1,
      );
    return hit
      ? campusData.places.find((p) => p.id === modelPilot.placeId)
      : undefined;
  }
  private elevatedPixel(
    point: Coordinate,
    height: number,
    matrix: ArrayLike<number>,
  ) {
    const m = MercatorCoordinate.fromLngLat(point, height);
    const w = matrix[3] * m.x + matrix[7] * m.y + matrix[11] * m.z + matrix[15];
    return {
      x:
        (((matrix[0] * m.x + matrix[4] * m.y + matrix[8] * m.z + matrix[12]) /
          w +
          1) *
          this.element.clientWidth) /
        2,
      y:
        ((1 -
          (matrix[1] * m.x + matrix[5] * m.y + matrix[9] * m.z + matrix[13]) /
            w) *
          this.element.clientHeight) /
        2,
    };
  }
  private animateCamera(options: EaseToOptions) {
    const key = JSON.stringify(options);
    if (this.native.isMoving() && this.cameraTargetKey === key) return;
    const revision = ++this.cameraRevision;
    this.cameraTargetKey = key;
    if (options.pitch !== undefined) this.pendingPitch = options.pitch;
    this.native.stop();
    this.cameraTargetZoom = options.zoom;
    this.element.dataset.cameraMoving = "true";
    this.element.dataset.cameraAnimationCount = String(
      Number(this.element.dataset.cameraAnimationCount || 0) + 1,
    );
    this.element.dataset.lastCameraDuration = String(cameraDuration());
    this.native.once("moveend", () => {
      if (this.cameraRevision !== revision) return;
      this.element.dataset.cameraMoving = "false";
      this.native.triggerRepaint();
      this.updateLabels();
    });
    this.native.easeTo({
      ...options,
      duration: cameraDuration(),
      easing: mapEase,
      essential: false,
    });
  }
  zoomBy(delta: number) {
    this.animateCamera({
      zoom: Math.max(
        this.minimumZoom,
        Math.min(
          CAMPUS_MAX_ZOOM,
          (this.cameraTargetZoom ?? this.native.getZoom()) + delta,
        ),
      ),
    });
  }
  setInteractionMode(mode: "browse" | "pick" | "navigation") {
    if (mode === "pick" && this.interaction !== "pick") {
      ++this.cameraRevision;
      this.native.stop();
    }
    if (mode === "navigation" && this.interaction !== "navigation")
      this.followSuspended = false;
    if (mode !== this.interaction) {
      this.navigationPanelObserver?.disconnect();
      this.navigationHasPosition = false;
      if (mode === "navigation") {
        this.navigationPanelObserver = new ResizeObserver(() => {
          if (!this.navigationHasPosition && this.interaction === "navigation")
            this.setNavigationView(this.native.getBearing());
        });
        for (const selector of [
          ".navigation-direction",
          ".navigation-summary",
        ]) {
          const el = document.querySelector(selector);
          if (el) this.navigationPanelObserver.observe(el);
        }
      }
    }
    this.interaction = mode;
    this.updateLabels();
  }
  private visiblePadding() {
    const width = this.element.clientWidth,
      height = this.element.clientHeight;
    let panel = document
      .querySelector(".route-planner")
      ?.getBoundingClientRect();
    if (!panel) {
      const viewport = document
          .querySelector(".place-details-viewport")
          ?.getBoundingClientRect(),
        frame = document.querySelector<HTMLElement>(".place-details-frame");
      if (
        viewport &&
        frame &&
        !frame
          .closest(".place-details-panel")
          ?.hasAttribute("data-ending-style")
      )
        panel = {
          ...viewport,
          left: viewport.left,
          right: viewport.right,
          top: viewport.bottom - frame.offsetHeight,
          bottom: viewport.bottom,
        } as DOMRect;
    }
    const top = document
      .querySelector(
        this.interaction === "navigation"
          ? ".navigation-direction"
          : ".map-top",
      )
      ?.getBoundingClientRect();
    const footer = document
      .querySelector(".navigation-summary")
      ?.getBoundingClientRect();
    const main = document
      .getElementById("main-content")
      ?.getBoundingClientRect();
    const ai = document
      .querySelector(".assistant-panel")
      ?.getBoundingClientRect();
    const panelAcrossMap = panel && panel.right - panel.left > width * 0.75;
    const aiAcrossMap = ai && ai.width > width * 0.75;
    return {
      top: Math.min(height * 0.35, (top?.bottom || 40) + 20),
      bottom: Math.max(
        footer
          ? height - footer.top + 20
          : panelAcrossMap && panel
            ? height - panel.top + 20
            : 90,
        aiAcrossMap ? height - ai.top + 20 : 0,
      ),
      left:
        width < 761 || panelAcrossMap
          ? 20
          : panel
            ? panel.right + 24
            : Math.max(30, (main?.left || 0) + 110),
      right:
        !aiAcrossMap && ai && ai.left < width && ai.width > 0
          ? width - ai.left + 20
          : 78,
    };
  }
  private animatePoints(
    points: Coordinate[],
    pitch: number,
    bearing: number,
    maxZoom: number,
  ) {
    const required = this.minimumZoomForPitch(pitch);
    if (
      pitch > this.native.getPitch() + 0.1 &&
      this.native.getZoom() < required
    ) {
      if (cameraDuration() === 0) {
        this.pendingPitch = this.native.getPitch();
        this.native.jumpTo({ zoom: required + 0.01 });
      } else {
        this.pendingPitch = this.native.getPitch();
        this.animateCamera({
          zoom: required + 0.01,
          pitch: this.native.getPitch(),
        });
        const revision = this.cameraRevision;
        this.native.once("moveend", () =>
          requestAnimationFrame(() => {
            if (!this.destroyed && this.cameraRevision === revision)
              this.animatePoints(points, pitch, bearing, maxZoom);
          }),
        );
        return;
      }
    }
    this.pendingPitch = pitch;
    const padding = this.visiblePadding(),
      camera = this.native.cameraForBounds(boundsOf(points), {
        padding,
        absolutePadding: true,
        maxZoom,
        bearing,
        pitch,
      });
    if (!camera) return;
    // Work on an off-screen transform; correction passes never paint a jump.
    // MapLibre is pinned to 6.14.0 and this projection seam is browser-tested.
    const trial = this.native._camera.transform.clone();
    trial.setConstrainOverride((center, zoom) =>
      this.constrain(center, zoom, pitch),
    );
    trial.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    trial.setPitch(pitch);
    trial.setBearing(bearing);
    trial.setZoom(points.length === 1 ? maxZoom : camera.zoom!);
    trial.setCenter(LngLat.convert(camera.center!));
    const fittingModel =
      this.displayMode !== "2d" &&
      this.selected === modelPilot.placeId &&
      points.length === modelPilot.geometry.coordinates[0].length &&
      points.every(
        (p, i) =>
          p[0] === modelPilot.geometry.coordinates[0][i][0] &&
          p[1] === modelPilot.geometry.coordinates[0][i][1],
      );
    for (let i = 0; i < 6; i++) {
      const matrix = fittingModel
        ? trial.getProjectionDataForCustomLayer(false).mainMatrix
        : undefined;
      const pixels =
        fittingModel && matrix && this.displayMode === "3d"
          ? pilotModelCorners.map(({ coordinate, height }) =>
              this.elevatedPixel(coordinate, height, matrix),
            )
          : points.flatMap((p) => {
              const ground = trial.locationToScreenPoint(LngLat.convert(p));
              return matrix
                ? [
                    ground,
                    this.elevatedPixel(p, modelPilot.heightMeters, matrix),
                  ]
                : [ground];
            });
      const xs = pixels.map((p) => p.x),
        ys = pixels.map((p) => p.y),
        shiftX =
          (Math.min(...xs) + Math.max(...xs)) / 2 -
          (padding.left + this.element.clientWidth - padding.right) / 2,
        shiftY =
          (Math.min(...ys) + Math.max(...ys)) / 2 -
          (padding.top + this.element.clientHeight - padding.bottom) / 2;
      const ratio =
        points.length === 1
          ? 1
          : Math.min(
              Math.max(
                40,
                this.element.clientWidth - padding.left - padding.right,
              ) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
              Math.max(
                40,
                this.element.clientHeight - padding.top - padding.bottom,
              ) / Math.max(1, Math.max(...ys) - Math.min(...ys)),
            );
      const zoom = Math.max(
        required,
        Math.min(maxZoom, trial.zoom + Math.log2(ratio)),
      );
      if (
        Math.abs(shiftX) < 2 &&
        Math.abs(shiftY) < 2 &&
        Math.abs(zoom - trial.zoom) < 0.015
      )
        break;
      const center = trial.centerPoint.clone();
      center.x += shiftX;
      center.y += shiftY;
      const bounded = this.constrain(
        trial.screenPointToLocation(center),
        zoom,
        pitch,
      );
      trial.setCenter(bounded.center);
      trial.setZoom(bounded.zoom);
    }
    this.animateCamera({
      center: trial.center,
      zoom: trial.zoom,
      pitch,
      bearing,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  }
  followLocation(point: Coordinate, heading?: number) {
    if (this.followSuspended) return;
    this.navigationHasPosition = true;
    this.lastFollow = point;
    this.animatePoints(
      [point],
      this.native.getPitch(),
      heading ?? this.native.getBearing(),
      Math.max(17.5, this.native.getZoom()),
    );
  }
  resumeFollow() {
    this.followSuspended = false;
  }
  setNavigationView(heading?: number) {
    if (this.activeRouteId) {
      const route = this.routes.get(this.activeRouteId)!;
      const path = route.pathGcj02.map(toWgs84);
      if (this.navigationHasPosition && this.lastFollow) {
        const index = projectOnPath(this.lastFollow, path).index;
        this.followLocation(
          this.lastFollow,
          heading ??
            headingBetween(
              path[index],
              path[Math.min(index + 1, path.length - 1)],
            ),
        );
        return;
      }
      this.animatePoints(
        path,
        this.native.getPitch(),
        heading ?? headingBetween(path[0], path[1]),
        18,
      );
    }
  }
  setZone(zone: "all" | "teaching" | "living", padding = [170, 120, 110, 80]) {
    const points = campusData.zones
      .filter((z) => zone === "all" || z.id === zone)
      .flatMap((z) => z.polygon);
    if (zone === "all" || zone === "living")
      points.push(
        ...campusData.places
          .filter((p) => p.zone === "living")
          .flatMap((p) => p.geometry || [p.coordinate]),
      );
    this.native.fitBounds(boundsOf(points), {
      padding: {
        top: padding[0],
        bottom: padding[1],
        left: padding[2],
        right: padding[3],
      },
      bearing: 0,
      maxZoom: 17.4,
      duration: 0,
    });
    // cameraForBounds uses a planar fit. Calibrate synchronously against this
    // renderer's actual perspective projection, without waiting for animation frames.
    for (let i = 0; i < 5; i++) {
      const pixels = points.map((p) => this.native.project(p));
      const xs = pixels.map((p) => p.x),
        ys = pixels.map((p) => p.y);
      const left = Math.min(...xs),
        right = Math.max(...xs),
        top = Math.min(...ys),
        bottom = Math.max(...ys);
      const ratio = Math.min(
        (this.element.clientWidth - padding[2] - padding[3]) / (right - left),
        (this.element.clientHeight - padding[0] - padding[1]) / (bottom - top),
      );
      const shiftX =
        (left + right) / 2 -
        (padding[2] + this.element.clientWidth - padding[3]) / 2;
      const shiftY =
        (top + bottom) / 2 -
        (padding[0] + this.element.clientHeight - padding[1]) / 2;
      if (
        Math.abs(Math.log2(ratio)) < 0.02 &&
        Math.abs(shiftX) < 3 &&
        Math.abs(shiftY) < 3
      )
        break;
      const center = this.native.unproject([
        this.element.clientWidth / 2 + shiftX,
        this.element.clientHeight / 2 + shiftY,
      ]);
      this.native.jumpTo({
        center,
        zoom: Math.max(
          this.minimumZoom,
          Math.min(17.4, this.native.getZoom() + Math.log2(ratio)),
        ),
      });
    }
  }
  focusPlace(id: string) {
    const place = campusData.places.find((p) => p.id === id);
    if (!place) throw new Error("地点不存在或尚未核验。");
    this.highlightPlace(id);
    requestAnimationFrame(() => {
      if (this.destroyed || this.selected !== id || this.interaction === "pick")
        return;
      this.animatePoints(
        place.geometry && place.geometry.length > 3
          ? place.geometry
          : [place.coordinate],
        this.native.getPitch(),
        this.native.getBearing(),
        Math.max(
          place.id === modelPilot.placeId ? 19.2 : 17.2,
          this.native.getZoom(),
        ),
      );
    });
  }
  highlightPlace(id: string) {
    const place = campusData.places.find((p) => p.id === id);
    if (!place) throw new Error("地点不存在或尚未核验。");
    this.selected = id;
    this.layers[placeLayer(place)] = true;
    this.native.setFilter("selected", [
      "==",
      ["get", "sourceId"],
      place.geometry ? id : place.parentId || id,
    ]);
    this.modelLayer?.setAppearance(
      id === modelPilot.placeId,
      !!this.activeRouteId,
    );
    this.updateLabels();
  }
  clearSelection() {
    this.selected = undefined;
    this.native.setFilter("selected", ["==", ["get", "sourceId"], ""]);
    this.modelLayer?.setAppearance(false, !!this.activeRouteId);
    this.updateLabels();
  }
  focusOnline(poi: SDKPoi) {
    this.setView(toWgs84(sdkCoordinate(poi.location)), 18);
  }
  showPlaces(ids: string[]) {
    for (const id of ids) {
      const place = campusData.places.find((p) => p.id === id);
      if (!place) throw new Error("包含未知地点。");
      this.layers[placeLayer(place)] = true;
    }
    this.updateLabels();
  }
  setLayerVisibility(layer: string, visible: boolean) {
    if (!(layer in this.layers)) throw new Error("该图层尚不可用。");
    this.layers[layer as MapLayer] = visible;
    this.updateLabels();
  }
  private updateLabels() {
    if (this.native.isStyleLoaded())
      this.element.dataset.sportsFeatureCount = String(
        this.native.queryRenderedFeatures({ layers: ["sports"] }).length,
      );
    for (const marker of this.zoneMarkers)
      marker.getElement().hidden = this.native.getZoom() > 15.4;
    const width = this.element.clientWidth,
      height = this.element.clientHeight;
    this.element.dataset.groundCorners = JSON.stringify(
      [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map((p) => this.native.unproject([p[0], p[1]]).toArray()),
    );
    this.element.dataset.pitch = this.native.getPitch().toFixed(2);
    if (this.modelAvailable) {
      const matrix =
        this.native._camera.transform.getProjectionDataForCustomLayer(
          false,
        ).mainMatrix;
      const pixels =
        this.displayMode === "3d"
          ? pilotModelCorners.map(({ coordinate, height }) =>
              this.elevatedPixel(coordinate, height, matrix),
            )
          : modelPilot.geometry.coordinates[0].flatMap((p) =>
              [0, modelPilot.heightMeters].map((h) =>
                this.elevatedPixel([p[0], p[1]], h, matrix),
              ),
            );
      this.element.dataset.modelExtent = JSON.stringify([
        Math.min(...pixels.map((p) => p.x)),
        Math.min(...pixels.map((p) => p.y)),
        Math.max(...pixels.map((p) => p.x)),
        Math.max(...pixels.map((p) => p.y)),
      ]);
    }
    const pixels = campusData.zones
      .flatMap((z) => z.polygon)
      .map((p) => this.native.project(p));
    this.element.dataset.campusExtent = JSON.stringify([
      Math.min(...pixels.map((p) => p.x)),
      Math.min(...pixels.map((p) => p.y)),
      Math.max(...pixels.map((p) => p.x)),
      Math.max(...pixels.map((p) => p.y)),
    ]);
    const active = this.routes.get(this.activeRouteId || "");
    if (active) {
      const pixels = active.pathGcj02
        .map(toWgs84)
        .map((p) => this.native.project(p));
      this.element.dataset.routeExtent = JSON.stringify([
        Math.min(...pixels.map((p) => p.x)),
        Math.min(...pixels.map((p) => p.y)),
        Math.max(...pixels.map((p) => p.x)),
        Math.max(...pixels.map((p) => p.y)),
      ]);
    }
    const occupied: { x: number; y: number; width: number }[] = [];
    for (const place of [...campusData.places].sort(
      (a, b) =>
        Number(b.id === this.selected) - Number(a.id === this.selected) ||
        a.minZoom - b.minZoom,
    )) {
      const entry = this.markers.get(place.id);
      if (!entry) continue;
      const pixel = this.native.project(place.coordinate),
        width = Math.max(60, place.name.length * 12 + 24);
      const visible =
        this.layers[placeLayer(place)] &&
        (this.interaction !== "navigation" ||
          this.routes.get(this.activeRouteId || "")?.end.placeId ===
            place.id) &&
        (place.id === this.selected ||
          (this.native.getZoom() >= place.minZoom - 1 &&
            this.native.getZoom() <= (place.maxZoom ?? Infinity) &&
            !occupied.some(
              (p) =>
                Math.abs(p.x - pixel.x) < (p.width + width) / 2 + 8 &&
                Math.abs(p.y - pixel.y) < 30,
            )));
      if (visible) occupied.push({ x: pixel.x, y: pixel.y, width });
      if (visible !== entry.visible) {
        entry.button.hidden = !visible;
        entry.visible = visible;
      }
      entry.button.classList.toggle("selected", place.id === this.selected);
    }
  }
  pickPlace(listener: (id: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  pickCoordinate(listener: (point: RoutePoint) => void) {
    const handler = (event: {
      lngLat: LngLat;
      point: { x: number; y: number };
    }) => {
      if (this.interaction === "navigation") return;
      const pilot = this.pickedPilot(event.point);
      if (pilot) {
        listener({
          name: pilot.name,
          coordinateGcj02: toGcj02(pilot.coordinate),
          zone: pilot.zone,
          source: "user_map_selection",
          placeId: pilot.id,
        });
        return;
      }
      const point: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      const zone = campusData.zones.find((z) =>
        pointInPolygon(point, z.polygon),
      );
      if (zone || nearestTunnelDistance(point) <= 25) {
        let place = campusData.places.find(
          (p) =>
            p.geometry &&
            p.geometry.length > 3 &&
            [
              "building",
              "teaching",
              "dormitory",
              "canteen",
              "library",
              "sports_hall",
              "parking",
            ].includes(p.category) &&
            pointInPolygon(point, p.geometry),
        );
        if (place) {
          const children = campusData.places.filter(
            (p) => p.parentId === place!.id && !p.geometry,
          );
          if (children.length)
            place = children.sort(
              (a, b) =>
                Math.hypot(
                  a.coordinate[0] - point[0],
                  a.coordinate[1] - point[1],
                ) -
                Math.hypot(
                  b.coordinate[0] - point[0],
                  b.coordinate[1] - point[1],
                ),
            )[0];
        }
        listener({
          name: place?.name || "地图选点",
          coordinateGcj02: toGcj02(point),
          zone: zone?.id || "connection",
          source: "user_map_selection",
          placeId: place?.id,
        });
      }
    };
    this.native.on("click", handler);
    return () => {
      this.native.off("click", handler);
    };
  }
  onlineSearch = onlineSearch;
  async planRoute(start: RoutePoint, end: RoutePoint) {
    const local = planLocalRoute(start, end);
    if (
      !local &&
      (start.zone !== end.zone ||
        start.zone === "connection" ||
        end.zone === "connection")
    )
      throw new Error(
        walkwayReview.approved
          ? "当前选点未连接步道，请重新选点。"
          : "跨区通道暂不可用。",
      );
    const route = local || (await planOnlineRoute(start, end));
    if (!this.destroyed) this.routes.set(route.id, route);
    return route;
  }
  showEndpoints(start: RoutePoint | null, end: RoutePoint | null) {
    this.endpointMarkers.forEach((m) => m.remove());
    this.endpointMarkers = [];
    for (const [point, label] of [
      [start, "起"],
      [end, "终"],
    ] as const) {
      if (!point) continue;
      const el = document.createElement("span");
      el.className =
        "route-endpoint " +
        (label === "起" ? "route-start-marker" : "route-end-marker");
      el.textContent = label;
      el.setAttribute("aria-label", label === "起" ? "已选起点" : "已选终点");
      this.endpointMarkers.push(
        new Marker({ element: el, anchor: "center" })
          .setLngLat(toWgs84(point.coordinateGcj02))
          .addTo(this.native),
      );
    }
  }
  showLocation(coordinate: Coordinate, accuracy: number, focus = false) {
    const ring: Coordinate[] = [];
    for (let i = 0; i <= 48; i++) {
      const angle = (i * Math.PI * 2) / 48;
      ring.push([
        coordinate[0] +
          (Math.sin(angle) * accuracy) /
            (111320 * Math.cos((coordinate[1] * Math.PI) / 180)),
        coordinate[1] + (Math.cos(angle) * accuracy) / 111320,
      ]);
    }
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "accuracy" },
          geometry: { type: "Polygon", coordinates: [ring] },
        },
        {
          type: "Feature",
          properties: { kind: "position" },
          geometry: { type: "Point", coordinates: coordinate },
        },
      ],
    };
    const source = this.native.getSource("device-position") as
      GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      this.native.addSource("device-position", { type: "geojson", data });
      this.native.addLayer({
        id: "position-accuracy",
        type: "fill",
        source: "device-position",
        filter: ["==", ["get", "kind"], "accuracy"],
        paint: {
          "fill-color": "#1261bb",
          "fill-opacity": 0.1,
          "fill-outline-color": "#1261bb",
        },
      });
      this.native.addLayer({
        id: "position-dot",
        type: "circle",
        source: "device-position",
        filter: ["==", ["get", "kind"], "position"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#1261bb",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      });
    }
    if (focus) this.setView(coordinate, Math.max(17, this.native.getZoom()));
  }
  clearLocation() {
    for (const id of ["position-dot", "position-accuracy"])
      if (this.native.getLayer(id)) this.native.removeLayer(id);
    if (this.native.getSource("device-position"))
      this.native.removeSource("device-position");
  }
  renderRoute(id: string) {
    const route = this.routes.get(id);
    if (!route) throw new Error("路线不存在或已失效。");
    this.activeRouteId = id;
    this.setDisplayMode("2d", false);
    this.modelLayer?.setAppearance(this.selected === modelPilot.placeId, true);
    const path = route.pathGcj02
      .slice(route.approachPathGcj02 ? 1 : 0)
      .map(toWgs84);
    const data: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: path },
    };
    const existing = this.native.getSource("route") as
      GeoJSONSource | undefined;
    if (existing) existing.setData(data);
    else {
      this.native.addSource("route", { type: "geojson", data });
      this.native.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: { "line-color": "#1261bb", "line-width": 6 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
    }
    this.fitRoute(id);
    if (route.approachPathGcj02 && !this.native.getSource("route-approach")) {
      this.element.dataset.routeApproach = "dashed";
      this.native.addSource("route-approach", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: route.approachPathGcj02.map(toWgs84),
          },
        },
      });
      this.native.addLayer({
        id: "route-approach",
        type: "line",
        source: "route-approach",
        paint: {
          "line-color": "#1261bb",
          "line-width": 5,
          "line-dasharray": [1.5, 1.5],
        },
      });
    }
    this.showEndpoints(
      { ...route.start, coordinateGcj02: route.pathGcj02[0] },
      { ...route.end, coordinateGcj02: route.pathGcj02.at(-1)! },
    );
    if (
      route.undergroundPathGcj02?.length &&
      !this.native.getSource("route-underground")
    ) {
      this.native.addSource("route-underground", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiLineString",
            coordinates: route.undergroundPathGcj02.map((path) =>
              path.map(toWgs84),
            ),
          },
        },
      });
      this.native.addLayer({
        id: "route-underground",
        type: "line",
        source: "route-underground",
        paint: {
          "line-color": "#fff",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });
    }
  }
  installRoute(route: CampusRoute) {
    this.clearRoute();
    this.routes.set(route.id, route);
  }
  private fitRoute(id: string) {
    const fit = () => {
      if (this.destroyed || this.activeRouteId !== id) return;
      const route = this.routes.get(id);
      if (!route) return;
      const panel = document.querySelector(".route-planner");
      if (panel !== this.observedRoutePanel) {
        this.routePanelObserver?.disconnect();
        this.observedRoutePanel = panel || undefined;
        if (panel) {
          this.routePanelObserver = new ResizeObserver(() => {
            if (this.activeRouteId) this.fitRoute(this.activeRouteId);
          });
          this.routePanelObserver.observe(panel);
        }
      }
      this.animatePoints(route.pathGcj02.map(toWgs84), 0, 0, 18);
    };
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      fit();
    }, 60);
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer);
      fit();
    });
  }
  clearRoute() {
    ++this.cameraRevision;
    this.cameraTargetKey = undefined;
    this.native.stop();
    this.element.dataset.cameraMoving = "false";
    this.activeRouteId = undefined;
    this.modelLayer?.setAppearance(this.selected === modelPilot.placeId, false);
    this.updateModelVisibility();
    this.routePanelObserver?.disconnect();
    this.observedRoutePanel = undefined;
    this.showEndpoints(null, null);
    if (this.native.getLayer("route-approach"))
      this.native.removeLayer("route-approach");
    if (this.native.getSource("route-approach"))
      this.native.removeSource("route-approach");
    delete this.element.dataset.routeExtent;
    delete this.element.dataset.routeApproach;
    if (this.native.getLayer("route")) this.native.removeLayer("route");
    if (this.native.getLayer("route-underground"))
      this.native.removeLayer("route-underground");
    if (this.native.getSource("route-underground"))
      this.native.removeSource("route-underground");
    if (this.native.getSource("route")) this.native.removeSource("route");
    this.routes.clear();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();
    this.routePanelObserver?.disconnect();
    this.navigationPanelObserver?.disconnect();
    this.listeners.clear();
    this.modelListeners.clear();
    this.markers.forEach((m) => m.marker.remove());
    this.zoneMarkers.forEach((marker) => marker.remove());
    this.endpointMarkers.forEach((m) => m.remove());
    this.native.remove();
  }
}
