import { afterEach, expect, it, vi } from "vitest";
import { readModelAsset } from "@/features/campus-map/layers/model-asset-cache";
import { revalidateDocument } from "@/lib/server/document-cache";
import { modelBudget } from "@/features/campus-map/data/model-budget";

afterEach(() => vi.unstubAllGlobals());
async function asset(name: string, fill = 32, size = 24) {
  const bytes = new Uint8Array(size).fill(fill),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, size, true);
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  return { bytes, meta: { url: "/models/" + name, sha256, bytes: size } };
}
it("shares one integrity-checked asset request across concurrent consumers", async () => {
  const a = await asset("concurrent"),
    fetch = vi.fn(async () => new Response(a.bytes));
  vi.stubGlobal("fetch", fetch);
  const [x, y] = await Promise.all([
    readModelAsset(a.meta),
    readModelAsset(a.meta),
  ]);
  expect(x).toBe(y);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reports an unavailable secure-context digest before fetching model bytes", async () => {
  const a = await asset("missing-secure-digest");
  const fetch = vi.fn(async () => new Response(a.bytes));
  vi.stubGlobal("crypto", {});
  vi.stubGlobal("fetch", fetch);
  await expect(readModelAsset(a.meta)).rejects.toThrow("model-secure-context");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects HTML responses and permits a later explicit retry", async () => {
  const a = await asset("retry"),
    fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      )
      .mockResolvedValueOnce(new Response(a.bytes));
  vi.stubGlobal("fetch", fetch);
  await expect(readModelAsset(a.meta)).rejects.toThrow("model-fetch");
  await expect(readModelAsset(a.meta)).resolves.toHaveProperty(
    "byteLength",
    a.meta.bytes,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects changed model bytes even if size and GLB header remain valid", async () => {
  const a = await asset("integrity"),
    b = await asset("tampered", 33);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(b.bytes)),
  );
  await expect(readModelAsset(a.meta)).rejects.toThrow("model-integrity");
});
it("rejects truncated or non-GLB payloads", async () => {
  const a = await asset("header");
  a.bytes[0] = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(a.bytes)),
  );
  await expect(readModelAsset(a.meta)).rejects.toThrow("model-format");
});
it("bounds retained raw model bytes and refetches an evicted entry", async () => {
  const all = await Promise.all(
    [0, 1, 2].map((i) => asset("budget-" + i, 32 + i, 3 * 1024 * 1024)),
  );
  const fetch = vi.fn(
    async (url: string) =>
      new Response(all.find((a) => a.meta.url === url)!.bytes),
  );
  vi.stubGlobal("fetch", fetch);
  for (const a of all) await readModelAsset(a.meta);
  await readModelAsset(all[0].meta);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("revalidates public HTML while retaining immutable asset and private API policies", () => {
  const html = revalidateDocument(
    new Response("page", {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "s-maxage=31536000",
      },
    }),
  );
  expect(html.headers.get("Cache-Control")).toContain("must-revalidate");
  expect(html.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
  for (const [type, cache] of [
    ["application/json", "no-store"],
    ["model/gltf-binary", "public,max-age=31536000,immutable"],
    ["text/html", "private,no-store"],
  ]) {
    const response = new Response("data", {
      headers: { "Content-Type": type, "Cache-Control": cache },
    });
    expect(revalidateDocument(response)).toBe(response);
  }
});
it("separates conservative resource budgets from render-mode eligibility", () => {
  expect(modelBudget("conservative").concurrentLoads).toBeGreaterThan(0);
  expect(modelBudget("conservative").concurrentLoads).toBeLessThan(
    modelBudget("standard").concurrentLoads,
  );
});
