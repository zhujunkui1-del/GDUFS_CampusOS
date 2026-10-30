import { afterEach, expect, it } from "vitest";
import cases from "../fixtures/persona-scenarios.json";
import {
  defaultPersona,
  personaControl,
  personaContext,
  personaPrompt,
  personaTone,
} from "@/lib/server/assistant/persona";
import { AssistantStore } from "@/lib/server/assistant/store";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import {
  requestTimeWindow,
  withinWindow,
} from "@/lib/server/assistant/time-window";
for (const c of cases)
  it(`persona contract ${c.id}: ${c.message}`, () => {
    if (c.group === "controls") {
      const next = personaControl(c.message, {
        ...defaultPersona(),
        enabled: c.control !== "resume",
      });
      expect(next.changed).toBe(true);
      expect(next.business).toBe("");
      expect(next.preference.enabled).toBe(c.control !== "off");
      if (c.control === "concise") expect(next.preference.concise).toBe(true);
      if (c.control === "cute") expect(next.preference.intensity).toBe("cute");
      expect(personaControl(c.followup!, next.preference).preference).toEqual(
        next.preference,
      );
    } else {
      expect(personaTone(c.message, defaultPersona())).toBe(c.mode);
      const prompt = personaPrompt(c.message, defaultPersona());
      expect(prompt).toContain("不能改变事实");
      if (c.mode !== "daily")
        expect(personaContext(c.message, defaultPersona()).aside).toBe(false);
    }
  });
it("strips only tone controls, retaining topic, date and campus", () => {
  const c = personaControl("正经点，查南校2026年奖学金申请条件");
  expect(c.business).toBe("查南校2026年奖学金申请条件");
  expect(c.preference.enabled).toBe(false);
  expect(contentIntent(c.business).tools).toContain("search_campus_knowledge");
});
it("serious mode is temporary, explicit off is persistent", () => {
  const p = defaultPersona();
  expect(personaTone("晕倒了", p)).toBe("serious");
  expect(personaTone("一饭好吃吗", p)).toBe("daily");
  const off = personaControl("别演了", p).preference;
  expect(personaTone("一饭好吃吗", off)).toBe("off");
  expect(
    personaTone(
      "给你小鱼干",
      personaControl("恢复刚才的说话方式", off).preference,
    ),
  ).toBe("daily");
});
it("does not interpret quoted or negated persona words as a control", () => {
  expect(personaControl("“别演了”是什么意思").changed).toBe(false);
  expect(personaControl("不要关闭人格").changed).toBe(false);
});
it("keeps the concrete person across multiple followups and persona-only turns", () => {
  const history = [
    "戴建业是广外云山工作室首席专家吗",
    "那他属于南校吗",
    "别演了",
  ].map((text, i) => ({
    id: "fixture-" + i,
    role: "user" as const,
    text,
    cards: [],
  }));
  const result = contentIntent("他是哪个学院的呢", history);
  expect(result.query).toContain("戴建业");
  expect(result.query).not.toContain("别演了");
  expect(personaTone(result.query, defaultPersona())).toBe("professional");
  const dates = contentIntent(
    "那下周呢",
    [{ id: "fixture-date", role: "user", text: "本周有什么讲座", cards: [] }],
    Date.parse("2026-10-27T00:00:00Z"),
  );
  expect(dates.timeWindow?.after).toBe("2026-11-02");
});
it("binds local dates and publication/event roles without pretending publication is event time", () => {
  const now = Date.parse("2026-10-27T03:00:00Z");
  expect(requestTimeWindow("这一周的校园趣事", now)).toEqual({
    after: "2026-10-21",
    before: "2026-10-27",
    role: "publication",
    timezone: "Asia/Shanghai",
  });
  expect(requestTimeWindow("本周讲座", now)).toMatchObject({
    after: "2026-10-26",
    before: "2026-11-01",
    role: "event",
  });
  expect(
    requestTimeWindow("今天活动", Date.parse("2026-10-26T17:00:00Z"))?.after,
  ).toBe("2026-10-27");
  const window = requestTimeWindow("这一周的新闻", now)!;
  expect(withinWindow(null, window)).toBe(false);
  expect(withinWindow("2026-10-15", window)).toBe(false);
  expect(withinWindow("2026-10-26T17:00:00Z", window)).toBe(true);
});
const open: ReturnType<typeof sqliteD1>[] = [];
afterEach(() => open.splice(0).forEach((f) => f.close()));
it("stores separate owner-scoped preferences beyond the history window and removes them with conversation", async () => {
  const f = sqliteD1();
  open.push(f);
  const store = new AssistantStore(f.db);
  const user = await store.identity(new Request("https://fixture.invalid/api"));
  const conversation = await store.conversation(user);
  const off = personaControl("别演了").preference;
  await store.setPersona(user, conversation.id, off);
  for (let i = 0; i < 44; i++)
    await store.append(
      conversation,
      i % 2 ? "assistant" : "user",
      "隔离消息" + i,
    );
  expect(await new AssistantStore(f.db).persona(user, conversation.id)).toEqual(
    off,
  );
  const history = await store.history(user, conversation.id);
  expect(history.messages).toHaveLength(44);
  expect(history.messages.some((m) => m.text.includes('"enabled"'))).toBe(
    false,
  );
  const stranger = await store.identity(
    new Request("https://fixture.invalid/api"),
  );
  await expect(
    store.setPersona(stranger, conversation.id, defaultPersona()),
  ).rejects.toThrow();
  await expect(store.persona(stranger, conversation.id)).rejects.toThrow();
  const other = await store.conversation(user);
  expect((await store.persona(user, other.id)).enabled).toBe(true);
});

it("keeps one natural dafeiyu touch in professional policy answers", () => {
  const prompt = personaPrompt(
    "广外的考研或保研政策",
    { ...defaultPersona(), intensity: "normal" },
    [],
  );
  expect(personaTone("广外的考研或保研政策", defaultPersona())).toBe(
    "professional",
  );
  expect(prompt).toContain("本鱼");
  expect(prompt).toContain("专业友好");
});
