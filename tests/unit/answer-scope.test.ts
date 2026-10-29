import { expect, it } from "vitest";
import {
  qualifyCampusRosterAnswer,
  removeUnsupportedPersonnelCampuses,
} from "@/lib/server/assistant/answer-scope";
it("does not infer exclusive employment campus from an article's lecture venue", () => {
  const answer =
    "是的，张甲是云山工作室首席专家[来源1]。\n\n他仅任职于北校，不属于南校。\n\n1. 张乙（首席专家，受聘于南校）[来源2]";
  const result = removeUnsupportedPersonnelCampuses(answer, [
    "张甲是云山工作室首席专家。张甲在白云山校区作讲座。",
  ]);
  expect(result).toContain("张甲是云山工作室首席专家[来源1]");
  expect(result).toContain("张乙（首席专家）[来源2]");
  expect(result).not.toMatch(/仅任职于北校|不属于南校|受聘于南校/);
  expect(result).toContain("校区归属尚未核实");
});
it("does not present school-wide appointments as a confirmed south-campus roster", () => {
  const answer =
    "广外南校（大学城校区）的首席专家主要有以下几位：\n\n1. 张甲——云山工作室首席专家[来源1]";
  const result = qualifyCampusRosterAnswer(
    answer,
    "广外南校的首席专家有哪些人",
    [
      {
        title: "学校聘任张甲",
        snippet: "张甲受聘为云山工作室首席专家。",
        citation: 1,
      },
    ],
  );
  expect(result).toContain("尚未核实");
  expect(result).not.toContain("主要有以下几位");
  expect(result).toContain("张甲");
  expect(result).toContain("[1]");
});
it("preserves already qualified rosters and self-contained identity answers", () => {
  const qualified = "尚未核实南校名单，只能提供学校层面的资料。";
  expect(
    qualifyCampusRosterAnswer(qualified, "南校首席专家有哪些人"),
  ).toContain("尚未核实");
  const identity = "是的，该教授受聘为云山工作室首席专家[来源1]。";
  expect(qualifyCampusRosterAnswer(identity, "张甲是广外首席专家吗")).toBe(
    identity,
  );
});
it("uses verified source wording instead of a model's unsupported department grouping", () => {
  const result = qualifyCampusRosterAnswer(
    "法学院首席专家包括张乙[来源7]。",
    "南校首席专家有哪些人",
    [
      {
        title: "学校聘任语言学工作室专家",
        snippet: "张乙受聘为外国语言文学学科建设云山工作室首席专家。",
        citation: 7,
      },
    ],
  );
  expect(result).toContain("张乙");
  expect(result).toContain("[7]");
  expect(result).not.toContain("法学院首席专家");
});
