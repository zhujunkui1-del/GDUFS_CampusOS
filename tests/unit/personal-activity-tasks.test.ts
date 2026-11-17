import { expect, it, vi } from "vitest";
import { accountFixture } from "../fixtures/account";
import { PersonalTaskStore } from "@/lib/server/account/tasks";
import { personalRead } from "@/lib/server/assistant/personal-reads";
import { dateGateFixture } from "../fixtures/date-gate";
import { ArticleFavoriteStore } from "@/lib/server/account/favorites";
import { createAccountApi } from "@/lib/server/account/api";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { AccountService } from "@/lib/server/account/email";
import { createConsoleSession } from "@/lib/server/console/auth";
import { chatResponse } from "@/lib/server/assistant/chat";

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: runtime.env }),
}));

it("answers eight personal assistant questions using isolated account and source data", async () => {
  const f = await dateGateFixture();
  const now = Date.parse("2026-11-16T09:00:00+08:00");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    const origin = "https://campus.example",
      key = "isolated-console-key-for-personal-read-eval";
    runtime.env = {
      DB: f.db,
      APP_ENV: "preview",
      AGENT_SIGNING_SECRET: "isolated-agent-signing-key-for-personal-reads",
      AGENT_VALIDATION_UNLIMITED: "true",
      CONSOLE_AUTH_MODE: "admin_key",
      CONSOLE_ADMIN_ACCESS_KEY: key,
      CONSOLE_ORIGIN: origin,
      CONSOLE_ADMIN_EMAILS: "admin@example.invalid",
      CONSOLE_SESSION_SECRET: "isolated-console-signing-key-for-personal-reads",
    };
    const accounts = new AccountService(f.db, {
      origin,
      otpSecret: "fixture-task-accounts".repeat(3),
      passwords: {
        hash: async (value) => value,
        verify: async (value, hash) => value === hash,
      },
    });
    const register = (username: string) =>
      accounts.register(
        { username, password: "isolated-fixture-password" },
        new Request(origin + "/api/auth/register"),
        username,
      );
    const signed = await register("PersonalEvalAlice"),
      another = await register("PersonalEvalBobby");
    const owner = signed.profile.id,
      other = another.profile.id;
    const console = await createConsoleSession(
      new Request(origin + "/api/console-auth", { method: "POST" }),
      { key },
    );
    const tasks = new PersonalTaskStore(f.db);
    const seedTask = async (
      title: string,
      dueAt: string | null,
      notes = "",
      articleId?: string,
    ) =>
      tasks.create(owner, {
        key: crypto.randomUUID(),
        title,
        dueAt,
        notes,
        ...(articleId ? { source: { articleId } } : {}),
      });
    const sources = [
      [
        "eval-spring",
        "秋季职业发展宣讲",
        "活动时间：2026年11月17日19:00–21:00。\n报名时间：2026年11月16日08:00至2026年11月16日18:00。\n报名方式：点击原文链接报名。",
      ],
      ["eval-autumn", "校园招聘宣讲", "活动时间：2026年11月17日20:00–21:30。"],
      [
        "eval-contest",
        "2026年新生语音语调大赛",
        "2026年新生语音语调大赛包括英语朗读和即兴表达两个环节。\n活动时间：2026年11月19日13:50。",
      ],
      [
        "eval-white",
        "本科生转专业通知",
        "本科生转专业申请须知。\n所需材料：转专业申请表、成绩单。\n请按学院要求提交转专业申请材料。",
      ],
    ];
    for (const [id, title, body] of sources) {
      await f.article(id, "2026-11-15", title, body);
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          id,
          d.contentRevision,
          d.inputHash!,
          {
            title,
            body,
            publishedAt: "2026-11-15",
            originalUrl: `https://example.invalid/${id}`,
            sourceName: "隔离来源",
          },
          undefined,
          "licensed_full_text",
        ),
      );
      f.sqlite
        .prepare(
          "UPDATE document_article_analysis SET calendar_status='accepted' WHERE document_id=?",
        )
        .run(id);
      await new ArticleFavoriteStore(f.db).add(owner, id, {
        originSurface: "radar",
      });
    }
    await seedTask(
      "报名：秋季职业发展宣讲",
      "2026-11-15T18:00:00+08:00",
      "带学生证",
      "eval-spring",
    );
    await seedTask("确认讲座教室", "2026-11-16T11:00:00+08:00");
    await seedTask(
      "报名：校园招聘宣讲",
      "2026-11-16T15:00:00+08:00",
      "",
      "eval-autumn",
    );
    await seedTask(
      "参加：2026年新生语音语调大赛",
      "2026-11-19T13:50:00+08:00",
      "准备朗读稿",
      "eval-contest",
    );
    for (let index = 0; index < 4; index++)
      await seedTask(
        `未来事项 ${index + 1}`,
        `2026-11-2${index}T10:00:00+08:00`,
      );
    await seedTask("未设时间事项", null);
    const completed = (await tasks.list(owner, now)).find(
      (task) => task.title === "报名：校园招聘宣讲",
    )!;
    await tasks.change(owner, {
      id: completed.id,
      version: completed.version,
      action: "complete",
    });
    const cases = [
      [
        owner,
        "我今天有哪些待办，先做哪件？",
        ["建议先处理", "确认讲座教室", "⏱️逾期时间:11/16 11:00"],
      ],
      [
        owner,
        "我收藏的活动里，这周还有哪些能报名？",
        ["秋季职业发展宣讲", "报名截止", "18:00"],
      ],
      [
        owner,
        "我有哪些待办？",
        ["确认讲座教室", "2026年新生语音语调大赛", "未来事项 3"],
      ],
      [
        owner,
        "我待办的“2026年新生语音语调大赛”有什么内容？",
        [
          "参加：[2026年新生语音语调大赛](<https://example.invalid/eval-contest>)",
          "英语朗读",
          "📝备注：准备朗读稿",
        ],
      ],
      [
        owner,
        "我的已完成待办有哪些？",
        [
          "报名：[校园招聘宣讲](<https://example.invalid/eval-autumn>)",
          "已完成",
        ],
      ],
      [
        owner,
        "我的逾期待办和备注是什么？",
        [
          "报名：[秋季职业发展宣讲](<https://example.invalid/eval-spring>)  \n  ⏱️逾期时间:",
          "\n  📝备注：带学生证",
          "已逾期",
        ],
      ],
      [
        owner,
        "我待办的“校际辩论决赛”有什么内容？",
        ["没有找到与「校际辩论决赛」匹配的待办"],
      ],
      [other, "我有哪些待办？", ["没有待办"]],
    ] as const;
    for (const [index, [user, question, expected]] of cases.entries()) {
      const workflow = index === 0;
      const reply = await chatResponse(
        new Request(origin + "/api/agent/chat", {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: `campusos_session=${user === owner ? signed.token : another.token}${workflow ? "; " + console.cookie.split(";")[0] : ""}`,
            ...(workflow
              ? { "X-CampusOS-Workflow": "1", "X-Console-CSRF": console.csrf }
              : {}),
          },
          body: JSON.stringify({
            message: question,
            smartSearch: true,
            clientRequestId: crypto.randomUUID(),
          }),
        }),
      );
      expect(reply.status, question).toBe(200);
      const events = (await reply.text())
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)));
      const result = {
        text: events
          .filter((event) => event.type === "message.delta")
          .map((event) => event.payload.text)
          .join(""),
        cards: events.flatMap(
          (event) => event.payload.cards ?? [],
        ) as import("@/domain/agent/assistant-contracts").AssistantCard[],
      };
      expect(
        events.find((event) => event.type === "run.completed")?.payload.metrics,
      ).toMatchObject({ execution: "personal_read", requests: 0 });
      if (workflow) {
        const traces = events.flatMap((e) =>
          e.payload.workflow ? [e.payload.workflow] : [],
        );
        expect(traces).toContainEqual(
          expect.objectContaining({
            node: "personal",
            state: "success",
            data: { sources: 0 },
          }),
        );
        expect(JSON.stringify(traces)).not.toContain("确认讲座教室");
      }
      for (const phrase of expected)
        expect(result?.text, `${question}\n${result?.text}`).toContain(phrase);
      expect(result.text).not.toContain("打开我的收藏与待办");
      if (user === other) expect(result.text).not.toContain("确认讲座教室");
      if (index === 2) {
        expect(result.text.match(/^- /gm)).toHaveLength(5);
        expect(result.text.indexOf("确认讲座教室")).toBeLessThan(
          result.text.indexOf("2026年新生语音语调大赛"),
        );
        expect(result.text).not.toMatch(
          /未来事项 4|秋季职业发展宣讲|校园招聘宣讲|未设时间事项/,
        );
      }
      if ([3, 6].includes(index))
        expect(result.text).not.toMatch(/确认讲座教室|未来事项|校园招聘宣讲/);
    }
    await seedTask("参加：校园招聘宣讲", null, "", "eval-autumn");
    let conversationId: string | undefined;
    for (const question of [
      "我的待办事项中有什么冲突的活动吗？",
      "所有活动",
      "全部",
    ]) {
      const response = await chatResponse(
        new Request(origin + "/api/agent/chat", {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: `campusos_session=${signed.token}; ${console.cookie.split(";")[0]}`,
            "X-CampusOS-Workflow": "1",
            "X-Console-CSRF": console.csrf,
          },
          body: JSON.stringify({
            message: question,
            conversationId,
            smartSearch: true,
            clientRequestId: crypto.randomUUID(),
          }),
        }),
      );
      expect(response.status).toBe(200);
      const events = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)));
      const started = events.find((event) => event.payload.conversationId)
        ?.payload.conversationId;
      if (conversationId) expect(started).toBe(conversationId);
      conversationId = started;
      const text = events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.payload.text)
        .join("");
      expect(text).toContain("重叠 60 分钟");
      expect(text).toContain("以下事项尚无法判断");
      expect(text).not.toContain("请告诉我要比较的两场活动名称");
      const completed = events.find((event) => event.type === "run.completed");
      expect(completed.payload.metrics).toMatchObject({
        dataSource: "personal_todos",
        readStatus: "completed",
        conflictCount: 1,
        taskStatus: "partial",
        requests: 0,
        activeTask: { intent: "detect_schedule_conflicts", scope: "all" },
      });
      const records = events.flatMap((event) =>
        event.payload.workflow ? [event.payload.workflow] : [],
      );
      expect(
        records.some((record) =>
          ["rag", "events", "external", "model"].includes(record.node),
        ),
      ).toBe(false);
      expect(
        records.find(
          (record) => record.node === "personal" && record.state === "success",
        ).data.totalTasks,
      ).toBeGreaterThan(1);
    }
  } finally {
    vi.useRealTimers();
    f.close();
  }
});

