import { describe, expect, it } from "vitest";
import {
  articleTitle,
  requiresPlaceLookup,
  wantsArticle,
} from "@/lib/server/assistant/intent";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { inputGate } from "@/lib/server/assistant/input-gate";

describe("article lookup is not a place lookup", () => {
  it("extracts a quoted article title", () => {
    expect(
      articleTitle(
        '帮我找到"历练安保精兵 共筑平安校园——保卫部工会举办2026年体能大练兵暨趣味体能挑战赛-广东外语外贸大学工会委员会"这篇文章',
      ),
    ).toContain("历练安保精兵");
    expect(
      articleTitle("“学生社区文化传习实践：文化筑梦，强国有我”找到这篇文章"),
    ).toBe("学生社区文化传习实践：文化筑梦，强国有我");
    expect(
      articleTitle("帮我找到「光影无界·师生影像作品展」这篇文章"),
    ).toBe("光影无界·师生影像作品展");
    expect(
      articleTitle(
        "找文章“《MBA大讲堂162》（新闻）陈梦雄：AI时代下人力资源的“守”与“变””",
      ),
    ).toBe("MBA大讲堂162");
  });
  it("never routes an article request to the map", () => {
    const message = "帮我找到《关于开展2026年校园文化活动的通知》这篇文章";
    expect(wantsArticle(message)).toBe(true);
    expect(requiresPlaceLookup(message)).toBe(false);
    expect(requiresPlaceLookup("带我去南苑11栋")).toBe(true);
  });
  it("keeps result follow-ups on the article thread, not the map", () => {
    expect(requiresPlaceLookup("只能找到这两条吗")).toBe(false);
    expect(requiresPlaceLookup("还有别的来源吗")).toBe(false);
    expect(requiresPlaceLookup("就这几条吗")).toBe(false);
    expect(requiresPlaceLookup("又康超市在哪")).toBe(true);
  });
  it("uses keywords for questions and the full sentence for declarative lookups", () => {
    expect(contentIntent("了解下2026年研究生奖学金的获奖情况").retrievalQuery).not.toContain(
      "了解",
    );
    expect(
      contentIntent("2026年研究生学业奖学金拟获奖名单公示").retrievalQuery,
    ).toBe("2026年研究生学业奖学金拟获奖名单公示");
  });
  it("keeps quoted titles inside the campus gate", () => {
    expect(inputGate('"学生社区文化传习实践：文化筑梦，强国有我"找到这篇文章')).toBe(
      "campus",
    );
  });
  it("routes article requests to knowledge with the title attached", () => {
    const intent = contentIntent(
      '帮我找到"历练安保精兵 共筑平安校园——保卫部工会举办2026年体能大练兵暨趣味体能挑战赛-广东外语外贸大学工会委员会"这篇文章',
    );
    expect(intent.articleLookup).toBe(true);
    expect(intent.map).toBe(false);
    expect(intent.tools).toEqual(["search_campus_knowledge"]);
    expect(intent.articleQuery).toContain("历练安保精兵");
  });
});
describe("titles and statements are not off-topic", () => {
  it("lets a political bulletin and an official notice reach campus search", () => {
    expect(inputGate("党的二十届五中全会公报一图速览")).toBe("campus");
    expect(
      inputGate("查找有没有关于开展地震受灾学生临时困难补助申请的通知"),
    ).toBe("campus");
  });
  it("keeps a full title that contains inner quotes", () => {
    const intent = contentIntent(
      "学习强馆第六讲聚焦“十五五”时期大学图书馆发展路径与服务创新",
    );
    expect(intent.articleLookup).toBe(true);
    expect(intent.articleQuery).toContain("学习强馆第六讲");
    expect(intent.articleQuery).toContain("十五五");
    expect(intent.map).toBe(false);
  });
  it("extracts the earthquake notice title and searches knowledge", () => {
    const intent = contentIntent(
      "查找有没有关于开展地震受灾学生临时困难补助申请的通知",
    );
    expect(intent.articleLookup).toBe(true);
    expect(intent.articleQuery).toContain("地震受灾学生临时困难补助");
    expect(intent.tools).toEqual(["search_campus_knowledge"]);
    expect(intent.active).toBe(true);
  });
});

