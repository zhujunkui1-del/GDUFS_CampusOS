import { expect, it, vi } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { MockModelProvider } from "../fixtures/mock-model";

const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  resolve: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: runtime.env }),
}));
vi.mock("@/lib/server/models/runtime", () => ({
  platformModelRuntime: async () => ({ resolve: runtime.resolve }),
}));
import { chatResponse } from "@/lib/server/assistant/chat";

const TITLE = "光影无界·师生影像作品展";
const BODY =
  "为进一步丰富校园文化生活，学院组织师生创作了一批影像作品。" +
  "展览时间：2026年11月24日—12月25日；展览地点：白云山校区图书馆一层。";

type Fixture = Awaited<ReturnType<typeof dateGateFixture>>;

async function seedExhibition(f: Fixture) {
  const id = await f.article(
    "exhibition",
    "2026-11-09",
    TITLE,
    `<p>${BODY}</p>`,
  );
  const document = await f.store.document(id);
  await f.db.batch(
    await analysisStatements(
      f.db,
      document.id,
      document.contentRevision,
      document.inputHash!,
      { title: TITLE, body: BODY, publishedAt: "2026-11-09" },
    ),
  );
  await ensureRetrievalIndex(f.db, id);
}

async function seedArticle(
  f: Fixture,
  key: string,
  publishedAt: string,
  title: string,
  body: string,
) {
  const id = await f.article(key, publishedAt, title, `<p>${body}</p>`);
  const document = await f.store.document(id);
  await f.db.batch(
    await analysisStatements(
      f.db,
      document.id,
      document.contentRevision,
      document.inputHash!,
      { title, body, publishedAt },
    ),
  );
  await ensureRetrievalIndex(f.db, id);
}

async function post(
  f: Fixture,
  question: string,
  session: { conversationId?: string; cookie?: string } = {},
) {
  const response = await chatResponse(
    new Request("https://campus.invalid/api/agent/chat", {
      method: "POST",
      headers: {
        Origin: "https://campus.invalid",
        "Content-Type": "application/json",
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
      body: JSON.stringify({
        message: question,
        clientRequestId: crypto.randomUUID(),
        ...(session.conversationId
          ? { conversationId: session.conversationId }
          : {}),
      }),
    }),
  );
  const events = (await response.text()).split("\n\n").flatMap((frame) => {
    const raw = frame.split("\n").find((line) => line.startsWith("data:"));
    return raw ? [JSON.parse(raw.slice(5))] : [];
  });
  const ready = events.find(
    (event) =>
      event.type === "artifact.ready" && event.payload.conversationId,
  );
  const setCookie = response.headers.get("set-cookie") ?? undefined;
  return {
    status: response.status,
    text: events
      .filter((event) => event.type === "message.delta")
      .map((event) => String(event.payload.text))
      .join(""),
    metrics: events.find((event) => event.type === "run.completed")?.payload
      .metrics,
    conversationId: ready?.payload.conversationId as string | undefined,
    cookie: setCookie?.split(";")[0],
  };
}

function installRuntime(f: Fixture, client: MockModelProvider) {
  runtime.env = {
    DB: f.db,
    APP_ENV: "preview",
    AGENT_VALIDATION_UNLIMITED: "true",
    AGENT_SIGNING_SECRET: "isolated-signing-key-at-least-thirty-two-characters",
  };
  runtime.resolve.mockResolvedValue({
    client,
    snapshot: {
      source: "platform",
      provider: "stepfun",
      model: "fixture",
      policyVersion: "fixture",
      testedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    },
  });
}

async function fixtureWith(client: MockModelProvider) {
  const f = await dateGateFixture();
  await seedExhibition(f);
  installRuntime(f, client);
  return f;
}

it("corrects a denial when the retrieved exhibition page states the schedule", async () => {
  const client = new MockModelProvider([
    {
      content: "资料里没有写具体的展览时间和地点。",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    },
    {
      content:
        "展览时间为 2026年11月24日—12月25日，地点在白云山校区图书馆一层 [1]。",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    },
  ]);
  const f = await fixtureWith(client);
  try {
    const { text, metrics } = await post(
      f,
      `${TITLE}\n发布时间：2026-11-09\n来源：广外艺术学院\n请整理展览时间和地点`,
    );
    expect(metrics?.answerMode).not.toBe("article_not_found");
    expect(text).toContain("2026年11月24日");
    expect(text).toContain("白云山校区图书馆一层");
    expect(text).not.toContain("没有写具体的展览时间和地点");
  } finally {
    f.close();
  }
});

it("keeps the article context in the same conversation for a follow-up", async () => {
  const client = new MockModelProvider([
    {
      content: "资料里没有写具体的展览时间和地点。",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    },
    {
      content:
        "展览时间为 2026年11月24日—12月25日，地点在白云山校区图书馆一层 [1]。",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    },
    {
      content: "展览地点是白云山校区图书馆一层 [1]。",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    },
  ]);
  const f = await fixtureWith(client);
  try {
    const first = await post(
      f,
      `${TITLE}\n发布时间：2026-11-09\n来源：广外艺术学院\n请整理展览时间和地点`,
    );
    const second = await post(f, "那地点呢？", {
      conversationId: first.conversationId,
      cookie: first.cookie,
    });
    expect(second.text).toContain("白云山校区图书馆一层");
    expect(second.text).not.toContain("没有写");
  } finally {
    f.close();
  }
});

it("extracts the date and venue from an unstructured lecture preview", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "讲座预告 | 戴建业教授：选择·专注与未来";
  const body =
    "11月19日，在大学城校区凤鸣会堂，我们邀请到戴教授作专题讲座。" +
    "11月19日，凤鸣会堂，我们不见不散。";
  await seedArticle(f, "lecture", "2026-11-17", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n发布时间：2026/11/17 12:24\n广外学工\n总结下活动时间、地点`,
    );
    expect(metrics?.answerMode).toBe("article_schedule");
    expect(text).toContain("11月19日");
    expect(text).toContain("大学城校区凤鸣会堂");
  } finally {
    f.close();
  }
});

it("retrieves the tuition section of a long admission article", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "广东外语外贸大学2027年博士研究生招生简章";
  const filler =
    "学校坚持立德树人，面向国家战略需求培养高层次人才。".repeat(40);
  const body =
    `${filler}五、学费标准、奖助学金、住宿情况和培养所在校区。` +
    "学术型博士研究生非定向生10000元/生·学年；定向生20000元/生·学年。";
  await seedArticle(f, "phd", "2026-11-19", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n发布时间：2026/11/19\n研究生招生信息网\n总结下研究生的学费标准`,
    );
    expect(metrics?.answerMode).toBe("article_summary");
    expect(text).toContain("学费标准");
    expect(text).toContain("10000元");
    expect(text).not.toContain("工具结果未通过验证");
  } finally {
    f.close();
  }
});

