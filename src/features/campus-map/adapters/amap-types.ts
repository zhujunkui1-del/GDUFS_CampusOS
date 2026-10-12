import type { Coordinate } from "../data/campus";
import type {} from "@amap/amap-jsapi-types";

export type SDKPoint = { getLng(): number; getLat(): number };
export type MapEvent = { lnglat?: SDKPoint };
export interface MapOverlay {
  setMap(map: SDKMap | null): void;
}
export type SDKMarker = MapOverlay & Pick<AMap.Marker, "hide" | "show" | "setzIndex">;
export interface SDKMap {
  on(name: string, callback: (event: MapEvent) => void): void;
  off(name: string, callback: (event: MapEvent) => void): void;
  setZoomAndCenter(
    zoom: number,
    position: Coordinate,
    immediately?: boolean,
  ): void;
  setBounds(bounds: unknown, immediately?: boolean, padding?: number[]): void;
  setPitch(value: number, immediately?: boolean, duration?: number): void;
  getPitch(): number;
  setRotation(value: number, immediately?: boolean, duration?: number): void;
  getRotation(): number;
  getZoom(): number;
  setZoom(value: number, immediately?: boolean, duration?: number): void;
  getCenter(): SDKPoint;
  lngLatToContainer(coordinate: Coordinate): { getX(): number; getY(): number };
  add(overlays: MapOverlay | MapOverlay[]): void;
  remove(overlays: MapOverlay | MapOverlay[]): void;
  destroy(): void;
}
export type SDKPoi = {
  id: string;
  name: string;
  location: SDKPoint;
  type?: string;
  address?: string;
  pname?: string;
};
export type PoiResult = { info?: string; poiList?: { pois?: SDKPoi[] } };
export type WalkingResult = {
  info?: string;
  routes?: {
    distance: number;
    time: number;
    steps: { path: SDKPoint[]; instruction: string; distance: number }[];
  }[];
};
export interface AMapSDK {
  Map: new (container: HTMLElement, options: AMap.MapOptions) => SDKMap;
  Marker: new (options: Record<string, unknown>) => SDKMarker;
  Polyline: new (options: Record<string, unknown>) => MapOverlay;
  Polygon: new (options: Record<string, unknown>) => MapOverlay;
  Bounds: new (southwest: Coordinate, northeast: Coordinate) => unknown;
  Pixel: new (x: number, y: number) => unknown;
  plugin(names: string[], callback: () => void): void;
  convertFrom(
    points: Coordinate[],
    system: "gps",
    callback: (
      status: string,
      result: { locations?: SDKPoint[]; info?: string },
    ) => void,
  ): void;
  PlaceSearch: new (options: Record<string, unknown>) => {
    searchInBounds(
      keyword: string,
      bounds: unknown,
      callback: (status: string, result: PoiResult) => void,
    ): void;
  };
  Walking: new (options: Record<string, unknown>) => {
    search(
      start: Coordinate,
      end: Coordinate,
      callback: (status: string, result: WalkingResult) => void,
    ): void;
  };
}
declare global {
  interface Window {
    _AMapSecurityConfig?: { serviceHost: string };
  }
}
// A narrow interface protects business code from the SDK's untyped service results.
export function currentAMap(): AMapSDK | undefined {
  return window.AMap as unknown as AMapSDK | undefined;
}
export function sdkCoordinate(point: SDKPoint): Coordinate {
  return [point.getLng(), point.getLat()];
}
