import { describe, expect, it } from "vitest";
import {
  navigationIntent,
  pendingNavigationMessages,
} from "@/domain/agent/navigation-intent";

describe("navigation intent in a fresh browser conversation", () => {
  it("uses user requests after the last verified completed route, never model prose", () => {
    const completed = [
      { role: "user", text: "我想去北苑5", cards: [] },
      { role: "assistant", text: "路线已显示", cards: [{ kind: "route" }] },
    ];
    expect(pendingNavigationMessages(completed)).toEqual([]);
    expect(
      pendingNavigationMessages([
        ...completed,
        { role: "user", text: "我想去图书馆", cards: [] },
        { role: "assistant", text: "请使用位置", cards: [] },
      ]),
    ).toEqual(["我想去图书馆"]);
  });
  it.each(["南苑7到语心桥", "南苑7栋到语心桥", "从南苑7栋到语心桥"])(
    "uses the named origin without relying on a previous map selection: %s",
    (text) => {
      const intent = navigationIntent(text);
      expect(intent.originIds).toEqual(["osm-way-312536955"]);
      expect(intent.destinations.map((place) => place.name)).toEqual([
        "语心桥",
      ]);
      expect(intent.originMissing).toBe(false);
      expect(intent.needsLocation).toBe(false);
    },
  );
  it("requests browser location for a destination-only navigation request", () => {
    expect(navigationIntent("我想去北苑5").needsLocation).toBe(true);
    expect(navigationIntent("请帮我导航到北苑5").needsLocation).toBe(true);
  });
  it("accepts a manual origin after device location was unavailable", () => {
    const intent = navigationIntent("南苑7栋", undefined, false, [
      "我想去北苑5",
    ]);
    expect(intent.resolvedMessage).toBe("从南苑7栋到北苑5栋");
    expect(intent.needsLocation).toBe(false);
    expect(intent.originIds).toEqual(["osm-way-312536955"]);
  });
  it("does not let a prior browser selection replace an explicit or default device origin", () => {
    const oldSelection = "osm-way-307250998";
    expect(navigationIntent("南苑7栋到语心桥", oldSelection).originIds).toEqual(
      ["osm-way-312536955"],
    );
    expect(
      navigationIntent("我想去北苑5", oldSelection, true).originIds,
    ).toEqual(["device_location"]);
    expect(
      navigationIntent("那从这里去图书馆呢", "osm-way-312536955").originIds,
    ).toEqual(["osm-way-312536955"]);
  });
  it("resolves 我的位置 against the last user's destination across a restored conversation", () => {
    const intent = navigationIntent("我的位置", undefined, true, [
      "我想去北苑5",
    ]);
    expect(intent.resolvedMessage).toBe("从我的位置到北苑5栋");
    expect(intent.originIds).toEqual(["device_location"]);
    expect(intent.destinations.map((p) => p.name)).toEqual(["北苑5栋"]);
    expect(
      navigationIntent("我的位置", undefined, false, ["我想去北苑5"])
        .originMissing,
    ).toBe(true);
    expect(
      navigationIntent("我的位置", undefined, true, ["我想去北苑5", "你好"])
        .routeQuestion,
    ).toBe(false);
  });
  it("never resolves unknown dormitory numbers to a shorter alias or requests GPS for a search/negation", () => {
    for (const question of ["南苑77栋到语心桥", "南苑999到语心桥"])
      expect(navigationIntent(question).namedPlaces.map((p) => p.name)).toEqual(
        ["语心桥"],
      );
    for (const question of [
      "找到南苑7栋",
      "定位到图书馆",
      "帮我找到北苑5栋",
      "不要去图书馆",
      "不要使用我的位置",
    ])
      expect(navigationIntent(question).needsLocation).toBe(false);
    expect(navigationIntent("从火星宿舍去图书馆").needsLocation).toBe(false);
    expect(navigationIntent("南苑77栋到语心桥").needsLocation).toBe(false);
  });
});
