import { MapActionSchema, type MapMode } from "@/domain/maps/contracts";
import type { MapLayer } from "../data/campus";

export type MapActionController = {
  hasPlace(id: string): boolean;
  hasRoute(id: string): boolean;
  focusPlace(id: string): void;
  showPlaceDetails(id: string): void;
  showPlaces(ids: string[]): void;
  showRoute(id: string): void;
  clearRoute(): void;
  setViewMode(mode: MapMode): void;
  setLayer(layer: MapLayer, visible: boolean): void;
};
// Never accepts arbitrary functions/coordinates from an Agent. Routes must first be installed by a trusted bridge.
export function executeMapAction(
  input: unknown,
  controller: MapActionController,
) {
  const action = MapActionSchema.parse(input);
  if ("placeId" in action && !controller.hasPlace(action.placeId))
    throw new Error("地点不存在。");
  if (
    action.type === "SHOW_PLACES" &&
    action.placeIds.some((id) => !controller.hasPlace(id))
  )
    throw new Error("地点不存在。");
  switch (action.type) {
    case "FOCUS_PLACE":
    case "OPEN_PLACE_DETAILS":
      return controller.focusPlace(action.placeId);
    case "SHOW_PLACE_DETAILS":
      return controller.showPlaceDetails(action.placeId);
    case "SHOW_PLACES":
      return controller.showPlaces(action.placeIds);
    case "SHOW_ROUTE":
      if (!controller.hasRoute(action.routeId))
        throw new Error("路线未载入或已失效，请重新规划。");
      return controller.showRoute(action.routeId);
    case "CLEAR_ROUTE":
      return controller.clearRoute();
    case "SET_VIEW_MODE":
      return controller.setViewMode(action.mode);
    case "SET_LAYER":
      if (action.layer === "events" || action.layer === "moments")
        throw new Error("该图层尚未接入。");
      return controller.setLayer(action.layer, action.visible);
  }
}
