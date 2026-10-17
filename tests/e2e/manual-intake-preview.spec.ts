import { previewConsoleCredential } from "./helpers/console-credential";
import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";

test.skip(
  process.env.MANUAL_INTAKE_PREVIEW_E2E !== "1",
  "Explicit read-only preview acceptance; no article approval or publication",
);
test.use({ trace: "off" });
test("preview review controls explain missing notes without submitting content decisions", async ({
  page,
  request: anonymous,
}, info) => {
  const base = "https://campusos-preview.zhujunkui1.workers.dev";
  expect(process.env.E2E_BASE_URL).toBe(base);
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  const loginInput = previewConsoleCredential(values);
  let plaintextPosted = false,
    presentedLength = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/console-auth"
    ) {
      const body = r.postDataJSON();
      plaintextPosted = body.key === loginInput;
      presentedLength = typeof body.key === "string" ? body.key.length : 0;
    }
  });
  await page.goto("/admin");
  await page.getByLabel("管理员访问密钥", { exact: true }).fill(loginInput);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "总览", exact: true }),
  ).toBeVisible();
  if (values.CONSOLE_AUTH_MODE === "admin_password") {
    expect(plaintextPosted).toBe(false);
    expect(presentedLength).toBe(64);
  }
  // Playwright's raw transport errors can include Cookie headers. Keep those
  // exceptions out of reports and revoke even if the first auth read fails.
  const safe = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch {
      throw new Error("云端管理测试连接失败，请检查代理后重试。");
    }
  };
  const get = (path: string) => safe(() => page.request.get(path));
  let auth: { csrf: string } | undefined;
  try {
    auth = (await (await get("/api/console-auth")).json()).data;
    const list = (await (await get("/api/admin/content")).json()).data.items;
    const selected = list.find(
      (d: { sourceId: string }) => d.sourceId === "GDUFS-SRC-0008",
    );
    expect(selected).toBeTruthy();
    const doc = (await (await get(`/api/admin/content/${selected.id}`)).json())
      .data;
    expect(doc.publishedAt).toBe("2026-06-30");
    expect(doc.rightsScope).toBe("metadata_only");
    await page.goto(`/admin/content?record=${selected.id}`);
    await expect(
      page.getByRole("heading", { name: doc.title, exact: true }),
    ).toBeVisible();
    let writes = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/admin\/content\//.test(r.url()))
        writes++;
    });
    for (const name of ["批准", "退回", "拒绝", "发布", "撤回"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator("#review-note-error")).toHaveText(
        "请先填写至少两个字的审核说明。",
      );
      await expect(page.getByLabel("审核说明", { exact: true })).toBeFocused();
    }
    expect(writes).toBe(0);
    const dir = "docs/verification/s3-b-final/browser";
    mkdirSync(dir, { recursive: true });
    await page.screenshot({
      path: `${dir}/cloud-${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-review-note.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${dir}/cloud-${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-review-controls.png`,
    });
    await page.goto("/admin/content?record=new");
    await expect(
      page.getByRole("heading", { name: "人工导入", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "信息源", exact: true })
      .selectOption(doc.sourceId);
    await expect(
      page.getByRole("combobox", { name: "正文状态", exact: true }),
    ).toHaveValue("not_provided");
    await page.screenshot({
      path: `${dir}/cloud-${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-manual-import.png`,
      fullPage: true,
    });
    expect((await anonymous.get("/api/admin/content")).status()).toBe(401);
    const reply = await anonymous.get(`/api/public/content?id=${selected.id}`);
    expect([200, 404]).toContain(reply.status());
    expect(reply.headers()["cache-control"]).toContain("no-store");
    if (reply.status() === 200) {
      expect((await reply.json()).data.items[0]).not.toHaveProperty("body");
    } else expect((await reply.json()).error.code).toBe("NOT_FOUND");
    const missingCsrf = await safe(() =>
      page.request.post("/api/admin/content/import", {
        data: {},
      }),
    );
    expect(missingCsrf.status()).toBe(403);
  } finally {
    if (auth) {
      const csrf = auth.csrf;
      await safe(() =>
        page.request.delete("/api/console-auth", {
          headers: { Origin: base, "X-Console-CSRF": csrf },
        }),
      );
    } else
      await safe(() =>
        page.getByRole("button", { name: "安全退出", exact: true }).click(),
      );
  }
});
