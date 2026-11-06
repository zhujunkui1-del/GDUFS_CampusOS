import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "comment-json";
import { z } from "zod";
import { assertPreviewTarget } from "../../scripts/preview-config.mjs";
const config = () =>
  z
    .object({
      env: z
        .object({ preview: z.record(z.string(), z.unknown()) })
        .passthrough(),
      d1_databases: z.array(
        z.object({ database_id: z.string() }).passthrough(),
      ),
    })
    .passthrough()
    .parse(parse(readFileSync("wrangler.jsonc", "utf8")));
const account = "a".repeat(32);
it("targets exactly the dedicated preview with no production domain", () => {
  expect(assertPreviewTarget(config(), account)).toMatchObject({
    worker: "campusos-preview",
    database: "campusos-preview",
    environment: "preview",
  });
});
it("allows only the exact campusos.zhiyuapp.site Console API proxy routes", () => {
  const c = config();
  expect(assertPreviewTarget(c, account).worker).toBe("campusos-preview");
  c.env.preview.routes = [
    { pattern: "campusos.zhiyuapp.site/api/console-*", zone_name: "zhiyuapp.site" },
    { pattern: "campusos.zhiyuapp.site/api/admin*", zone_name: "zhiyuapp.site" },
  ];
  expect(assertPreviewTarget(c, account).worker).toBe("campusos-preview");
  const broader = config();
  broader.env.preview.routes = [
    { pattern: "campusos.zhiyuapp.site/*", zone_name: "zhiyuapp.site" },
  ];
  expect(() => assertPreviewTarget(broader, account)).toThrow();
});
it.each(["name", "main", "routes", "workers_dev", "preview_urls"])(
  "rejects unsafe preview %s",
  (field) => {
    const c = config();
    c.env.preview[field] =
      field === "routes"
        ? [{ pattern: "gdufs.ccwu.cc" }]
        : field === "name"
          ? "campusos-preview-preview"
          : undefined;
    expect(() => assertPreviewTarget(c, account)).toThrow();
  },
);
it("rejects shared and placeholder databases", () => {
  const c = config();
  c.env.preview.d1_databases = [
    {
      binding: "DB",
      database_name: "campusos-preview",
      database_id: c.d1_databases[0].database_id,
    },
  ];
  expect(() => assertPreviewTarget(c, account)).toThrow();
});
it("rejects another Worker's service binding and missing account", () => {
  const c = config();
  c.env.preview.services = [
    { binding: "WORKER_SELF_REFERENCE", service: "other-project" },
  ];
  expect(() => assertPreviewTarget(c, account)).toThrow();
  expect(() => assertPreviewTarget(config(), undefined)).toThrow();
});
it("only allows the dedicated Preview cloud search service in addition to its self reference", () => {
  const c = config();
  c.env.preview.services = [
    { binding: "WORKER_SELF_REFERENCE", service: "campusos-preview" },
    { binding: "CLOUD_SEARCH", service: "campusos-preview-cloud-search" },
  ];
  expect(assertPreviewTarget(c, account).worker).toBe("campusos-preview");
  c.env.preview.services = [
    { binding: "WORKER_SELF_REFERENCE", service: "campusos-preview" },
    { binding: "CLOUD_SEARCH", service: "campusos-cloud-search" },
  ];
  expect(() => assertPreviewTarget(c, account)).toThrow();
});
