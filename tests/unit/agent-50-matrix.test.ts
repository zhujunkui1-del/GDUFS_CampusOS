import { DeepseekModelClient } from "@/lib/server/models/deepseek";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import type { ModelClient, ModelSnapshot } from "@/domain/models/contracts";
import { createMatrixTransport } from "../fixtures/agent-matrix-budget";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { it, vi } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { AssistantStore } from "@/lib/server/assistant/store";
import { chatResponse } from "@/lib/server/assistant/chat";

const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  modelRequired: false,
  model: undefined as
    { client: ModelClient; snapshot: ModelSnapshot } | undefined,
}));
vi.mock(import("@/lib/server/console/auth"), async (original) => ({
  ...(await original()),
  requireConsole: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: runtime.env }),
}));
vi.mock("@/lib/server/models/runtime", () => ({
  platformModelRuntime: async () => ({
    resolve: async () => {
      runtime.modelRequired = true;
      if (runtime.model) return runtime.model;
      throw new Error("MODEL_NOT_AUTHORIZED_FOR_OFFLINE_MATRIX");
    },
  }),
}));

const suite = JSON.parse(
  readFileSync("tests/fixtures/campusos-agent-50-cases.json", "utf8").replace(
    /^\uFEFF/,
    "",
  ),
);
const stamp = new Date(
  process.env.AGENT_MATRIX_TIME || "2026-11-19T04:06:00+08:00",
);
const origin = "https://fixture.invalid";
it(
  "records all 50 prompts against the real chat handler and isolated SQLite",
  async () => {
    const live = process.env.AGENT_MATRIX_LIVE === "1";
    const networkFetch = globalThis.fetch.bind(globalThis);
    const budget = live
      ? createMatrixTransport(
          Number(process.env.AGENT_MATRIX_TOKEN_LIMIT),
          networkFetch,
        )
      : undefined;
    if (budget) {
      const provider = process.env.AGENT_MATRIX_PROVIDER;
      const model = process.env.AGENT_MATRIX_MODEL;
      const key = process.env.AGENT_MATRIX_MODEL_KEY;
      const endpoint = process.env.AGENT_MATRIX_MODEL_BASE;
      if (
        !process.env.AGENT_MATRIX_IDS ||
        !key ||
        !model ||
        !endpoint ||
        (provider !== "deepseek" &&
          provider !== "stepfun" &&
          provider !== "gdufs")
      )
        throw new Error(
          "Live matrix requires explicit case IDs, provider, model, endpoint and test key.",
        );
      runtime.model = {
        client: new DeepseekModelClient(
          model,
          key,
          endpoint,
          budget.transport,
          15000,
          provider,
          1024,
          false,
        ),
        snapshot: {
          source: "platform",
          provider,
          model,
          policyVersion: "isolated-budgeted-matrix",
          testedAt: stamp.toISOString(),
          capabilities: {
            toolCalling: true,
            jsonObject: true,
            strictJsonSchema: false,
          },
        },
      };
    }
    vi.setSystemTime(stamp);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new Error("Network disabled for offline matrix")),
    );
    type Turn = {
      message: string;
      modelRequired: boolean;
      latencyMs: number;
      status?: number;
      answer?: string;
      actionClaim?: { type: string }[];
      tools?: unknown[];
      metrics?: unknown;
      error?: unknown;
      artifacts?: {
        cards?: { calendarLinks?: unknown[] }[];
        routes?: unknown[];
      }[];
    };
    const rows: {
      id: string;
      priority: string;
      repeat: number;
      expected: string;
      mapContext?: unknown;
      turns: Turn[];
      outcome: string;
    }[] = [];
    const f = await dateGateFixture();
    try {
      await f.article(
        "matrix-future",
        "2026-11-17",
        "未来人工智能讲座通知",
        "<p>讲座时间：2026年11月22日14:30</p><p>讲座地点：白云山校区图书馆</p>",
      );
      await f.article(
        "matrix-past",
        "2026-11-18",
        "已结束的讲座报道",
        "<p>讲座时间：2026年11月16日14:30</p><p>地点：大学城校区图书馆</p>",
      );
      const imported: string[] = [];
      if (process.env.AGENT_MATRIX_CORPUS) {
        const corpus = JSON.parse(
          readFileSync(process.env.AGENT_MATRIX_CORPUS, "utf8"),
        );
        const oldest = corpus
          .map((record: { publishedAt: string }) =>
            record.publishedAt.slice(0, 10),
          )
          .sort()[0];
        if (oldest && /^\d{4}-\d{2}-\d{2}$/.test(oldest))
          f.sqlite
            .prepare(
              "UPDATE console_engine_settings SET earliest_import_day = min(earliest_import_day, ?)",
            )
            .run(oldest);
        for (const record of corpus) {
          await f.article(
            record.id,
            record.publishedAt,
            record.title,
            record.body,
            record.url,
          );
          imported.push(record.id);
        }
      }
      for (const id of ["matrix-future", "matrix-past", ...imported]) {
        const d = f.sqlite
          .prepare(
            "SELECT id,title,body,published_at,source_id,url,input_hash,content_revision FROM knowledge_documents WHERE id=?",
          )
          .get(id)!;
        await f.db.batch(
          await analysisStatements(
            f.db,
            id,
            Number(d.content_revision),
            String(d.input_hash),
            {
              documentId: id,
              title: String(d.title),
              body: String(d.body),
              bodyFormat: "reading_html",
              bodyStatus: "complete",
              sourceId: String(d.source_id),
              originalUrl: String(d.url),
              publishedAt: String(d.published_at),
            },
          ),
        );
      }
      for (const id of imported) await ensureRetrievalIndex(f.db, id);
      runtime.env = {
        DB: f.db,
        APP_ENV: "preview",
        AGENT_VALIDATION_UNLIMITED: "true",
        AGENT_SIGNING_SECRET: "isolated-matrix-signing-key-not-production",
      };
      const store = new AssistantStore(f.db, undefined, true);
      const contextOverride = process.env.AGENT_MATRIX_CONTEXT
        ? JSON.parse(process.env.AGENT_MATRIX_CONTEXT)
        : undefined;
      const gps = process.env.AGENT_MATRIX_GPS
        ? JSON.parse(process.env.AGENT_MATRIX_GPS)
        : undefined;
      for (const c of suite.cases.filter(
        (c: { id: string }) =>
          !process.env.AGENT_MATRIX_IDS ||
          process.env.AGENT_MATRIX_IDS.split(",").includes(c.id),
      )) {
        for (let repeat = 0; repeat < c.repeats; repeat++) {
          const identity = await store.identity(new Request(origin));
          let conversationId: string | undefined;
          const turns: Turn[] = [];
          const mapContext =
            contextOverride ??
            (c.id === "T19"
              ? { campus: "baiyun", selectedPlaceId: "osm-way-962936641" }
              : c.id === "T20"
                ? { campus: "university", selectedPlaceId: "osm-way-312536955" }
                : undefined);
          const messages = c.question.split(/\s*→\s*/);
          if (
            process.env.AGENT_MATRIX_FOLLOWUP &&
            process.env.AGENT_MATRIX_IDS === c.id
          )
            messages.push(process.env.AGENT_MATRIX_FOLLOWUP);
          for (const message of messages) {
            runtime.modelRequired = false;
            const start = performance.now();
            try {
              const locationGrant = gps
                ? {
                    challenge: await store.locationChallenge(identity),
                    coordinate: gps,
                    accuracyMeters: 8,
                    capturedAt: Date.now(),
                  }
                : undefined;
              const response = await chatResponse(
                new Request(origin + "/api/agent/chat", {
                  method: "POST",
                  headers: {
                    Origin: origin,
                    "Content-Type": "application/json",
                    Cookie: identity.cookie,
                    "X-CampusOS-Conversation-Protocol": "2",
                    ...(process.env.AGENT_MATRIX_WORKFLOW
                      ? { "X-CampusOS-Workflow": "1" }
                      : {}),
                  },
                  body: JSON.stringify({
                    message,
                    mapContext,
                    conversationId,
                    clientRequestId: crypto.randomUUID(),
                    smartSearch: process.env.AGENT_MATRIX_SMART_SEARCH === "1",
                    locationGrant,
                  }),
                }),
              );
              const raw = await response.text();
              const events = raw
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => JSON.parse(l.slice(5)));
              for (const e of events)
                conversationId = e.payload.conversationId || conversationId;
              const packet = events.find((e) => e.payload.packet)?.payload
                .packet;
              const claimed = packet
                ? await store.claim(identity, packet.id, conversationId)
                : undefined;
              const answer = events
                .filter((e) => e.type === "message.delta")
                .map((e) => e.payload.text)
                .join("");
              turns.push({
                message,
                actionClaim: claimed?.actions,
                status: response.status,
                answer,
                modelRequired: runtime.modelRequired,
                latencyMs: Math.round(performance.now() - start),
                tools: events
                  .filter(
                    (e) => e.type.startsWith("tool.") || e.payload.workflow,
                  )
                  .map((e) => e.payload),
                artifacts: events
                  .filter((e) => e.type === "artifact.ready")
                  .map((e) => e.payload),
                metrics: events.find((e) => e.type === "run.completed")?.payload
                  .metrics,
                error: response.ok
                  ? events.find((e) => e.type === "run.failed")?.payload.error
                  : raw.slice(0, 400),
              });
            } catch (error) {
              turns.push({
                message,
                modelRequired: runtime.modelRequired,
                latencyMs: Math.round(performance.now() - start),
                error: String(error),
              });
            }
          }
          const last = turns.at(-1)!;
          rows.push({
            id: c.id,
            repeat: repeat + 1,
            priority: c.priority,
            expected: c.expected,
            mapContext,
            turns,
            outcome:
              !live && last.modelRequired
                ? "BLOCKED"
                : last.answer
                  ? "PARTIAL"
                  : "FAIL",
          });
        }
      }
    } finally {
      f.close();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
    mkdirSync("output", { recursive: true });
    writeFileSync(
      "output/agent-50-" +
        (process.env.AGENT_MATRIX_PHASE || "baseline") +
        ".json",
      JSON.stringify(
        {
          clock: stamp.toISOString(),
          environment: live
            ? "isolated SQLite; real provider with capped test transport"
            : "isolated SQLite; real chat handler, model and network disabled",
          budget: budget?.usage(),
          rows,
        },
        null,
        2,
      ),
    );
    if (process.env.AGENT_MATRIX_PHASE === "after") {
      const turn = (id: string) => rows.find((r) => r.id === id)?.turns.at(-1);
      for (const id of ["T02", "T03", "T04", "T05", "T10"]) {
        if (!turn(id)) continue;
        if (!process.env.AGENT_MATRIX_WORKFLOW)
          expect(
            turn(id)?.actionClaim?.some((a) => a.type === "SHOW_ROUTE"),
            id,
          ).toBe(true);
        else
          expect(
            turn(id)?.artifacts?.some((a) => a.routes?.length),
            id,
          ).toBe(true);
      }
      for (const id of ["T21", "T22", "T50"]) {
        if (!turn(id)) continue;
        expect(turn(id)?.answer, id).toContain("未来人工智能讲座通知");
        expect(turn(id)?.answer, id).not.toContain("已结束的讲座报道");
        expect(
          turn(id)?.artifacts?.some((a) =>
            a.cards?.some(
              (c: { calendarLinks?: unknown[] }) => c.calendarLinks?.length,
            ),
          ),
          id,
        ).toBe(true);
      }
      if (turn("T07")) expect(turn("T07")?.answer).toContain("不同校区");
    }
    if (process.env.AGENT_MATRIX_PHASE === "continued") {
      const turn = (id: string) =>
        rows.find((row) => row.id === id)?.turns.at(-1);
      expect(turn("T30")?.answer).toContain("未来人工智能讲座通知");
      expect(turn("T30")?.answer).not.toContain("已结束的讲座报道");
      expect(
        turn("T30")?.artifacts?.some((a) =>
          a.cards?.some((c) => c.calendarLinks?.length),
        ),
      ).toBe(true);
      for (const id of ["T48", "T49"]) {
        expect(turn(id)?.modelRequired).toBe(false);
        expect(turn(id)?.actionClaim).toBeUndefined();
        expect(turn(id)?.tools).toEqual([]);
      }
      expect(turn("T41")?.answer).toContain("7 层");
      expect(turn("T41")?.modelRequired).toBe(false);
      expect(turn("T48")?.answer).toContain("无法代你");
      expect(turn("T49")?.answer).toContain("不能把虚构");
    }
    console.log("Recorded", rows.length, "runs");
  },
  process.env.AGENT_MATRIX_LIVE === "1" ? 600000 : 120000,
);
