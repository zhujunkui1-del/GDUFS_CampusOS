import { z } from "zod";
import raw from "./campus.json";

export const CoordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type Coordinate = z.infer<typeof CoordinateSchema>;
export const categoryNames = {
  building: "校园建筑",
  teaching: "教学楼",
  library: "图书馆",
  dormitory: "宿舍楼栋",
  canteen: "食堂",
  service: "生活服务",
  sports_hall: "体育馆",
  swimming: "游泳场地",
  track: "田径场",
  football: "足球场",
  basketball: "篮球场",
  volleyball: "排球场",
  tennis: "网球场",
  sports: "运动场地",
  entrance: "校园出入口",
} as const;
export const PlaceSchema = z.object({
  id: z.string().max(128),
  name: z.string().max(150),
  category: z.enum(
    Object.keys(categoryNames) as [
      keyof typeof categoryNames,
      ...(keyof typeof categoryNames)[],
    ],
  ),
  zone: z.enum(["teaching", "living"]),
  coordinate: CoordinateSchema,
  crs: z.literal("WGS84"),
  sourceUrl: z.url(),
  sourceName: z.string(),
  fetchedAt: z.string(),
  verification: z.literal("source_mapped"),
  navigationVerified: z.literal(false),
  minZoom: z.number(),
  geometry: z.array(CoordinateSchema).optional(),
});
export type CampusPlace = z.infer<typeof PlaceSchema>;
export const campusData = z
  .object({
    campusId: z.literal("gdufs_university_town"),
    crs: z.literal("WGS84"),
    sourceUrl: z.url(),
    license: z.literal("ODbL-1.0"),
    attribution: z.string(),
    fetchedAt: z.string(),
    zones: z
      .array(
        z.object({
          id: z.enum(["teaching", "living"]),
          polygon: z.array(CoordinateSchema).min(4),
        }),
      )
      .length(2),
    places: z.array(PlaceSchema),
  })
  .parse(raw);
export type MapLayer = "buildings" | "sports" | "dormitories" | "services";
export function placeLayer(place: CampusPlace): MapLayer {
  if (place.category === "dormitory") return "dormitories";
  if (["building", "teaching", "library", "entrance"].includes(place.category))
    return "buildings";
  if (["service", "canteen"].includes(place.category)) return "services";
  return "sports";
}
export function searchCampusPlaces(query: string, layer?: MapLayer) {
  const normalized = query.trim().normalize("NFKC").toLowerCase();
  return campusData.places
    .filter(
      (p) =>
        (!layer || placeLayer(p) === layer) &&
        (!normalized ||
          `${p.name} ${categoryNames[p.category]} ${placeLayer(p) === "sports" ? "体育设施 运动" : ""} ${p.zone === "living" ? "生活区" : "教学区"}`
            .toLowerCase()
            .includes(normalized)),
    )
    .sort((a, b) => a.minZoom - b.minZoom);
}
