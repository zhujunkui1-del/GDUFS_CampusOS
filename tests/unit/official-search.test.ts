import { expect, it, vi } from "vitest";
import {
  searchOfficialUniversity,
  universityKeywords,
  readOfficialArticle,
} from "@/lib/server/external-search/official-search";
import { searchWeb } from "@/lib/server/external-search/providers";
import { externalPolicy } from "@/lib/server/external-search/policy";
const fixture = () =>
  vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "https://mcp.exa.ai/mcp")
      return new Response("", { status: 503 });
    if (url === "https://www.gdufs.edu.cn/")
      return new Response('var appOwner="42";var urlPrefix="/aop_component/";');
    if (url.endsWith("/queryPage")) {
      expect(init?.headers).toMatchObject({
        Authorization: "tourist",
        owner: "42",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        searchScope: "3",
        page: { current: 0, size: 10 },
      });
      return Response.json({
        code: "0000",
        data: {
          page: {
            records: [
              {
                title: "Other media",
                url: "https://foreign.test/info/1/2.htm",
              },
              {
                title: "Bad host",
                url: "https://www.gdufs.edu.cn.evil.test/info/1/2.htm",
              },
              {
                title: "聘任<span>张甲</span>",
                intro: "张甲受聘为工作室首席专家",
                url: "//www.gdufs.edu.cn/info/1/2.htm",
                createDate: "1999-01-01",
              },
            ],
          },
        },
      });
    }
    expect(url).toBe("https://www.gdufs.edu.cn/info/1/2.htm");
    expect(init?.headers).toBeUndefined();
    expect(init?.redirect).toBe("manual");
    return new Response(
      '<meta name="PubDate" content="2026-10-01"><div class="v_news_content">张甲受聘为工作室首席专家。<script>forged body</script></div>',
    );
  });
it("reads public static faculty directories as well as numbered news pages", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response('<div class="v_news_content">张甲是实验室首席专家。</div>'),
    );
  const result = await readOfficialArticle(
    "https://bcdlab.gdufs.edu.cn/ry/js.htm",
    new AbortController().signal,
    transport,
  );
  expect(result.body).toContain("首席专家");
});
it("uses public full-text search after Internet-provider failure, with labelled real page proof", async () => {
  const transport = fixture();
  const result = await searchWeb(
    "广外 张甲 首席专家",
    externalPolicy("张甲是广外的首席专家吗"),
    3,
    undefined,
    transport,
  );
  expect(result.provider).toBe("gdufs_official_site");
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    title: "聘任张甲",
    evidenceKind: "page_excerpt",
    authority: "official",
    canConfirmAdministrativeFacts: true,
    publishedAt: "2026-10-01",
  });
  expect(result.items[0].snippet).not.toContain("forged");
  expect(transport).toHaveBeenCalledTimes(4);
});
it("does not reuse official fallback for experience queries or fabricate evidence from challenges", async () => {
  const transport = vi.fn<typeof fetch>(
    async () => new Response("", { status: 503 }),
  );
  expect(
    (
      await searchWeb(
        "食堂好吃",
        externalPolicy("广外食堂好吃"),
        3,
        undefined,
        transport,
      )
    ).status,
  ).toBe("unavailable");
  expect(transport).toHaveBeenCalledTimes(1);
  const blocked = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('var appOwner="42";var urlPrefix="/aop_component/";'),
    )
    .mockResolvedValueOnce(Response.json({ code: "471", message: "verify" }));
  await expect(
    searchOfficialUniversity(
      "张甲 首席专家",
      3,
      new AbortController().signal,
      blocked,
    ),
  ).rejects.toThrow("OFFICIAL_RESPONSE");
  expect(blocked).toHaveBeenCalledTimes(2);
});
it("uses keyword terms without treating campus search scope as an appointment fact", () => {
  expect(universityKeywords("戴建业是广外的首席专家吗")).toBe(
    "戴建业 首席专家",
  );
  expect(universityKeywords("广外南校的首席专家有哪些人")).toBe("首席专家");
});
