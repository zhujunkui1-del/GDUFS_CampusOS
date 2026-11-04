import type { CampusRenderer } from "./renderer-contract";
import type { MapMode } from "@/domain/maps/contracts";
import {
  campusData,
  placeLayer,
  type Coordinate,
  type MapLayer,
} from "../data/campus";
import { boundsOf, pointInPolygon } from "../data/geometry";
import { toWgs84, toGcj02, onlineSearch } from "./online-services";
import type { SDKPoi } from "./amap-types";
import { sdkCoordinate } from "./amap-types";
import type { CampusRoute, RoutePoint } from "./amap-adapter";
import { planCampusRoute } from "../data/plan-campus-route";
import { nearestTunnelDistance, tunnelNetwork } from "../data/local-routing";
import type { PilotModelState } from "../data/model-pilot";
import manifest from "../data/local-map-manifest.json";
import { campusViewport } from "../data/viewport";
import { locationHalo } from "../data/device-location";

const cameraScope = campusViewport(
  campusData.places.flatMap((p) => p.geometry || [p.coordinate]),
);

const project = (p: readonly number[]) =>
  [
    (p[0] + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + (p[1] * Math.PI) / 360)) / Math.PI) /
      2,
  ] as const;
const unproject = (x: number, y: number): Coordinate => [
  x * 360 - 180,
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
];

