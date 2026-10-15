import { describe, expect, it, vi } from "vitest";
import {
  executeMapAction,
  type MapActionController,
} from "@/features/campus-map/interactions/map-action-controller";

function controller(): MapActionController {
  return {
    hasPlace: (id) => id === "real-place",
    hasRoute: (id) => id === "installed-route",
    focusPlace: vi.fn(),
    showPlaceDetails: vi.fn(),
    showPlaces: vi.fn(),
    showRoute: vi.fn(),
    clearRoute: vi.fn(),
    setViewMode: vi.fn(),
    setLayer: vi.fn(),
  };
}
describe("trusted frontend MapAction controller", () => {
  it("routes focus to the existing camera and details to the nonmoving details handler", () => {
    const map = controller();
    executeMapAction({ type: "FOCUS_PLACE", placeId: "real-place" }, map);
    expect(map.focusPlace).toHaveBeenCalledWith("real-place");
    vi.mocked(map.focusPlace).mockClear();
    executeMapAction(
      { type: "SHOW_PLACE_DETAILS", placeId: "real-place" },
      map,
    );
    expect(map.showPlaceDetails).toHaveBeenCalledWith("real-place");
    expect(map.focusPlace).not.toHaveBeenCalled();
  });
  it("reuses installed route, full navigation cleanup and mode handlers", () => {
    const map = controller();
    executeMapAction({ type: "SHOW_ROUTE", routeId: "installed-route" }, map);
    executeMapAction({ type: "CLEAR_ROUTE" }, map);
    executeMapAction({ type: "SET_VIEW_MODE", mode: "3d" }, map);
    expect(map.showRoute).toHaveBeenCalledWith("installed-route");
    expect(map.clearRoute).toHaveBeenCalledOnce();
    expect(map.setViewMode).toHaveBeenCalledWith("3d");
  });
  it("rejects unknown IDs, unloaded routes, unknown modes, scripts and unopened layers", () => {
    const map = controller();
    for (const action of [
      { type: "FOCUS_PLACE", placeId: "fake" },
      { type: "SHOW_PLACES", placeIds: ["real-place", "fake"] },
      { type: "SHOW_ROUTE", routeId: "unloaded" },
      { type: "SET_VIEW_MODE", mode: "4d" },
      { type: "EVAL", code: "x" },
      { type: "SET_LAYER", layer: "moments", visible: true },
    ])
      expect(() => executeMapAction(action, map)).toThrow();
    expect(map.focusPlace).not.toHaveBeenCalled();
    expect(map.showRoute).not.toHaveBeenCalled();
  });
});