it("allows more than ten task writes without a task-specific rate limit", async () => {
  const f = accountFixture();
  try {
    const user = await f.register("TaskWriteFixture");
    const api = createAccountApi({
      store: f.store,
      enabled: true,
      defer: () => {},
    });
    for (let n = 0; n < 12; n++) {
      const response = await api(
        new Request("https://campus.example/api/me/tasks", {
          method: "POST",
          headers: {
            Origin: "https://campus.example",
            "Content-Type": "application/json",
            Cookie: `campusos_session=${user.token}`,
          },
          body: JSON.stringify({
            title: `待办 ${n}`,
            key: crypto.randomUUID(),
            notes: "",
            dueAt: null,
          }),
        }),
      );
      expect(response.status).toBe(200);
    }
    expect(
      await new PersonalTaskStore(f.db).list(user.profile.id),
    ).toHaveLength(12);
  } finally {
    f.close();
  }
});

it("finds a named saved article with no indexed excerpt without exposing another user's favorites", async () => {
  const f = await dateGateFixture();
  try {
    f.sqlite.exec(
      "INSERT INTO users(id,display_name) VALUES('task-fixture-a','Alice'),('task-fixture-b','Bobby')",
    );
    await new ArticleFavoriteStore(f.db).add("task-fixture-a", "spring", {
      originSurface: "radar",
    });
    const question = "我收藏的 spring 这篇有些什么内容？";
    expect(
      (await personalRead(f.db, "task-fixture-a", question))?.cards[0],
    ).toMatchObject({ documentId: "spring", evidenceType: "metadata" });
    expect(
      (await personalRead(f.db, "task-fixture-b", question))?.cards,
    ).toEqual([]);
  } finally {
    f.close();
  }
});