it("answers a submission deadline instead of the conference date", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "第四届湾区国际传播论坛征稿通知";
  const body =
    "本届论坛由广东外语外贸大学与广东国际战略研究院主办，诚挚邀请专家学者及在校研究生投稿。".repeat(
      12,
    ) +
    "论坛征稿截止日期为2026年11月12日。六、论坛时间与地点：" +
    "时间：2026年11月21-23日举办；来稿截止日期：2026年11月12日。";
  await seedArticle(f, "cfp", "2026-11-01", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n发布时间：2026/11/01\n广外新传\n征稿的截止时间是什么`,
    );
    expect(metrics?.answerMode).toBe("article_deadline");
    expect(text).toContain("2026年11月12日");
    expect(text).not.toContain("活动时间：2026年11月21日");
  } finally {
    f.close();
  }
});

it("quotes the suspension notice for its dates and affected group", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "广外停课通知";
  const body =
    "学校定于2026年11月20日至21日举办运动会。11月20日（周五）所有课程停课，" +
    "请各本科教学单位提前做好教学安排。";
  await seedArticle(f, "suspension", "2026-11-16", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n发布时间：2026/11/16 11:39\n广东外语外贸大学\n告诉我停课时间和停课人群`,
    );
    expect(metrics?.answerMode).toBe("article_suspension");
    expect(text).toContain("11月20日");
    expect(text).toContain("本科教学单位");
  } finally {
    f.close();
  }
});

it("lists the labelled dates in a long competition notice", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "第八届红色演艺大赛";
  const body =
    "活动时间\n2026年10月15日-2026年11月29日\n初赛\n11.12 周四（暂定）\n" +
    "决赛\n11.29 周日下午（暂定）\n报名\n10月25日18:00前提交报名表";
  await seedArticle(f, "red", "2026-10-10", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n帮我找出其中重要的时间点`,
    );
    expect(metrics?.answerMode).toBe("article_timepoints");
    expect(text).toContain("11.12");
    expect(text).toContain("11.29");
  } finally {
    f.close();
  }
});

it("starts an application-condition summary at the condition heading", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "关于2027年招收硕博连读攻读博士学位研究生的通知";
  const filler =
    "学校坚持立德树人，面向国家战略需求培养高层次人才。".repeat(30);
  const body =
    `${filler}三、申请条件\n（一）拥护中国共产党的领导；\n（二）已修完硕士课程且成绩优秀。\n` +
    "四、申请材料\n（一）申请表；\n（二）专家推荐信。";
  await seedArticle(f, "phd-conditions", "2026-11-19", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n发布时间：2026/11/19\n研究生招生信息网\n通知中的提及的申请条件有什么`,
    );
    expect(metrics?.answerMode).toBe("article_summary");
    expect(text).toContain("申请条件");
    expect(text).toContain("拥护中国共产党的领导");
    expect(text.indexOf("申请条件")).toBeLessThan(text.indexOf("拥护中国共产党的领导"));
    expect(text).not.toContain("四、工作程序");
  } finally {
    f.close();
  }
});

it("does not present a footer-only image post as an application process", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "【2027校招】宏川集团2027校园招聘";
  const body =
    "来源| 宏川招聘\n编辑| 齐雨轩\n初审| 阳豆豆\n复审| 张亦舒\n终审| 徐昶斌";
  await seedArticle(f, "recruit", "2026-11-19", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n发布时间：2026/11/19 22:12\n广外就业\n怎么参加应聘，应聘流程是什么`,
    );
    expect(metrics?.answerMode).toBe("article_summary");
    expect(text).toContain("正文可能是图片");
    expect(text).not.toContain("应聘流程：\n来源");
  } finally {
    f.close();
  }
});

it("summarises a news article from its opening paragraph", async () => {
  const client = new MockModelProvider([]);
  const f = await dateGateFixture();
  const title = "喜报｜我院学子在第五届西部地区模拟外交谈判大赛中荣获二等奖";
  const body =
    "本网讯 11月6日至11月7日，第五届西部地区模拟外交谈判大赛在四川外国语大学举办。" +
    "我院代表队荣获二等奖。";
  await seedArticle(f, "award", "2026-11-08", title, body);
  installRuntime(f, client);
  try {
    const { text, metrics } = await post(
      f,
      `${title}\n帮我生成文章摘要`,
    );
    expect(metrics?.answerMode).toBe("article_summary");
    expect(text).toContain("二等奖");
    expect(text).toContain("11月6日");
  } finally {
    f.close();
  }
});
