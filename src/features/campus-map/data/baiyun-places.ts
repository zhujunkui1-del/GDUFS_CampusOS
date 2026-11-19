import baiyun from "./baiyun-map.json";
import type { CampusPlace } from "./campus";
import { mergePlaceAliases } from "./place-aliases";
export const baiyunPlaces: CampusPlace[] = baiyun.places.map((place) => ({
  ...place,
  category: /食堂|饭堂|^[云芳清]雅园$/.test(place.name)
    ? "canteen"
    : /图书馆/.test(place.name)
      ? "library"
      : /教学楼/.test(place.name)
        ? "teaching"
        : place.category === "dormitories"
          ? "dormitory"
          : place.category === "sports"
            ? "sports"
            : place.category === "services"
              ? "service"
              : "building",
  aliases: mergePlaceAliases(
    place.name,
    place.name === "北校区图书馆" ? ["图书馆"] : [],
  ),
  coordinate: [place.coordinate[0], place.coordinate[1]],
  zone: place.category === "dormitories" ? "living" : "teaching",
  crs: "WGS84",
  sourceName: "OpenStreetMap",
  fetchedAt: "",
  verification: "source_mapped",
  navigationVerified: false,
}));
