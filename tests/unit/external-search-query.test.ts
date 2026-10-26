import { it, expect } from "vitest";
import { xiaohongshuQuery } from "../../services/external-search/query.mjs";
it("adapts the real model question to source keywords without losing campus", () => {
  expect(
    xiaohongshuQuery("广东外语外贸大学 大学城校区 食堂 哪个好吃 学生评价"),
  ).toBe("广外大学城食堂");
});
it("preserves the requested dish and residence topic", () => {
  expect(
    xiaohongshuQuery("广东外语外贸大学大学城校区 食堂 美食推荐 学生体验"),
  ).toBe("广外大学城食堂");
  expect(xiaohongshuQuery("广外大学城 食堂 麻辣烫 哪家好吃")).toBe(
    "广外大学城食堂麻辣烫",
  );
  expect(xiaohongshuQuery("广东外语外贸大学 南苑宿舍 隔音 学生体验")).toBe(
    "广外南苑宿舍隔音",
  );
});
it("does not erase an explicit year or English search keywords", () => {
  expect(xiaohongshuQuery("广外2026年 秋季 食堂新品")).toBe(
    "广外2026年秋季食堂新品",
  );
  expect(xiaohongshuQuery("广外 campus food")).toBe("广外 campus food");
});
