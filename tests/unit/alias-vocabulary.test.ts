import { describe, expect, it } from "vitest";
import {
  ALIAS_GROUPS,
  COLLEGE_GROUPS,
  TOPIC_GROUPS,
  VENUE_GROUPS,
  collegeAliases,
} from "@/lib/retrieval/aliases";
import { entityTerms } from "@/lib/retrieval/query-plan";
import { entityQueryVariants } from "@/lib/server/assistant/content-intent";

describe("alias vocabulary", () => {
  it("keeps one table for every consumer", () => {
    // The three subsystems used to keep private copies; they drifted, and the
    // college list was missing from all of them at once. They now read this
    // file, so a term added here is visible everywhere.
    const ids = ALIAS_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COLLEGE_GROUPS.length).toBeGreaterThan(15);
    expect(TOPIC_GROUPS.length).toBeGreaterThan(10);
    expect(TOPIC_GROUPS.every((g) => ALIAS_GROUPS.includes(g))).toBe(true);
  });

  it("does not repeat an alias inside one group", () => {
    // Across groups a term may legitimately belong to two subjects
    // ("学生资助" is both a scholarship and a bursary), but inside a group
    // every spelling must be unique.
    const groups = [
      ...ALIAS_GROUPS.map((g) => ({ id: g.id, aliases: g.aliases })),
      ...COLLEGE_GROUPS.map((g) => ({ id: g.id, aliases: g.names })),
    ];
    for (const group of groups) {
      expect(new Set(group.aliases).size).toBe(group.aliases.length);
    }
  });

  it("reads a college short name and its full name as one subject", () => {
    expect(collegeAliases("信息学院")).toContain("信息科学与技术学院");
    expect(collegeAliases("信息科学与技术学院")).toContain("信息学院");
  });

  it("keeps action words out of the topic table", () => {
    // "英语演讲竞赛报名通知" is a notice about a competition, not about the
    // act of registering. If "报名" became a topic, that title would look like
    // a different subject than "英语演讲比赛".
    const topicIds = new Set(TOPIC_GROUPS.map((group) => group.id));
    for (const id of ["registration", "materials", "requirements"]) {
      expect(topicIds.has(id)).toBe(false);
      expect(ALIAS_GROUPS.some((g) => g.id === id)).toBe(true);
    }
  });

  it("expands a canteen short name the same way in both places", () => {
    for (const venue of VENUE_GROUPS) {
      expect(entityTerms(venue.names[0])).toEqual(venue.names);
    }
    expect(entityQueryVariants("一饭几点开门")).toContain("文采园几点开门");
  });
});