describe("recent radar queries keep the topic and drop filler words", () => {
  it("'竞赛活动情况' is still a competition recency request without a 情况 filter", () => {
    const intent = contentIntent("看看广外最近的竞赛活动情况");
    expect(intent.recentDiscovery).toBe(true);
    expect(intent.radarCategory).toBe("competition");
    expect(intent.retrievalQuery).toBe("广外 竞赛");
    expect(intent.tools).toContain("search_campus_events");
  });
  it("'最新的资讯' is a recency request even without a radar tag", () => {
    const intent = contentIntent("告诉我最新的资讯");
    expect(intent.recentDiscovery).toBe(true);
    expect(intent.radarCategory).toBeUndefined();
    expect(intent.tools).toContain("search_campus_events");
  });
  it("a long multi-topic message is not reduced to its first radar tag", () => {
    const intent = contentIntent(
      "请帮我查找广东外语外贸大学最近关于学生校园生活、食堂、宿舍、图书馆、体育场馆、校园活动、竞赛报名、讲座信息、就业招聘、奖学金评定、志愿服务、社团招新、校历安排、校车时刻、校园卡办理、网络服务、快递点、校医院、心理咨询、交换项目、辅修学位、毕业论文、实习实践、创新创业、科研训练、学科竞赛、文化艺术、体育锻炼、安全教育、反诈宣传和节能环保方面的全部最新通知公告并逐条列出原文链接和发布日期，同时说明哪些可以在校园雷达看到、哪些需要去学校官网确认、哪些已经截止。",
    );
    expect(intent.multiTopic).toBe(true);
    expect(intent.radarCategory).toBeUndefined();
    expect(intent.recentDiscovery).toBe(true);
    expect(intent.retrievalQuery).toBe("最新 校园 通知");
    expect(intent.tools).toEqual(["search_campus_knowledge"]);
  });
});

describe("entity names are always keyword lookups", () => {
  it("searches a teacher name in both radar and knowledge", () => {
    const intent = contentIntent("了解下王春业老师");
    expect(intent.active).toBe(true);
    expect(intent.entityLookup).toBe(true);
    expect(intent.retrievalQuery).toBe("王春业");
    expect(intent.tools).toEqual([
      "search_campus_knowledge",
      "search_campus_events",
    ]);
  });
  it("treats a bare topic as a lookup instead of refusing it", () => {
    const intent = contentIntent("王春业");
    expect(intent.active).toBe(true);
    expect(intent.retrievalQuery).toBe("王春业");
  });
  it("does not keyword-search greetings, unrelated statements or abuse", () => {
    for (const message of [
      "你好",
      "今天天气不错",
      "我喜欢蓝色",
      "一饭在哪",
      "你妈似了",
    ]) {
      expect(contentIntent(message).active, message).toBe(false);
    }
  });
});

describe("title-like notices and map disambiguation", () => {
  it("treats an unquoted 关于…通知 as an article lookup", () => {
    const intent = contentIntent(
      "查找有没有关于开展地震受灾学生临时困难补助申请的通知",
    );
    expect(intent.articleLookup).toBe(true);
    expect(intent.articleQuery).toBe(
      "关于开展地震受灾学生临时困难补助申请的通知",
    );
  });
  it("does not route a place request through content search", () => {
    expect(contentIntent("帮我找图书馆").active).toBe(false);
    expect(contentIntent("从南苑7栋去图书馆").active).toBe(false);
  });
});

it("uses a focused query for campus overview questions", () => {
  const intent = contentIntent("学校有几个校区");
  expect(intent.active).toBe(true);
  expect(intent.retrievalQuery).toBe("校区");
  expect(intent.tools).toContain("search_campus_knowledge");
});
