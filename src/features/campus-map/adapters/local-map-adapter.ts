import {
  Map as LibreMap,
  Marker,
  MercatorCoordinate,
  LngLat,
  type GeoJSONSource,
  setWorkerUrl,
} from "maplibre-gl";
import type { MapAdapter } from "@/domain/maps/contracts";
import {
  campusData,
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
  private constructor(private element: HTMLElement) {
    setWorkerUrl("/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs");
    const memory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;
    this.supports3D = !(memory && memory < 4);
    this.native = new LibreMap({
      container: element,
      bearing: 0,
      pitch: this.supports3D ? CAMPUS_PITCH : 0,
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
      setZoom: (zoom: number) => this.native.jumpTo({ zoom }),
      setRotation: (bearing: number) => this.native.jumpTo({ bearing }),
      setZoomAndCenter: (zoom: number, center: Coordinate) =>
        this.native.jumpTo({ center, zoom }),
    };
    this.native.on("moveend", () => this.updateLabels());
    this.native.on("click", (event) => {
      const feature = this.native.queryRenderedFeatures(event.point, {
        layers: ["buildings", "sports", "plazas", "underground"],
      })[0];
      let id = feature?.properties.sourceId;
      const children = id
        ? campusData.places.filter((p) => p.parentId === id)
        : [];
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
      for (const place of campusData.places) {
        const button = document.createElement("button");
        button.className = `campus-marker marker-${placeLayer(place)}`;
        button.textContent = place.name;
        button.setAttribute("aria-label", `查看${place.name}`);
        button.dataset.placeId = place.id;
        button.onclick = (e) => {
          e.stopPropagation();
          adapter.focusPlace(place.id);
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
    const footprint = viewportFootprint(diameter, diameter, CAMPUS_PITCH, 0);
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
  private constrain(center: LngLat, proposedZoom: number) {
    const zoom = Math.max(
      this.minimumZoom,
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
    const footprint = viewportFootprint(diameter, diameter, CAMPUS_PITCH, 0);
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
        this.native.jumpTo({ center: this.native.getCenter() });
        if (this.activeRouteId) this.fitRoute(this.activeRouteId);
      }
    });
    this.observer.observe(this.element);
  }
  setView(center: readonly [number, number], zoom: number) {
    this.native.jumpTo({ center: [...center], zoom });
  }
  setPitch(pitch: number) {
    this.native.jumpTo({
      pitch: this.supports3D ? Math.max(0, Math.min(CAMPUS_PITCH, pitch)) : 0,
    });
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
    this.selected = id;
    this.layers[placeLayer(place)] = true;
    this.native.setFilter("selected", [
      "==",
      ["get", "sourceId"],
      place.parentId || id,
    ]);
    this.native.jumpTo({
      center: place.coordinate,
      zoom: Math.max(17.2, this.native.getZoom()),
    });
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
    if (layer === "sports")
      this.native.setLayoutProperty(
        "sports",
        "visibility",
        visible ? "visible" : "none",
      );
    this.updateLabels();
  }
  private updateLabels() {
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
    const pixels = campusData.zones
      .flatMap((z) => z.polygon)
      .map((p) => this.native.project(p));
    this.element.dataset.campusExtent = JSON.stringify([
      Math.min(...pixels.map((p) => p.x)),
      Math.min(...pixels.map((p) => p.y)),
      Math.max(...pixels.map((p) => p.x)),
      Math.max(...pixels.map((p) => p.y)),
    ]);
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
    const handler = (event: { lngLat: LngLat }) => {
      const point: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      const zone = campusData.zones.find((z) =>
        pointInPolygon(point, z.polygon),
      );
      if (zone || nearestTunnelDistance(point) <= 25)
        listener({
          name: "地图选点",
          coordinateGcj02: toGcj02(point),
          zone: zone?.id || "connection",
          source: "user_map_selection",
        });
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
          ? "跨区路线目前仅支持下沉隧道及两端连接步道；请选取隧道生活区入口与教学区入口。其他校内连接尚未核验。"
          : "下沉隧道和两端步道通行尚待负责人确认，跨区导航暂不可用。地图标注已保留。",
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
    this.setPitch(0);
    const path = route.pathGcj02.map(toWgs84);
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
  private fitRoute(id: string) {
    const fit = () => {
      if (this.destroyed || this.activeRouteId !== id) return;
      const route = this.routes.get(id);
      if (!route) return;
      const path = route.pathGcj02.map(toWgs84);
      const panelElement = document.querySelector(".route-planner");
      if (panelElement !== this.observedRoutePanel) {
        this.routePanelObserver?.disconnect();
        this.observedRoutePanel = panelElement || undefined;
        if (panelElement) {
          this.routePanelObserver = new ResizeObserver(() => {
            if (this.activeRouteId && !this.destroyed)
              this.fitRoute(this.activeRouteId);
          });
          this.routePanelObserver.observe(panelElement);
        }
      }
      const panel = panelElement?.getBoundingClientRect();
      const top = Math.max(
        190,
        (document.querySelector(".map-top")?.getBoundingClientRect().bottom ||
          170) + 20,
      );
      const padding = {
        top,
        bottom:
          this.element.clientWidth < 761 && panel
            ? this.element.clientHeight - panel.top + 20
            : 90,
        left:
          this.element.clientWidth < 761 ? 24 : panel ? panel.right + 24 : 110,
        right: 90,
      };
      this.native.fitBounds(boundsOf(path), {
        padding,
        duration: 0,
        maxZoom: 18,
      });
      // The renderer constrains a cloned camera while fitting. Recheck the final
      // projection at its resulting zoom, especially after desktop -> phone resize.
      for (let i = 0; i < 4; i++) {
        const pixels = path.map((p) => this.native.project(p));
        const xs = pixels.map((p) => p.x),
          ys = pixels.map((p) => p.y);
        const shiftX =
          (Math.min(...xs) + Math.max(...xs)) / 2 -
          (padding.left + this.element.clientWidth - padding.right) / 2;
        const shiftY =
          (Math.min(...ys) + Math.max(...ys)) / 2 -
          (padding.top + this.element.clientHeight - padding.bottom) / 2;
        const ratio = Math.min(
          Math.max(
            60,
            this.element.clientWidth - padding.left - padding.right,
          ) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
          Math.max(
            60,
            this.element.clientHeight - padding.top - padding.bottom,
          ) / Math.max(1, Math.max(...ys) - Math.min(...ys)),
        );
        const zoom = Math.max(
          this.minimumZoom,
          Math.min(18, this.native.getZoom() + Math.log2(ratio)),
        );
        if (
          Math.abs(shiftX) < 3 &&
          Math.abs(shiftY) < 3 &&
          Math.abs(zoom - this.native.getZoom()) < 0.02
        )
          break;
        this.native.jumpTo({
          center: this.native.unproject([
            this.element.clientWidth / 2 + shiftX,
            this.element.clientHeight / 2 + shiftY,
          ]),
          zoom,
        });
      }
      const pixels = path.map((p) => this.native.project(p));
      this.element.dataset.routeExtent = JSON.stringify([
        Math.min(...pixels.map((p) => p.x)),
        Math.min(...pixels.map((p) => p.y)),
        Math.max(...pixels.map((p) => p.x)),
        Math.max(...pixels.map((p) => p.y)),
      ]);
    };
    // Measure after React commits the drawer, with a bound for background tabs.
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
    this.activeRouteId = undefined;
    this.routePanelObserver?.disconnect();
    this.observedRoutePanel = undefined;
    delete this.element.dataset.routeExtent;
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
    this.listeners.clear();
    this.markers.forEach((m) => m.marker.remove());
    this.zoneMarkers.forEach((marker) => marker.remove());
    this.endpointMarkers.forEach((m) => m.remove());
    this.native.remove();
  }
}
