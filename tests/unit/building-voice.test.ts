import { it, expect } from "vitest";
import { directBuildingVoice } from "@/lib/assistant-output";
it("removes positive source narration without changing times or missing-data qualifications", () => {
  expect(
    directBuildingVoice(
      "校园建筑资料记载的餐品如下，资料里说中午11:30后人最多。",
    ),
  ).toBe("餐品如下，中午11:30后人最多。");
  const uncertainty = "目前没有实时排队数据，不能确认要等几分钟。";
  expect(directBuildingVoice(uncertainty)).toBe(uncertainty);
  expect(directBuildingVoice("资料中未记载联系电话。")).toBe(
    "资料中未记载联系电话。",
  );
});
