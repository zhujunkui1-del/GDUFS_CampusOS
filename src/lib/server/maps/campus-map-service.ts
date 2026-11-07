import { z } from "zod";
import {
  campusData,
  searchCampusPlaces,
  type CampusPlace,
} from "@/features/campus-map/data/campus";
import { normalizePlaceText } from "@/features/campus-map/data/campus-text";
import {
  distanceMeters,
  pointInPolygon,
} from "@/features/campus-map/data/geometry";
import {
  nearestTunnelDistance,
  planLocalRoute,
  tunnelNetwork,
  loadPublicWalkingAttachments,
} from "@/features/campus-map/data/local-routing";
import publicAttachments from "./public-walking-attachments.json";
import {
  toGcj02,
  toWgs84,
} from "@/features/campus-map/adapters/online-services";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";
import model from "@/features/campus-map/data/nanyuan7-model.json";
import { MapActionSchema } from "@/domain/maps/contracts";
import {
  SearchPlacesInputSchema,
  SearchPlacesOutputSchema,
  PlaceDetailsInputSchema,
  PlaceDetailsOutputSchema,
  NearbyPlacesInputSchema,
  NearbyPlacesOutputSchema,
  PlanRouteInputSchema,
  RouteOutputSchema,
  ControlMapInputSchema,
  ControlMapOutputSchema,
  type MapOrigin,
  type ResolvedOriginSchema,
} from "@/domain/maps/skill-contracts";
import type { SkillContext } from "@/domain/skills/contracts";
import { ApiError } from "../errors";
import {
  MemoryRouteSnapshotStore,
  type RouteSnapshotStore,
} from "./route-store";

type ResolvedOrigin = z.infer<typeof ResolvedOriginSchema>;
loadPublicWalkingAttachments(publicAttachments);
export const MAP_VERSIONS = {
  mapVersion: campusData.mapVersion!,
  networkVersion: tunnelNetwork.version,
};
const visiblePlaces = searchCampusPlaces("");
const normalize = normalizePlaceText;
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) === 1;
}
function summary(place: CampusPlace) {
  return {
    placeId: place.id,
    name: place.name,
    aliases: place.aliases || [],
    category: place.category,
    zone: place.zone,
    location: place.coordinate,
    crs: "WGS84" as const,
    labelPlaceId: place.labelPlaceId || place.id,
    verificationStatus: place.verification,
  };
}

