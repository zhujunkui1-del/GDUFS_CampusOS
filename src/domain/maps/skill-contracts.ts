import { z } from "zod";
import { MapActionSchema } from "./contracts";
import {
  categoryNames,
  CoordinateSchema,
} from "@/features/campus-map/data/campus";

export const PlaceIdSchema = z.string().min(1).max(128);
export const CategorySchema = z.enum(
  Object.keys(categoryNames) as [
    keyof typeof categoryNames,
    ...(keyof typeof categoryNames)[],
  ],
);
export const OriginSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), placeId: PlaceIdSchema }).strict(),
  z.object({ type: z.literal("selected_place") }).strict(),
  z.object({ type: z.literal("device_location") }).strict(),
]);
export type MapOrigin = z.infer<typeof OriginSchema>;
export type MapSkillContext = {
  selectedPlaceId?: string;
  // Caller must have obtained current browser consent; no public tool or HTTP argument can supply this grant.
  authorizedLocation?: {
    coordinate: [number, number];
    accuracyMeters: number;
    capturedAt: number;
    expiresAt: number;
    consent: "browser_geolocation";
  };
};
export const ResolvedOriginSchema = z
  .object({
    source: z.enum([
      "place",
      "selected_map_place",
      "authorized_device_location",
    ]),
    placeId: PlaceIdSchema.nullable(),
    name: z.string().max(150),
    coordinate: CoordinateSchema,
    crs: z.literal("WGS84"),
  })
  .strict();
export const PlaceSummarySchema = z
  .object({
    placeId: PlaceIdSchema,
    name: z.string().max(150),
    category: CategorySchema,
    zone: z.enum(["teaching", "living", "connection"]),
    location: CoordinateSchema,
    crs: z.literal("WGS84"),
    aliases: z.array(z.string().max(150)).max(30),
    labelPlaceId: PlaceIdSchema,
    verificationStatus: z.enum(["source_mapped", "owner_confirmed"]),
  })
  .strict();
export const SearchPlacesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(100),
    category: CategorySchema.optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export const SearchPlacesOutputSchema = z
  .object({
    matches: z.array(PlaceSummarySchema).max(20),
    ambiguous: z.boolean(),
    matchType: z.enum(["exact", "partial", "fuzzy", "category"]),
    requiresOriginForNearest: z.boolean(),
    mapVersion: z.string().max(100),
  })
  .strict();
export const PlaceDetailsInputSchema = z
  .object({ placeId: PlaceIdSchema })
  .strict();
export const PlaceDetailsOutputSchema = z
  .object({
    place: PlaceSummarySchema,
    building: z
      .object({
        footprintId: PlaceIdSchema.nullable(),
        levels: z.number().int().positive().nullable(),
        heightMeters: z.number().positive().nullable(),
        heightAccuracy: z.enum(["owner_approximation", "unknown"]),
        modelModes: z.array(z.enum(["2.5d", "3d"])).max(2),
      })
      .strict(),
    source: z
      .object({
        url: z.url(),
        name: z.string().max(200),
        fetchedAt: z.string().max(60),
        nameSource: z.string().max(100).nullable(),
        nameReviewedAt: z.string().max(60).nullable(),
      })
      .strict(),
    navigation: z
      .object({
        pointVerified: z.boolean(),
        arrivalPolicy: z.literal("nearest_perimeter"),
        entranceDetails: z.literal("unknown"),
        openingStatus: z.literal("unknown"),
      })
      .strict(),
    mapVersion: z.string().max(100),
  })
  .strict();
export const NearbyPlacesInputSchema = z
  .object({
    origin: OriginSchema.optional(),
    category: CategorySchema.optional(),
    radiusMeters: z.number().min(1).max(2000).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export const NearbyPlacesOutputSchema = z
  .object({
    origin: ResolvedOriginSchema,
    distanceType: z.literal("geodesic_straight_line"),
    radiusMeters: z.number().positive(),
    matches: z
      .array(
        PlaceSummarySchema.extend({
          distanceMeters: z.number().nonnegative(),
        }).strict(),
      )
      .max(20),
    mapVersion: z.string().max(100),
  })
  .strict();
const LineStringSchema = z
  .object({
    type: z.literal("LineString"),
    coordinates: z.array(CoordinateSchema).min(2).max(1500),
  })
  .strict();
export const PlanRouteInputSchema = z
  .object({
    start: OriginSchema,
    endPlaceId: PlaceIdSchema,
    mode: z.literal("walking"),
    preferences: z
      .object({ accessible: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
export const RouteOutputSchema = z
  .object({
    routeId: z.string().uuid(),
    start: ResolvedOriginSchema,
    end: ResolvedOriginSchema,
    mode: z.literal("walking"),
    crs: z.literal("WGS84"),
    source: z.literal("CampusOS.OSM"),
    path: LineStringSchema,
    approachPath: LineStringSchema.nullable(),
    undergroundPaths: z.array(LineStringSchema).max(20),
    distanceMeters: z.number().positive(),
    estimatedSeconds: z.number().positive(),
    estimatedMinutes: z.number().int().positive(),
    steps: z
      .array(
        z
          .object({
            instruction: z.string().min(1).max(200),
            distanceMeters: z.number().positive(),
          })
          .strict(),
      )
      .max(100),
    networkVersion: z.string().min(1).max(100),
    mapVersion: z.string().min(1).max(100),
    crossesZones: z.boolean(),
    usesTunnel: z.boolean(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type RouteSnapshot = z.infer<typeof RouteOutputSchema>;
export const ControlMapInputSchema = z
  .object({ actions: z.array(MapActionSchema).min(1).max(8) })
  .strict();
export const ControlMapOutputSchema = z
  .object({
    acceptedActions: z.array(MapActionSchema).min(1).max(8),
    execution: z.literal("intent_only"),
    mapVersion: z.string().max(100),
  })
  .strict();
