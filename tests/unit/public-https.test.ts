import { expect, it } from "vitest";
import { publicHttpsRedirect } from "@/lib/server/public-https";

it("upgrades all public site navigation to a secure context without changing the chosen place", () => {
  for (const host of [
    "gdufs.zhiyuapp.site",
    "gdufs.ccwu.cc",
    "campusos.zhiyuapp.site",
  ]) {
    const response = publicHttpsRedirect(
      new Request(`http://${host}/map?place=osm-way-312536955`),
    );
    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(
      `https://${host}/map?place=osm-way-312536955`,
    );
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  }
});
it("does not redirect HTTPS pages, development hosts or credential API requests", () => {
  for (const request of [
    new Request("https://gdufs.zhiyuapp.site/map"),
    new Request("http://localhost:3026/map"),
    new Request("http://untrusted.example/map"),
    new Request("http://gdufs.zhiyuapp.site/api/auth/login", {
      method: "POST",
    }),
    new Request("http://gdufs.zhiyuapp.site/api/me/model-configs"),
  ])
    expect(publicHttpsRedirect(request)).toBeUndefined();
});
