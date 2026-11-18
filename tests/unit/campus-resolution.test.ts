import { contentIntent } from "@/lib/server/assistant/content-intent";
import { navigationIntent } from "@/domain/agent/navigation-intent";
import { baiyunPlaces } from "@/features/campus-map/data/baiyun-places";
import { expect, it } from "vitest";
import { resolveCampus } from "@/lib/server/assistant/campus-resolution";
it("resolves campus from explicit wording, map selection and prior user turn", () => {
  const map = {
    campus: "baiyun" as const,
    selectedPlaceId: "osm-way-962936641",
  };
  expect(resolveCampus("这里有什么活动", map)).toMatchObject({
    campus: "baiyun",
    source: "selection",
    selectedPlaceId: map.selectedPlaceId,
  });
  expect(resolveCampus("大学城图书馆在哪", map)).toMatchObject({
    campus: "university",
    source: "explicit",
    selectedPlaceId: undefined,
  });
  expect(
    resolveCampus("那边有什么讲座", undefined, "白云山图书馆在哪"),
  ).toMatchObject({ campus: "baiyun", source: "previous_turn" });
  expect(resolveCampus("大学城图书馆到白云山图书馆怎么走")).toMatchObject({
    source: "both",
    campus: undefined,
  });
  expect(resolveCampus("图书馆在哪")).toMatchObject({
    source: "unspecified",
    campus: undefined,
  });
});

it("routes Baiyun named-building questions to map skills before text retrieval", () => {
  expect(
    contentIntent(
      "白云山校区第二教学楼在哪里？请在地图定位。",
      [],
      undefined,
      "baiyun",
    ).map,
  ).toBe(true);
  const route = navigationIntent(
    "从白云山校区图书馆到第二教学楼怎么走？",
    undefined,
    false,
    [],
    baiyunPlaces,
  );
  expect(route).toMatchObject({
    routeQuestion: true,
    originMissing: false,
    needsLocation: false,
  });
  expect(route.destinations.map((p) => p.name)).toEqual(["第二教学楼"]);
});
