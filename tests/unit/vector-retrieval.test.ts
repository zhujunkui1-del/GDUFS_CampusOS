import { describe, expect, it } from "vitest";
import {
  backfillFlag,
  createSemanticRetriever,
  embedTexts,
  vectorFlag,
  vectorId,
  type AiBinding,
} from "@/lib/server/retrieval/vector";

const vector = () => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const ai: AiBinding = {
  async run(_model, input) {
    return { data: input.text.map(() => vector()) };
  },
};

describe("semantic recall lane", () => {
  it("embeds each text and rejects vectors with the wrong dimensions", async () => {
    await expect(embedTexts(ai, ["校园卡"])).resolves.toHaveLength(1);
    const broken: AiBinding = {
      async run() {
        return { data: [[0.1, 0.2]] };
      },
    };
    await expect(embedTexts(broken, ["校园卡"])).rejects.toThrow(
      "嵌入返回维度不符合预期。",
    );
  });

  it("returns only matches above the semantic floor, without metadata", async () => {
    const seen: unknown[] = [];
    const semantic = createSemanticRetriever({
      ai,
      index: {
        async upsert() {
          return {};
        },
        async query(_values, options) {
          seen.push(options);
          return {
            matches: [
              {
                id: "h1",
                score: 0.72,
                metadata: { chunkId: "high", indexVersion: "campus-fts-v1" },
              },
              {
                id: "h2",
                score: 0.65,
                metadata: { chunkId: "stale", indexVersion: "old" },
              },
              {
                id: "h3",
                score: 0.19,
                metadata: { chunkId: "low", indexVersion: "campus-fts-v1" },
              },
            ],
          };
        },
      },
    });
    await expect(semantic!.search("宿舍门禁", 8)).resolves.toEqual([
      { id: "high", score: 0.72 },
    ]);
    expect(seen).toEqual([
      { topK: 8, returnMetadata: "all", returnValues: false },
    ]);
    expect(await vectorId("content-68c53f08-f340-475b-95bc-f6c651e51274")).toHaveLength(
      32,
    );
  });

  it("degrades to no semantic lane without both bindings", () => {
    expect(createSemanticRetriever(null)).toBeUndefined();
  });

  it("gates the lane and backfill on explicit preview flags", () => {
    expect(vectorFlag({ HYBRID_RETRIEVAL: "true" })).toBe(true);
    expect(vectorFlag({ HYBRID_RETRIEVAL: "false" })).toBe(false);
    expect(vectorFlag(undefined)).toBe(false);
    expect(backfillFlag({ VECTOR_BACKFILL: "true" })).toBe(true);
  });
});

describe("retrieval metrics contract", () => {
  it("accepts keyword, vector and structural lanes together", async () => {
    const { RetrievalMetricsSchema } = await import(
      "@/domain/retrieval/contracts"
    );
    const parsed = RetrievalMetricsSchema.safeParse({
      rowsRead: 0,
      rowsWritten: 0,
      queries: 3,
      durationMs: 1,
      candidateChunks: 3,
      usageAvailable: false,
      recallLanes: [
        { name: "fts", limit: 60, candidates: 2 },
        { name: "vector", limit: 60, candidates: 1 },
        { name: "semantic", limit: 24, candidates: 1 },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