it("owns, edits, completes and deletes tasks independently across accounts", async () => {
  const f = accountFixture();
  try {
    const a = (await f.register("TasksAlice")).profile.id;
    const b = (await f.register("TasksBobby")).profile.id;
    const tasks = new PersonalTaskStore(f.db);
    const draft = {
      key: crypto.randomUUID(),
      title: "报名隔离讲座",
      dueAt: "2026-11-17T12:00:00+08:00",
      notes: "学生证",
    };
    await tasks.create(a, draft);
    await tasks.create(a, draft);
    const rows = await tasks.list(a, Date.parse("2026-11-16T01:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(
      (await tasks.list(a, Date.parse("2026-11-18T01:00:00Z")))[0].status,
    ).toBe("overdue");
    expect(await tasks.list(b)).toEqual([]);
    expect((await personalRead(f.db, a, "我的待办", Date.parse("2026-11-16T09:00:00+08:00")))?.text).toContain(
      draft.title,
    );
    expect((await personalRead(f.db, b, "我的待办", Date.parse("2026-11-16T09:00:00+08:00")))?.text).not.toContain(
      draft.title,
    );
    expect((await personalRead(f.db, undefined, "我的待办"))?.text).toContain(
      "登录",
    );
    const { id, version } = rows[0];
    await expect(
      tasks.change(b, { id, version, action: "delete" }),
    ).rejects.toThrow();
    await tasks.change(a, {
      id,
      version,
      action: "edit",
      title: "参加隔离讲座",
      dueAt: null,
      notes: "",
    });
    await expect(
      tasks.change(a, { id, version, action: "complete" }),
    ).rejects.toThrow();
    await tasks.change(a, { id, version: version + 1, action: "complete" });
    expect((await tasks.list(a))[0]).toMatchObject({
      title: "参加隔离讲座",
      status: "completed",
    });
    await tasks.change(a, { id, version: version + 2, action: "delete" });
    expect(await tasks.list(a)).toEqual([]);
  } finally {
    f.close();
  }
});
