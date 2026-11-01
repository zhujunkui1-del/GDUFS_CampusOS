import { it, expect } from "vitest";
import { assertAccountOrigin } from "@/lib/server/account/security";
const primary = "https://campusos-preview.zhujunkui1.workers.dev",
  publicSite = "https://gdufs.ccwu.cc",
  allowed = [primary, publicSite];
const request = (url: string, origin: string, site = "same-origin") =>
  new Request(url + "/api/auth/login", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Sec-Fetch-Site": site,
    },
  });
it("accepts both explicitly configured public entry points", () => {
  for (const origin of allowed)
    expect(() =>
      assertAccountOrigin(request(origin, origin), allowed),
    ).not.toThrow();
});
it("accepts the configured public domain forwarded to the preview worker", () => {
  expect(() =>
    assertAccountOrigin(request(primary, publicSite), allowed),
  ).not.toThrow();
});
it("rejects unconfigured origins, hosts and cross-site browser requests", () => {
  for (const r of [
    request(primary, "https://evil.example"),
    request("https://evil.example", publicSite),
    request(primary, publicSite, "cross-site"),
  ])
    expect(() => assertAccountOrigin(r, allowed)).toThrow("请求来源");
});
it("keeps the single-origin contract and rejects null origins", () => {
  expect(() =>
    assertAccountOrigin(request(primary, primary), primary),
  ).not.toThrow();
  expect(() =>
    assertAccountOrigin(request(primary, "null"), allowed),
  ).toThrow();
});
