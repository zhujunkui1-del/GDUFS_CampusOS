import { it, expect } from "vitest";
import {
  articleMapPlace,
  buildingActivityPlaceIds,
} from "@/lib/retrieval/activity-place";
import baiyun from "@/features/campus-map/data/baiyun-map.json";
it("resolves abbreviated teaching buildings and the renamed hall without inventing room points", () => {
  const first = baiyun.places.find((p) => p.name === "第一教学楼")!,
    sixth = baiyun.places.find((p) => p.name === "第六教学楼")!;
  expect(articleMapPlace("白云山校区一教南楼117", "baiyun")).toMatchObject({
    placeId: first.id,
    campus: "baiyun",
    precision: "building",
  });
  for (const raw of ["六教B202", "白云山校区第六教学楼中庭", "明德报告厅(原"]) {
    expect(articleMapPlace(raw, "baiyun")?.placeId).toBe(sixth.id);
  }
  expect([...buildingActivityPlaceIds(first.id)]).toEqual([first.id]);
});
it("leaves campus-only, off-campus, conflicting and ambiguous addresses unmatched", () => {
  for (const raw of [
    "白云山校区",
    "中共三大会址纪念馆",
    "一教和六教",
    "大学城校区一教",
  ]) {
    expect(articleMapPlace(raw, "baiyun")).toBeNull();
  }
  expect(articleMapPlace("一教南楼117", "university_town")).toBeNull();
  expect(articleMapPlace("图书馆")).toBeNull();
});
