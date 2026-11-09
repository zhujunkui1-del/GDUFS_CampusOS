import { describe, expect, it } from "vitest";
import { verdictSeverity } from "@/lib/server/assistant/evidence-check";

describe("evidence verdict severity", () => {
  it("uses the judge's own severity when it is present", () => {
    expect(
      verdictSeverity({ severity: "unverified", issues: ["来源与答复矛盾"] }),
    ).toBe("unverified");
    expect(
      verdictSeverity({ severity: "contradiction", issues: ["来源未提及"] }),
    ).toBe("contradiction");
  });

  it("classifies an omitted detail as a caveat, not a contradiction", () => {
    // These are the exact issue strings the judge produced for open-ended
    // questions that were nevertheless downgraded to excerpts.
    expect(
      verdictSeverity({
        issues: ["引用资料未提及“广外2027届毕业生”这一表述"],
      }),
    ).toBe("unverified");
    expect(
      verdictSeverity({
        issues: ["资料未提及云山勤工2300余岗位、7部门22实体等细节"],
      }),
    ).toBe("unverified");
    expect(
      verdictSeverity({ issues: ["来源1未提及发布单位为现代教育技术中心"] }),
    ).toBe("unverified");
  });

  it("keeps a proven contradiction hard", () => {
    expect(
      verdictSeverity({ issues: ["来源1说自助机在一楼，答复称四楼，两者矛盾"] }),
    ).toBe("contradiction");
  });

  it("keeps an unclassified verdict fail-closed", () => {
    expect(verdictSeverity({ issues: ["仍未纠正楼层"] })).toBe(
      "contradiction",
    );
  });
});
