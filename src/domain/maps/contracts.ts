import { z } from "zod";

const placeId = z.string().min(1).max(128);

export const MapActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("FOCUS_PLACE"),
      placeId,
      zoom: z.number().min(3).max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SHOW_PLACES"),
      placeIds: z.array(placeId).min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("SHOW_ROUTE"),
      routeId: z.string().min(1).max(128),
    })
    .strict(),
  z.object({ type: z.literal("OPEN_PLACE_DETAILS"), placeId }).strict(),
  z
    .object({
      type: z.literal("SET_LAYER"),
      layer: z.enum(["buildings", "events", "services", "moments"]),
      visible: z.boolean(),
    })
    .strict(),
]);

export type MapAction = z.infer<typeof MapActionSchema>;
export type LngLat = readonly [longitude: number, latitude: number];
export type MapMode = "2d" | "2.5d" | "3d";

export interface MapAdapter {
  setView(centerWgs84: LngLat, zoom: number): void;
  setPitch(pitch: number): void;
  focusPlace(placeId: string): void;
  showPlaces(placeIds: string[]): void;
  renderRoute(routeId: string): void;
  setLayerVisibility(layer: string, visible: boolean): void;
  pickPlace(listener: (placeId: string) => void): () => void;
  destroy(): void;
}

// Contract validation is followed by DB ID/permission validation in S1/S2.
// No SDK adapter or map-action executor is registered during S0.
