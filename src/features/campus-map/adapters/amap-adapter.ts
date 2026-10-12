import type { MapAdapter } from "@/domain/maps/contracts";
import {
  campusData,
  placeLayer,
  type CampusPlace,
  type Coordinate,
  type MapLayer,
} from "../data/campus";
import { boundsOf, distanceMeters, pointInPolygon } from "../data/geometry";
import { convertCampusCoordinates } from "./coordinates";
import {
  sdkCoordinate,
  type AMapSDK,
  type MapOverlay,
  type SDKMap,
  type SDKMarker,
  type SDKPoi,
  type WalkingResult,
} from "./amap-types";

export type RoutePoint = {
  name: string;
  coordinateGcj02: Coordinate;
  zone: "teaching" | "living";
  source: "user_map_selection";
};
export type CampusRoute = {
  id: string;
  start: RoutePoint;
  end: RoutePoint;
  pathGcj02: Coordinate[];
  distanceMeters: number;
  seconds: number;
  steps: { instruction: string; distance: number }[];
  source: "AMap.Walking";
  verification: "provider_geometry_checked";
};
function timed<T>(
  operation: (done: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("地图服务请求超时，请重试。")),
      15000,
    );
    operation(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
export class AMapAdapter implements MapAdapter {
  readonly map: SDKMap;
  readonly sdk: AMapSDK;
  readonly coordinates = new Map<string, Coordinate>();
  readonly zones: { id: "teaching" | "living"; polygon: Coordinate[] }[];
  private markers = new Map<
    string,
    { overlay: SDKMarker; button: HTMLButtonElement; place: CampusPlace }
  >();
  private routeOverlay?: MapOverlay;
  private routes = new Map<string, CampusRoute>();
  private listeners = new Set<(id: string) => void>();
  private visibility: Record<MapLayer, boolean> = {
    buildings: true,
    sports: true,
    dormitories: true,
    services: true,
  };
  private zoomHandler = () => this.updateLabels();
  private constructor(
    sdk: AMapSDK,
    element: HTMLElement,
    coordinates: Coordinate[],
    places: CampusPlace[],
    zones: { id: "teaching" | "living"; polygon: Coordinate[] }[],
  ) {
    this.sdk = sdk;
    this.zones = zones;
    places.forEach((place, i) =>
      this.coordinates.set(place.id, coordinates[i]),
    );
    const bounds = boundsOf(zones.flatMap((z) => z.polygon));
    this.map = new sdk.Map(element, {
      viewMode: "3D",
      zoom: 15.5,
      center: [
        (bounds[0][0] + bounds[1][0]) / 2,
        (bounds[0][1] + bounds[1][1]) / 2,
      ],
      pitch: 48,
      rotation: 0,
      keyboardEnable: true,
      dragEnable: true,
      zoomEnable: true,
      rotateEnable: true,
      pitchEnable: true,
      showLabel: true,
      features: ["bg", "road", "building", "point"],
    });
    for (const place of places) {
      const button = document.createElement("button");
      button.className = `campus-marker marker-${placeLayer(place)}`;
      button.textContent = place.name;
      button.setAttribute("aria-label", `查看${place.name}`);
      button.onclick = (event) => {
        event.stopPropagation();
        this.focusPlace(place.id);
        this.listeners.forEach((listener) => listener(place.id));
      };
      const overlay = new sdk.Marker({
        position: this.coordinates.get(place.id),
        content: button,
        anchor: "bottom-center",
        bubble: false,
        zIndex: 110,
      });
      this.markers.set(place.id, { overlay, button, place });
      this.map.add(overlay);
    }
    this.map.on("zoomend", this.zoomHandler);
    this.updateLabels();
  }
  static async create(sdk: AMapSDK, element: HTMLElement) {
    const places = campusData.places;
    const pointList = [
      ...places.map((p) => p.coordinate),
      ...campusData.zones.flatMap((z) => z.polygon),
    ];
    const converted: Coordinate[] = [];
    for (let i = 0; i < pointList.length; i += 40) {
      const batch = pointList.slice(i, i + 40);
      const result = await convertCampusCoordinates(batch);
      converted.push(...result);
    }
    let offset = places.length;
    const zones = campusData.zones.map((z) => {
      const polygon = converted.slice(offset, offset + z.polygon.length);
      offset += z.polygon.length;
      return { id: z.id, polygon };
    });
    return new AMapAdapter(
      sdk,
      element,
      converted.slice(0, places.length),
      places,
      zones,
    );
  }
  async setView(centerWgs84: readonly [number, number], zoom: number) {
    const coordinates = await convertCampusCoordinates([[...centerWgs84]]);
    this.map.setZoomAndCenter(zoom, coordinates[0], true);
  }
  setPitch(pitch: number) {
    this.map.setPitch(Math.max(0, Math.min(60, pitch)), true);
  }
  setZone(zone: "all" | "teaching" | "living", padding = [170, 100, 110, 120]) {
    const points = this.zones
      .filter((z) => zone === "all" || z.id === zone)
      .flatMap((z) => z.polygon);
    const [sw, ne] = boundsOf(points);
    this.map.setBounds(new this.sdk.Bounds(sw, ne), true, padding);
  }
  focusPlace(id: string) {
    const marker = this.markers.get(id),
      coordinate = this.coordinates.get(id);
    if (!marker || !coordinate) throw new Error("地点不存在或尚未核验。");
    this.visibility[placeLayer(marker.place)] = true;
    this.map.setZoomAndCenter(
      Math.max(17.2, this.map.getZoom()),
      coordinate,
      true,
    );
    this.markers.forEach((value, key) => {
      value.button.classList.toggle("selected", key === id);
      value.overlay.setZIndex(key === id ? 300 : 110);
    });
    this.updateLabels();
  }
  showPlaces(ids: string[]) {
    if (ids.some((id) => !this.markers.has(id)))
      throw new Error("包含未知地点。");
    for (const id of ids)
      this.visibility[placeLayer(this.markers.get(id)!.place)] = true;
    this.updateLabels();
  }
  setLayerVisibility(layer: string, visible: boolean) {
    if (!(layer in this.visibility)) throw new Error("该图层尚不可用。");
    this.visibility[layer as MapLayer] = visible;
    this.updateLabels();
  }
  private updateLabels() {
    const zoom = this.map.getZoom();
    const occupied: { x: number; y: number; width: number }[] = [];
    const places = [...this.markers.entries()].sort(
      ([, a], [, b]) =>
        Number(b.button.classList.contains("selected")) -
          Number(a.button.classList.contains("selected")) ||
        a.place.minZoom - b.place.minZoom,
    );
    for (const [id, marker] of places) {
      const selected = marker.button.classList.contains("selected");
      const coordinate = this.coordinates.get(id)!;
      const pixel = this.map.lngLatToContainer(coordinate);
      const box = {
        x: pixel.getX(),
        y: pixel.getY(),
        width: Math.max(60, marker.place.name.length * 13 + 24),
      };
      const collides = occupied.some(
        (other) =>
          Math.abs(other.x - box.x) < (other.width + box.width) / 2 + 8 &&
          Math.abs(other.y - box.y) < 30,
      );
      const visible =
        this.visibility[placeLayer(marker.place)] &&
        (selected || (zoom >= marker.place.minZoom && !collides));
      if (visible) {
        marker.overlay.show();
        occupied.push(box);
      } else marker.overlay.hide();
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
      lnglat?: { getLng(): number; getLat(): number };
    }) => {
      if (!event.lnglat) return;
      const point = sdkCoordinate(event.lnglat),
        zone = this.zones.find((z) => pointInPolygon(point, z.polygon));
      if (zone)
        listener({
          name: "地图选点",
          coordinateGcj02: point,
          zone: zone.id,
          source: "user_map_selection",
        });
    };
    this.map.on("click", handler);
    return () => this.map.off("click", handler);
  }
  async onlineSearch(keyword: string): Promise<SDKPoi[]> {
    await timed<void>((done) =>
      this.sdk.plugin(["AMap.PlaceSearch"], () => done()),
    );
    const [sw, ne] = boundsOf(this.zones.flatMap((z) => z.polygon));
    return timed((done, fail) => {
      const search = new this.sdk.PlaceSearch({
        city: "广州",
        citylimit: true,
        pageSize: 20,
      });
      search.searchInBounds(
        keyword,
        new this.sdk.Bounds(sw, ne),
        (status, output) => {
          if (status === "no_data") {
            done([]);
            return;
          }
          if (status !== "complete") {
            fail(new Error("高德地点查询失败，请稍后重试。"));
            return;
          }
          done(
            (output.poiList?.pois || []).filter((p) =>
              this.zones.some((z) =>
                pointInPolygon(sdkCoordinate(p.location), z.polygon),
              ),
            ),
          );
        },
      );
    });
  }
  async planRoute(start: RoutePoint, end: RoutePoint): Promise<CampusRoute> {
    if (start.zone !== end.zone)
      throw new Error("跨区隧道两端入口和通行连接尚未核验，暂不提供跨区导航。");
    if (distanceMeters(start.coordinateGcj02, end.coordinateGcj02) < 5)
      throw new Error("请选取不同的起点与终点。");
    await timed<void>((done) =>
      this.sdk.plugin(["AMap.Walking"], () => done()),
    );
    const output = await timed<WalkingResult>((done, fail) =>
      new this.sdk.Walking({ hideMarkers: true }).search(
        start.coordinateGcj02,
        end.coordinateGcj02,
        (status, result) => {
          if (status !== "complete")
            fail(new Error("高德未返回可用步行路线，未绘制替代直线。"));
          else done(result);
        },
      ),
    );
    const route = output.routes?.[0];
    const path = route?.steps.flatMap((s) => s.path.map(sdkCoordinate)) || [];
    const zone = this.zones.find((z) => z.id === start.zone)!;
    if (
      !route ||
      path.length < 2 ||
      !Number.isFinite(route.distance) ||
      route.distance <= 0 ||
      !Number.isFinite(route.time) ||
      route.time <= 0 ||
      distanceMeters(path[0], start.coordinateGcj02) > 80 ||
      distanceMeters(path.at(-1)!, end.coordinateGcj02) > 80 ||
      path.some((p) => !pointInPolygon(p, zone.polygon))
    )
      throw new Error("路线未通过校园范围或端点校验，暂不显示导航结果。");
    const result: CampusRoute = {
      id: crypto.randomUUID(),
      start,
      end,
      pathGcj02: path,
      distanceMeters: route.distance,
      seconds: route.time,
      steps: route.steps.map((s) => ({
        instruction: s.instruction,
        distance: s.distance,
      })),
      source: "AMap.Walking",
      verification: "provider_geometry_checked",
    };
    this.routes.set(result.id, result);
    return result;
  }
  renderRoute(id: string) {
    const route = this.routes.get(id);
    if (!route) throw new Error("路线不存在或已失效。");
    this.routeOverlay?.setMap(null);
    this.setPitch(0);
    this.routeOverlay = new this.sdk.Polyline({
      path: route.pathGcj02,
      strokeColor: "#1261bb",
      strokeWeight: 6,
      strokeOpacity: 0.92,
      lineJoin: "round",
      showDir: true,
      zIndex: 200,
    });
    this.map.add(this.routeOverlay);
    const [sw, ne] = boundsOf(route.pathGcj02);
    this.map.setBounds(new this.sdk.Bounds(sw, ne), true, [220, 90, 160, 380]);
  }
  clearRoute() {
    this.routeOverlay?.setMap(null);
    this.routeOverlay = undefined;
    this.routes.clear();
  }
  destroy() {
    this.listeners.clear();
    this.map.off("zoomend", this.zoomHandler);
    this.map.destroy();
  }
}
