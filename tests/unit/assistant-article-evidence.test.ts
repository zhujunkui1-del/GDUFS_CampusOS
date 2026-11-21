import { describe, expect, it } from "vitest";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { articleTitle } from "@/lib/server/assistant/intent";
import {
  hasMatchingExternalArticle,
  matchesTargetTitle,
  missesHardSubject,
} from "@/lib/server/assistant/article-match";
import { retrievedEvidenceAnswer } from "@/lib/server/assistant/evidence-answer";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";
import { dateConflicts } from "@/lib/retrieval/dates";

const TITLE = "光影无界·师生影像作品展";
const METADATA =
  "光影无界·师生影像作品展 发布时间：2026-11-09 来源：广外艺术学院 帮我整理";

describe("article metadata", () => {
  it("extracts the title before publication metadata", () => {
    expect(articleTitle(METADATA)).toBe(TITLE);
    expect(articleTitle(`“${TITLE}”这篇文章`)).toBe(TITLE);
  });

  it("routes an exhibition article to both knowledge and events", () => {
    const intent = contentIntent(METADATA);
    expect(intent.articleLookup).toBe(true);
    expect(intent.tools).toContain("search_campus_knowledge");
    expect(intent.tools).toContain("search_campus_events");
  });

  it("keeps the article thread on a follow-up in an existing conversation", () => {
    const intent = contentIntent("那展览时间和地点呢？", [
      { id: "old", role: "user", text: METADATA, cards: [], sequence: 1 },
      {
        id: "answer",
        role: "assistant",
        text: "这篇文章介绍了师生影像作品展。",
        cards: [],
        sequence: 2,
      },
    ]);
    expect(intent.active).toBe(true);
    expect(intent.tools.length).toBeGreaterThan(0);
  });
});

describe("target alignment", () => {
  it("matches a full-width title variant", () => {
    expect(
      matchesTargetTitle(
        "“学生社区文化传习实践：文化筑梦，强国有我”",
        "学生社区文化传习实践:文化筑梦,强国有我",
      ),
    ).toBe(true);
  });

  it("keeps an official external hit from becoming article_not_found", () => {
    expect(
      hasMatchingExternalArticle(
        [
          {
            kind: "external_source",
            title: "2026年英语教育学院招生简章",
          },
        ],
        "2026年英语教育学院招生简章",
      ),
    ).toBe(true);
    expect(
      hasMatchingExternalArticle(
        [{ kind: "external_source", title: "校园新闻一览" }],
        "2026年英语教育学院招生简章",
      ),
    ).toBe(false);
  });

  it("rejects same-account posts that never mention the hard subject", () => {    const plan = {
      entities: ["领养这只猫"],
      modifiers: [{ hard: true, original: "领养" }],
    } as unknown as ReturnType<typeof buildQueryPlan>;
    expect(
      missesHardSubject(plan, {
        title: "动保协会2026年10月账目公示",
        contentSnippet: "现将本月收支明细公示如下。",
      }),
    ).toBe(true);
    expect(
      missesHardSubject(plan, {
        title: "三花妹妹领养公告",
        contentSnippet: "领养这只猫请联系协会。",
      }),
    ).toBe(false);
  });
});

describe("schedule evidence", () => {
  it("does not call a start and end date a contradiction", () => {
    expect(
      dateConflicts(
        "展览时间：2026年11月24日—12月25日\n展览地点：白云山校区图书馆一层",
      ),
    ).toEqual([]);
  });

  it("still reports two different values for the same labelled fact", () => {
    expect(
      dateConflicts("展览时间：2026年11月24日\n展览时间：2026年12月25日"),
    ).toHaveLength(1);
  });

  it("quotes the schedule instead of the article introduction", () => {
    const card = {
      kind: "source",
      documentId: "content-exhibition",
      title: TITLE,
      sourceName: "广外艺术学院",
      originalUrl: "https://www.gdufs.edu.cn/exhibition",
      publishedAt: "2026-11-09",
      snippet:
        "为进一步丰富校园文化生活，学院组织师生创作了一批影像作品。" +
        "本次展览共展出作品八十余件，涵盖摄影、影像与装置。" +
        "参展作者来自多个学院，作品记录了校园生活的不同侧面。" +
        "展览期间还将举办两场导览活动，欢迎师生前往观看。" +
        "展览时间：2026年11月24日—12月25日；展览地点：白云山校区图书馆一层。",
      evidenceType: "full_text",
      classificationState: "knowledge",
      validity: "current",
      readable: true,
    } as AssistantCard;
    const answer = retrievedEvidenceAnswer(
      [card],
      `${TITLE} 展览时间和地点`,
      false,
      new Set(),
      false,
    );
    expect(answer).toContain("展览时间");
    expect(answer).toContain("白云山校区图书馆一层");
  });
});
