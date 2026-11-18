import { expect, it } from "vitest";
import { articleMapPlace } from "@/lib/retrieval/activity-place";

it.each([
  "图书馆",
  "大学城校区E203、F207",
  "大学城校区图书馆或院系楼",
  "大学城校区线上讲座",
])("does not assign an ambiguous or out-of-scope location %s", (location) => {
  expect(articleMapPlace(location)).toBeNull();
});
it("uses verified calendar campus context and distinguishes laboratories from teaching rooms", () => {
  expect(articleMapPlace("图书馆", "university_town")?.placeId).toBe(
    "osm-way-307250998",
  );
  expect(articleMapPlace("大学城校区E203", "baiyun")).toBeNull();
  expect(articleMapPlace("大学城校区实验楼E203")?.placeId).toBe(
    "osm-node-3125809014",
  );
  expect(articleMapPlace("大学城校区B8学术报告厅")?.placeId).toBe(
    "osm-way-651642991",
  );
  expect(articleMapPlace("大学城校区教学楼A302")?.placeId).toBe(
    "osm-way-1410412694",
  );
});

it.each([
  ["大学城校区E203", "osm-node-3125704419"],
  ["广东外语外贸大学南校区 D512课室", "osm-relation-19299170"],
  ["大学城校区G座教学楼207", "osm-node-3125704356"],
  ["大学城校区院系楼401会议室", "osm-way-307437431"],
])(
  "maps the calendar's actual location %s to its existing campus building",
  (location, id) => {
    expect(articleMapPlace(location)?.placeId).toBe(id);
  },
);