export class CampusMapService {
  constructor(
    readonly routes: RouteSnapshotStore = new MemoryRouteSnapshotStore(),
    private readonly now = () => Date.now(),
  ) {}
  place(id: string) {
    const place = campusData.places.find((p) => p.id === id);
    if (!place) throw new ApiError("NOT_FOUND", "地点不存在，请重新选择。");
    return place;
  }
  private assertContext(context: SkillContext) {
    context.signal?.throwIfAborted();
    if (context.campusId !== campusData.campusId || !context.sessionId)
      throw new ApiError("FORBIDDEN", "无法使用此地图会话。");
  }
  resolveOrigin(
    origin: MapOrigin | undefined,
    context: SkillContext,
    enforceRequestedSource = true,
  ): ResolvedOrigin {
    this.assertContext(context);
    if (
      enforceRequestedSource &&
      context.map?.requiresDeviceOrigin &&
      origin?.type !== "device_location"
    )
      throw new ApiError("LOCATION_REQUIRED", "请授权定位或输入其他起点。");
    if (!origin || origin.type === "selected_place") {
      if (!context.map?.selectedPlaceId)
        throw new ApiError("LOCATION_REQUIRED", "请选择起点或授权定位。");
      const place = this.place(context.map.selectedPlaceId);
      return {
        source: "selected_map_place",
        placeId: place.id,
        name: place.name,
        coordinate: place.coordinate,
        crs: "WGS84",
      };
    }
    if (origin.type === "place") {
      const place = this.place(origin.placeId);
      return {
        source: "place",
        placeId: place.id,
        name: place.name,
        coordinate: place.coordinate,
        crs: "WGS84",
      };
    }
    const grant = z
      .object({
        coordinate: z.tuple([
          z.number().min(-180).max(180),
          z.number().min(-90).max(90),
        ]),
        accuracyMeters: z.number().nonnegative().max(100),
        capturedAt: z.number(),
        expiresAt: z.number(),
        consent: z.literal("browser_geolocation"),
      })
      .strict()
      .safeParse(context.map?.authorizedLocation);
    const now = this.now();
    if (
      !grant.success ||
      grant.data.capturedAt > now ||
      now - grant.data.capturedAt > 30000 ||
      grant.data.expiresAt <= now ||
      grant.data.expiresAt > grant.data.capturedAt + 30000
    )
      throw new ApiError("LOCATION_REQUIRED", "请重新授权定位或选择起点。");
    if (
      !campusData.zones.some((zone) =>
        pointInPolygon(grant.data.coordinate, zone.polygon),
      ) &&
      nearestTunnelDistance(grant.data.coordinate) > 25
    )
      throw new ApiError("OUT_OF_CAMPUS", "当前位置在校外，请选择校内起点。");
    return {
      source: "authorized_device_location",
      placeId: null,
      name: "我的位置",
      coordinate: grant.data.coordinate,
      crs: "WGS84",
    };
  }
  search(
    input: z.infer<typeof SearchPlacesInputSchema>,
    context: SkillContext,
  ) {
    this.assertContext(context);
    const checked = SearchPlacesInputSchema.parse(input);
    const nearest = /最近|附近/.test(checked.query);
    // 「大学城校区第一饭堂」 is a campus-qualified name, not a different place.
    // The campus is already fixed by the data set, so the qualifier is noise.
    const query = normalize(checked.query)
      .replace(/^(?:请)?(?:帮我)?(?:找(?:到)?|查找|搜索|定位(?:到)?)?/, "")
      .replace(
        /^(?:广外|广东外语外贸大学|大学城校区|南校区|小谷围)?(?:的)?/,
        "",
      )
      .replace(/最近(?:的)?|附近(?:的)?|在哪里[？?]?$/g, "");
    if (!query)
      throw new ApiError("INVALID_ARGUMENT", "请输入地点名称或类别。");
    const categoryTerm = /^(?:食堂|饭堂|餐厅)$/.test(query)
      ? "canteen"
      : undefined;
    const category = checked.category || categoryTerm;
    const pool = visiblePlaces.filter(
      (p) => !category || p.category === category,
    );
    const exact = pool.filter((p) =>
      [p.name, ...(p.aliases || [])].some((name) => normalize(name) === query),
    );
    const reused = new Set(searchCampusPlaces(query).map((p) => p.id));
    let matches = exact.length
      ? exact
      : categoryTerm
        ? pool
        : pool.filter(
            (p) =>
              reused.has(p.id) ||
              [p.name, ...(p.aliases || [])].some((name) =>
                normalize(name).includes(query),
              ),
          );
    let matchType: "exact" | "partial" | "fuzzy" | "category" = exact.length
      ? "exact"
      : categoryTerm
        ? "category"
        : "partial";
    if (!matches.length && query.length >= 3) {
      matches = pool.filter((p) =>
        [p.name, ...(p.aliases || [])].some((name) => {
          const normalized = normalize(name);
          return (
            (query.match(/\d+/g) || []).join() ===
              (normalized.match(/\d+/g) || []).join() &&
            oneEdit(query, normalized)
          );
        }),
      );
      if (matches.length) matchType = "fuzzy";
    }
    if (!matches.length)
      throw new ApiError("NOT_FOUND", "未找到该地点，请换个名称。");
    return SearchPlacesOutputSchema.parse({
      matches: matches.slice(0, checked.limit || 10).map(summary),
      ambiguous: matches.length > 1 || matchType === "fuzzy",
      matchType,
      requiresOriginForNearest: nearest,
      mapVersion: MAP_VERSIONS.mapVersion,
    });
  }
  details(
    input: z.infer<typeof PlaceDetailsInputSchema>,
    context: SkillContext,
  ) {
    this.assertContext(context);
    const place = this.place(PlaceDetailsInputSchema.parse(input).placeId);
    const pilot =
      place.id === model.placeId &&
      model.mapVersion === MAP_VERSIONS.mapVersion;
    return PlaceDetailsOutputSchema.parse({
      place: summary(place),
      building: {
        footprintId: place.geometry ? place.id : place.parentId || null,
        levels: pilot ? model.levels : null,
        heightMeters: pilot ? model.heightMeters : null,
        heightAccuracy: pilot ? "owner_approximation" : "unknown",
        modelModes: pilot ? ["2.5d", "3d"] : [],
      },
      source: {
        url: place.sourceUrl,
        name: place.sourceName,
        fetchedAt: place.fetchedAt,
        nameSource: place.nameSource || null,
        nameReviewedAt: place.nameReviewedAt || null,
      },
      navigation: {
        pointVerified: place.navigationVerified,
        arrivalPolicy: "nearest_perimeter",
        entranceDetails: "unknown",
        openingStatus: "unknown",
      },
      mapVersion: MAP_VERSIONS.mapVersion,
    });
  }
  nearby(
    input: z.infer<typeof NearbyPlacesInputSchema>,
    context: SkillContext,
  ) {
    const checked = NearbyPlacesInputSchema.parse(input);
    const origin = this.resolveOrigin(checked.origin, context);
    const radius = checked.radiusMeters || 500;
    const matches = visiblePlaces
      .filter(
        (p) =>
          p.id !== origin.placeId &&
          (!checked.category || p.category === checked.category),
      )
      .map((place) => ({
        ...summary(place),
        distanceMeters: distanceMeters(origin.coordinate, place.coordinate),
      }))
      .filter((place) => place.distanceMeters <= radius)
      .sort(
        (a, b) =>
          a.distanceMeters - b.distanceMeters ||
          a.placeId.localeCompare(b.placeId),
      )
      .slice(0, checked.limit || 10);
    return NearbyPlacesOutputSchema.parse({
      origin,
      distanceType: "geodesic_straight_line",
      radiusMeters: radius,
      matches,
      mapVersion: MAP_VERSIONS.mapVersion,
    });
  }
  async plan(
    input: z.infer<typeof PlanRouteInputSchema>,
    context: SkillContext,
  ) {
    const checked = PlanRouteInputSchema.parse(input);
    if (checked.preferences?.accessible)
      throw new ApiError(
        "INSUFFICIENT_DATA",
        "无障碍通行资料不足，暂不提供该路线。",
      );
    const start = this.resolveOrigin(checked.start, context);
    const end = this.resolveOrigin(
      { type: "place", placeId: checked.endPlaceId },
      context,
      false,
    );
    if (
      start.placeId === end.placeId ||
      distanceMeters(start.coordinate, end.coordinate) < 3
    )
      throw new ApiError("INVALID_ARGUMENT", "请选择不同的起点和终点。");
    const point = (origin: ResolvedOrigin): RoutePoint => ({
      name: origin.name,
      placeId: origin.placeId || undefined,
      coordinateGcj02: toGcj02(origin.coordinate),
      zone: origin.placeId
        ? this.place(origin.placeId).zone
        : campusData.zones.find((zone) =>
            pointInPolygon(origin.coordinate, zone.polygon),
          )?.id || "connection",
      source:
        origin.source === "authorized_device_location"
          ? "device_location"
          : "campus_place",
    });
    const a = point(start),
      b = point(end);
    context.signal?.throwIfAborted();
    const route = planLocalRoute(a, b);
    if (!route)
      throw new ApiError(
        "ROUTE_UNAVAILABLE",
        "当前选点无法连接校园步行路网，请更换起点或终点。",
      );
    const crossesZones =
      a.zone !== b.zone && a.zone !== "connection" && b.zone !== "connection";
    if (
      route.source !== "CampusOS.OSM" ||
      route.networkVersion !== MAP_VERSIONS.networkVersion ||
      (crossesZones && !route.undergroundPathGcj02?.length)
    )
      throw new ApiError("ROUTE_UNAVAILABLE", "路线未通过版本或跨区连接校验。");
    const line = (path: [number, number][]) => ({
      type: "LineString" as const,
      coordinates: path.map(toWgs84),
    });
    const result = RouteOutputSchema.parse({
      routeId: route.id,
      start,
      end,
      mode: "walking",
      crs: "WGS84",
      source: route.source,
      path: line(route.pathGcj02),
      approachPath: route.approachPathGcj02
        ? line(route.approachPathGcj02)
        : null,
      undergroundPaths: (route.undergroundPathGcj02 || []).map(line),
      distanceMeters: route.distanceMeters,
      estimatedSeconds: route.seconds,
      estimatedMinutes: Math.max(1, Math.ceil(route.seconds / 60)),
      steps: route.steps.map((step) => ({
        instruction: step.instruction,
        distanceMeters: step.distance,
      })),
      networkVersion: route.networkVersion,
      mapVersion: MAP_VERSIONS.mapVersion,
      crossesZones,
      usesTunnel: !!route.undergroundPathGcj02?.length,
      expiresAt: new Date(this.now() + 600000).toISOString(),
    });
    context.signal?.throwIfAborted();
    await this.routes.save(context.sessionId, result);
    return result;
  }
  async control(
    input: z.infer<typeof ControlMapInputSchema>,
    context: SkillContext,
  ) {
    this.assertContext(context);
    const checked = ControlMapInputSchema.parse(input);
    // Atomic validation: one invalid action rejects the entire batch, so no partial map intent escapes.
    for (const raw of checked.actions) {
      const action = MapActionSchema.parse(raw);
      if ("placeId" in action) this.place(action.placeId);
      if (action.type === "SHOW_PLACES")
        action.placeIds.forEach((id) => this.place(id));
      if (action.type === "SHOW_ROUTE")
        await this.routes.get(context.sessionId, action.routeId, MAP_VERSIONS);
      if (
        action.type === "SET_LAYER" &&
        (action.layer === "events" || action.layer === "moments")
      )
        throw new ApiError("INVALID_ARGUMENT", "该图层尚未开放。");
    }
    return ControlMapOutputSchema.parse({
      acceptedActions: checked.actions,
      execution: "intent_only",
      mapVersion: MAP_VERSIONS.mapVersion,
    });
  }
}
