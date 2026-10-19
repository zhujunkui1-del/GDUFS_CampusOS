import { describe, it, expect } from "vitest";
import {
  planSourceAdmission,
  assertBatchPublication,
} from "@/lib/ingestion/source-admission";
describe("one-off official source admission preserves previous human decisions", () => {
  it("rejects a list projection without a URL and workflow details before importing", () => {
    expect(() =>
      planSourceAdmission(
        [{ url: "https://example.invalid/a" }],
        [{ id: "old", publication_status: "withdrawn" }],
        ["old"],
      ),
    ).toThrow("FULL_DOCUMENT_DETAILS_REQUIRED");
  });
  it("keeps a prior withdrawn ID protected even if an interrupted import changed it to a draft", () => {
    const selected = [
      { url: "https://example.invalid/a" },
      { url: "https://example.invalid/b" },
    ];
    const plan = planSourceAdmission(
      selected,
      [
        {
          id: "old",
          url: selected[0].url,
          publicationStatus: "draft",
          reviewStatus: "approved",
        },
      ],
      ["old"],
    );
    expect(plan.pending).toEqual([selected[1]]);
    expect(plan.skipped.map((d) => d.id)).toEqual(["old"]);
    expect(plan.existing).toEqual([]);
  });
  it("rejects any publication of protected IDs or records outside the frozen selected batch", () => {
    expect(() =>
      assertBatchPublication("old", ["old", "new"], ["old"]),
    ).toThrow("PUBLICATION_OUTSIDE_APPROVED_BATCH");
    expect(() =>
      assertBatchPublication("unrelated", ["new"], ["old"]),
    ).toThrow();
    expect(() => assertBatchPublication("new", ["new"], ["old"])).not.toThrow();
  });
});