/** Canvas-only renderer. Coordinates, place IDs, route service and UI remain shared. */
export class BasicMapAdapter implements CampusRenderer {
  readonly supports3D = false;
  readonly supports2_5D = false;
  readonly modelAvailable = false;
  minimumZoom = 15;
  private zoom = 16;
  private rotation = 0;
  private center: Coordinate = [113.392, 23.066];
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private destroyed = false;
  private frame = 0;
  private selected?: string;
  private interaction: "browse" | "pick" | "navigation" = "browse";
  private followSuspended = false;
  private listeners = new Set<(id: string) => void>();
  private coordinateListeners = new Set<(point: RoutePoint) => void>();
  private events = new Map<
    string,
    Set<(event: { originalEvent?: unknown }) => void>
  >();
  private buttons = new Map<string, HTMLButtonElement>();
  private layers: Record<MapLayer, boolean> = {
    buildings: true,
    sports: true,
    dormitories: true,
    services: true,
  };
  private routes = new Map<string, CampusRoute>();
  private route?: CampusRoute;
  private endpoints: [RoutePoint | null, RoutePoint | null] = [null, null];
  private location?: Coordinate;
  private accuracy = 0;
  private heading: number | null = null;
  private features: GeoJSON.Feature[] = [];
  private featurePaths: Array<{
    path: Path2D;
    kind: string;
    polygon: boolean;
    bounds: number[];
  }> = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = false;
  private abort = new AbortController();
  readonly map = {
    on: (name: string, fn: () => void) => this.on(name, fn),
    getZoom: () => this.zoom,
    getRotation: () => this.rotation,
    setZoom: (z: number) => this.setView(this.center, z),
    setRotation: (bearing: number) => {
      this.rotation = bearing;
      this.emit("rotateend");
      this.drawSoon();
    },
    setZoomAndCenter: (zoom: number, center: Coordinate) =>
      this.setView(center, zoom),
  };
  readonly native = {
    on: (name: string, fn: (event: { originalEvent?: unknown }) => void) =>
      this.on(name, fn),
  };
  onlineSearch = onlineSearch;
  private on(name: string, fn: (event: { originalEvent?: unknown }) => void) {
    const set = this.events.get(name) || new Set();
    set.add(fn);
    this.events.set(name, set);
  }
  private emit(name: string, originalEvent?: Event) {
    this.events.get(name)?.forEach((fn) => fn({ originalEvent }));
  }
  constructor(private element: HTMLElement) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw Error("浏览器无法创建基础地图画布。");
    this.ctx = ctx;
    for (const key of Object.keys(element.dataset))
      if (
        key.startsWith("campusModel") ||
        /^(modelFrame|modelDraw|modelTriangle)/.test(key)
      )
        delete element.dataset[key];
    element.replaceChildren(this.canvas);
    this.canvas.className = "basic-map-canvas";
    this.canvas.setAttribute("aria-label", "校园基础二维地图");
    this.canvas.style.cssText =
      "width:100%;height:100%;display:block;touch-action:none";
    element.dataset.renderer = "canvas2d";
    element.dataset.renderState = "ready";
    element.dataset.modelState = "idle";
    element.dataset.cameraMoving = "false";
    for (const place of campusData.places) {
      if (
        place.hiddenLabel ||
        (place.labelPlaceId && place.labelPlaceId !== place.id)
      )
        continue;
      const b = document.createElement("button");
      b.className = `campus-marker marker-${placeLayer(place)}`;
      b.textContent = place.name;
      b.setAttribute("aria-label", `查看${place.name}`);
      b.style.position = "absolute";
      b.dataset.placeId = place.id;
      b.onclick = (e) => {
        e.stopPropagation();
        if (this.interaction === "navigation") return;
        if (this.interaction === "browse") this.focusPlace(place.id);
        this.listeners.forEach((fn) => fn(place.id));
      };
      element.append(b);
      this.buttons.set(place.id, b);
    }
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.cancelPointer);
    this.canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.observer = new ResizeObserver(() => this.drawSoon());
    this.observer.observe(element);
    void fetch(manifest.url, {
      signal: this.abort.signal,
      cache: "force-cache",
    })
      .then(async (r) => {
        if (!r.ok) throw Error("map-data");
        const value = (await r.json()) as GeoJSON.FeatureCollection;
        if (!this.destroyed && value.type === "FeatureCollection") {
          this.features = value.features;
          this.featurePaths = value.features.flatMap((feature) =>
            this.cacheFeature(feature),
          );
          this.drawSoon();
          element.dataset.baseDataState = "ready";
        }
      })
      .catch(() => {
        if (!this.destroyed)
          element.dataset.baseDataState = "campus-geometry-only";
      });
  }
  private point(coordinate: readonly number[]) {
    const [x, y] = project(coordinate),
      [cx, cy] = project(this.center),
      scale = 512 * 2 ** this.zoom,
      angle = (-this.rotation * Math.PI) / 180,
      dx = (x - cx) * scale,
      dy = (y - cy) * scale;
    return {
      x:
        this.element.clientWidth / 2 +
        dx * Math.cos(angle) -
        dy * Math.sin(angle),
      y:
        this.element.clientHeight / 2 +
        dx * Math.sin(angle) +
        dy * Math.cos(angle),
    };
  }
  private coordinate(x: number, y: number) {
    const [cx, cy] = project(this.center),
      s = 512 * 2 ** this.zoom,
      a = (this.rotation * Math.PI) / 180,
      dx = x - this.element.clientWidth / 2,
      dy = y - this.element.clientHeight / 2;
    return unproject(
      cx + (dx * Math.cos(a) - dy * Math.sin(a)) / s,
      cy + (dx * Math.sin(a) + dy * Math.cos(a)) / s,
    );
  }
  private drawSoon() {
    if (!this.frame && !this.destroyed)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
  }
  private path(points: readonly (readonly number[])[], close = false) {
    if (!points.length) return;
    points.forEach((p, i) => {
      const q = this.point(p);
      if (i) this.ctx.lineTo(q.x, q.y);
      else this.ctx.moveTo(q.x, q.y);
    });
    if (close) this.ctx.closePath();
  }
  private geometry(g: GeoJSON.Geometry) {
    switch (g.type) {
      case "Polygon":
        g.coordinates.forEach((r) => this.path(r, true));
        break;
      case "MultiPolygon":
        g.coordinates.forEach((p) => p.forEach((r) => this.path(r, true)));
        break;
      case "LineString":
        this.path(g.coordinates);
        break;
      case "MultiLineString":
        g.coordinates.forEach((r) => this.path(r));
        break;
    }
  }
  private cacheFeature(feature: GeoJSON.Feature) {
    const g = feature.geometry;
    if (!g || typeof Path2D === "undefined") return [];
    const path = new Path2D(),
      bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const line = (points: GeoJSON.Position[], close = false) => {
      points.forEach((point, index) => {
        const [x, y] = project(point);
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
        if (index) path.lineTo(x, y);
        else path.moveTo(x, y);
      });
      if (close) path.closePath();
    };
    if (g.type === "Polygon") g.coordinates.forEach((p) => line(p, true));
    else if (g.type === "MultiPolygon")
      g.coordinates.forEach((p) => p.forEach((r) => line(r, true)));
    else if (g.type === "LineString") line(g.coordinates);
    else if (g.type === "MultiLineString")
      g.coordinates.forEach((p) => line(p));
    else return [];
    return [
      {
        path,
        kind: String(feature.properties?.kind || ""),
        polygon: g.type.includes("Polygon"),
        bounds,
      },
    ];
  }
  private draw() {
    const w = this.element.clientWidth,
      h = this.element.clientHeight,
      ratio = Math.min(devicePixelRatio || 1, 2);
    if (!w || !h) return;
    if (
      this.canvas.width !== Math.round(w * ratio) ||
      this.canvas.height !== Math.round(h * ratio)
    ) {
      this.canvas.width = Math.round(w * ratio);
      this.canvas.height = Math.round(h * ratio);
    }
    const c = this.ctx;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.fillStyle = "#f2f1ec";
    c.fillRect(0, 0, w, h);
    const [cx, cy] = project(this.center),
      scale = 512 * 2 ** this.zoom;
    const visibleWorld = [
      this.coordinate(0, 0),
      this.coordinate(w, 0),
      this.coordinate(0, h),
      this.coordinate(w, h),
    ].map(project);
    const area = [
      Math.min(...visibleWorld.map((p) => p[0])),
      Math.min(...visibleWorld.map((p) => p[1])),
      Math.max(...visibleWorld.map((p) => p[0])),
      Math.max(...visibleWorld.map((p) => p[1])),
    ];
    if (this.featurePaths.length) {
      c.save();
      c.translate(w / 2, h / 2);
      c.rotate((-this.rotation * Math.PI) / 180);
      c.scale(scale, scale);
      c.translate(-cx, -cy);
      for (const feature of this.featurePaths) {
        const { path, kind, polygon, bounds } = feature;
        if (
          bounds[0] > area[2] ||
          bounds[2] < area[0] ||
          bounds[1] > area[3] ||
          bounds[3] < area[1]
        )
          continue;
        if (polygon) {
          c.fillStyle =
            kind === "water"
              ? "#bfdae2"
              : kind === "green"
                ? "#d5e3cf"
                : kind === "building"
                  ? "#dcd7ce"
                  : kind === "sports"
                    ? "#c4d7ba"
                    : "#eeede7";
          c.fill(path, "evenodd");
          if (kind === "building") {
            c.strokeStyle = "#c4beb6";
            c.lineWidth = 0.6 / scale;
            c.stroke(path);
          }
        } else {
          c.strokeStyle = kind === "water" ? "#bfdae2" : "#fff";
          c.lineWidth = (kind === "road" ? 4 : 2) / scale;
          c.stroke(path);
        }
      }
      c.restore();
    }
    for (const feature of this.featurePaths.length ? [] : this.features) {
      if (!feature.geometry) continue;
      const kind = feature.properties?.kind;
      c.beginPath();
      this.geometry(feature.geometry);
      if (feature.geometry.type.includes("Polygon")) {
        c.fillStyle =
          kind === "water"
            ? "#bfdae2"
            : kind === "green"
              ? "#d5e3cf"
              : kind === "building"
                ? "#dcd7ce"
                : kind === "sports"
                  ? "#c4d7ba"
                  : "#eeede7";
        c.fill("evenodd");
        if (kind === "building") {
          c.strokeStyle = "#c4beb6";
          c.lineWidth = 0.6;
          c.stroke();
        }
      } else if (feature.geometry.type.includes("Line")) {
        c.strokeStyle = kind === "water" ? "#bfdae2" : "#fff";
        c.lineWidth = kind === "road" ? 4 : 2;
        c.stroke();
      }
    }
    if (!this.features.length) {
      for (const zone of campusData.zones) {
        c.beginPath();
        this.path(zone.polygon, true);
        c.fillStyle = "#e5e9db";
        c.fill();
      }
      for (const edge of tunnelNetwork.edges) {
        c.beginPath();
        this.path(edge.geometry);
        c.strokeStyle = "#fff";
        c.lineWidth = 3;
        c.stroke();
      }
      for (const place of campusData.places) {
        if (!place.geometry) continue;
        c.beginPath();
        this.path(place.geometry, true);
        c.fillStyle = "#dcd7ce";
        c.fill();
      }
    }
    const selected = campusData.places.find((p) => p.id === this.selected);
    if (selected?.geometry) {
      c.beginPath();
      this.path(selected.geometry, true);
      c.fillStyle = "#1261bb55";
      c.fill();
    }
    if (this.route) {
      c.beginPath();
      this.path(this.route.pathGcj02.map(toWgs84));
      c.strokeStyle = "#fff";
      c.lineWidth = 9;
      c.lineJoin = "round";
      c.stroke();
      c.strokeStyle = "#1261bb";
      c.lineWidth = 5;
      c.stroke();
    }
    for (const [i, endpoint] of this.endpoints.entries()) {
      if (!endpoint) continue;
      const p = this.point(toWgs84(endpoint.coordinateGcj02));
      c.beginPath();
      c.arc(p.x, p.y, 12, 0, Math.PI * 2);
      c.fillStyle = i ? "#1261bb" : "#398d76";
      c.fill();
      c.fillStyle = "#fff";
      c.font = "12px sans-serif";
      c.textAlign = "center";
      c.fillText(i ? "终" : "起", p.x, p.y + 4);
    }
    if (this.location) {
      const p = this.point(this.location);
      c.beginPath();
      this.path(locationHalo(this.location, this.accuracy), true);
      c.fillStyle = "#1261bb18";
      c.fill();
      c.save();
      c.translate(p.x, p.y);
      if (this.heading !== null) {
        c.rotate(((this.heading - this.rotation) * Math.PI) / 180);
        c.beginPath();
        c.moveTo(0, -22);
        c.lineTo(-8, -5);
        c.lineTo(8, -5);
        c.closePath();
        c.fillStyle = "#3275f5";
        c.fill();
      }
      c.beginPath();
      c.arc(0, 0, 8, 0, Math.PI * 2);
      c.fillStyle = "#3275f5";
      c.strokeStyle = "#fff";
      c.lineWidth = 3;
      c.fill();
      c.stroke();
      c.restore();
    }
    for (const place of campusData.places) {
      const b = this.buttons.get(place.id);
      if (!b) continue;
      const p = this.point(place.coordinate),
        visible =
          this.interaction !== "navigation" &&
          this.layers[placeLayer(place)] &&
          (this.zoom + 1 >= place.minZoom || place.id === this.selected) &&
          p.x > -100 &&
          p.x < w + 100 &&
          p.y > -50 &&
          p.y < h + 50;
      b.hidden = !visible;
      b.style.display = visible ? "" : "none";
      if (visible)
        b.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
      b.classList.toggle("selected", place.id === this.selected);
    }
    this.element.dataset.basicFrames = String(
      Number(this.element.dataset.basicFrames || 0) + 1,
    );
  }
  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.moved = false;
  };
  private move = (e: PointerEvent) => {
    const old = this.pointers.get(e.pointerId);
    if (!old) return;
    const next = { x: e.offsetX, y: e.offsetY };
    const other = [...this.pointers].find(([id]) => id !== e.pointerId)?.[1];
    if (!other && !this.moved && Math.hypot(next.x - old.x, next.y - old.y) < 5)
      return;
    if (other) {
      const before = Math.hypot(old.x - other.x, old.y - other.y),
        after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 10)
        this.zoom = Math.max(
          this.minimumZoom,
          Math.min(20, this.zoom + Math.log2(after / before)),
        );
    } else {
      const a = this.coordinate(old.x, old.y),
        b = this.coordinate(next.x, next.y);
      this.center = [
        this.center[0] + a[0] - b[0],
        this.center[1] + a[1] - b[1],
      ];
    }
    this.center = [
      Math.max(
        cameraScope.southwest[0],
        Math.min(cameraScope.northeast[0], this.center[0]),
      ),
      Math.max(
        cameraScope.southwest[1],
        Math.min(cameraScope.northeast[1], this.center[1]),
      ),
    ];
    this.pointers.set(e.pointerId, next);
    this.moved = true;
    this.followSuspended = true;
    this.emit("dragstart", e);
    this.drawSoon();
  };
  private cancelPointer = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
  };
  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (!this.moved && this.interaction !== "navigation") {
      const point = this.coordinate(e.offsetX, e.offsetY),
        zone = campusData.zones.find((z) => pointInPolygon(point, z.polygon));
      if (zone || nearestTunnelDistance(point) <= 25)
        this.coordinateListeners.forEach((fn) =>
          fn({
            name: "地图选点",
            coordinateGcj02: toGcj02(point),
            zone: zone?.id || "connection",
            source: "user_map_selection",
          }),
        );
    }
    this.emit("moveend");
    this.emit("zoomend");
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.followSuspended = true;
    this.emit("zoomstart", e);
    this.setView(this.center, this.zoom + (e.deltaY < 0 ? 0.3 : -0.3));
  };
  async initializeViewport() {
    const points = campusData.places.flatMap(
      (p) => p.geometry || [p.coordinate],
    );
    const [sw, ne] = boundsOf(points),
      a = project(sw),
      b = project(ne);
    this.center = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
    this.minimumZoom = Math.min(
      16,
      Math.log2(
        Math.min(
          this.element.clientWidth / (Math.abs(a[0] - b[0]) * 512 * 1.25),
          this.element.clientHeight / (Math.abs(a[1] - b[1]) * 512 * 1.25),
        ),
      ),
    );
    this.zoom = this.minimumZoom;
    this.drawSoon();
  }
  setView(center: readonly [number, number], zoom: number) {
    this.center = [center[0], center[1]];
    this.zoom = Math.max(this.minimumZoom, Math.min(20, zoom));
    this.drawSoon();
    this.emit("zoomend");
    this.emit("moveend");
  }
  setPitch(pitch: number) {
    void pitch;
  }
  setDisplayMode(mode: MapMode, animate = true) {
    void animate;
    if (mode !== "2d") throw Error("当前浏览器使用基础二维地图。");
  }
  onModelState(listener: (state: PilotModelState) => void) {
    listener("idle");
    return () => false;
  }
  setZone(zone: "all" | "teaching" | "living", padding = [170, 120, 110, 80]) {
    void padding;
    if (zone === "all") {
      void this.initializeViewport();
      return;
    }
    const z = campusData.zones.find((z) => z.id === zone);
    if (z) {
      const [a, b] = boundsOf(z.polygon);
      this.setView([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 16.5);
    }
  }
  focusPlace(id: string) {
    const place = campusData.places.find((p) => p.id === id);
    if (!place) throw Error("地点不存在。");
    this.selected = id;
    this.setView(place.coordinate, Math.max(this.zoom, 17.5));
  }
  highlightPlace(id: string) {
    this.selected = id;
    this.drawSoon();
  }
  clearSelection() {
    this.selected = undefined;
    this.drawSoon();
  }
  showPlaces(ids: string[]) {
    ids.forEach((id) => {
      const p = campusData.places.find((p) => p.id === id);
      if (!p) throw Error("地点不存在。");
      this.layers[placeLayer(p)] = true;
    });
    this.drawSoon();
  }
  setLayerVisibility(layer: string, visible: boolean) {
    if (!(layer in this.layers)) throw Error("图层不存在。");
    this.layers[layer as MapLayer] = visible;
    this.drawSoon();
  }
  pickPlace(fn: (id: string) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  pickCoordinate(fn: (point: RoutePoint) => void) {
    this.coordinateListeners.add(fn);
    return () => {
      this.coordinateListeners.delete(fn);
    };
  }
  async planRoute(start: RoutePoint, end: RoutePoint) {
    const r = await planCampusRoute(start, end);
    this.routes.set(r.id, r);
    return r;
  }
  installRoute(route: CampusRoute) {
    this.routes.set(route.id, route);
  }
  renderRoute(id: string) {
    const route = this.routes.get(id);
    if (!route) throw Error("路线不可用。");
    this.route = route;
    this.fitPoints(route.pathGcj02.map(toWgs84));
  }
  private fitPoints(points: Coordinate[]) {
    const [sw, ne] = boundsOf(points),
      a = project(sw),
      b = project(ne);
    const width = Math.max(100, this.element.clientWidth - 140),
      height = Math.max(100, this.element.clientHeight - 360);
    this.setView(
      [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2],
      Math.min(
        18,
        Math.log2(
          Math.min(
            width / Math.max(1e-8, b[0] - a[0]) / 512,
            height / Math.max(1e-8, a[1] - b[1]) / 512,
          ),
        ),
      ),
    );
  }
  clearRoute() {
    this.route = undefined;
    this.endpoints = [null, null];
    this.drawSoon();
  }
  showEndpoints(start: RoutePoint | null, end: RoutePoint | null) {
    this.endpoints = [start, end];
    this.drawSoon();
  }
  showLocation(coordinate: Coordinate, accuracy: number, focus = false) {
    this.accuracy = accuracy;
    this.location = coordinate;
    if (focus) this.setView(coordinate, Math.max(this.zoom, 17));
    this.drawSoon();
  }
  setLocationHeading(value: number | null) {
    this.heading = value;
    this.drawSoon();
  }
  clearLocation() {
    this.location = undefined;
    this.drawSoon();
  }
  followLocation(point: Coordinate, heading?: number) {
    void heading;
    if (!this.followSuspended) this.setView(point, Math.max(this.zoom, 17));
  }
  resumeFollow() {
    this.followSuspended = false;
  }
  setNavigationView(heading?: number) {
    void heading;
    this.interaction = "navigation";
    this.drawSoon();
  }
  setInteractionMode(value: "browse" | "pick" | "navigation") {
    this.interaction = value;
    this.drawSoon();
  }
  zoomBy(delta: number) {
    this.setView(this.center, this.zoom + delta);
  }
  focusOnline(poi: SDKPoi) {
    this.setView(toWgs84(sdkCoordinate(poi.location)), 18);
  }
  destroy() {
    this.destroyed = true;
    this.abort.abort();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancelPointer);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.events.clear();
    this.listeners.clear();
    this.coordinateListeners.clear();
    this.canvas.width = this.canvas.height = 0;
    this.element.replaceChildren();
  }
}
