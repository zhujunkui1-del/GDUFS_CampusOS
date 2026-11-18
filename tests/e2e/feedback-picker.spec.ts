import { expect, test } from "@playwright/test";

test("opening and cancelling the native image chooser preserves the feedback draft", async ({
  page,
}) => {
  await page.goto("/map");
  await page.getByRole("button", { name: "留言区", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "留言区" });
  const draft = dialog.getByLabel("留言内容");
  await draft.fill("保留这段留言");
  const input = dialog.getByLabel("上传图片");
  const firstChooser = page.waitForEvent("filechooser");
  await input.click();
  await (
    await firstChooser
  ).setFiles({
    name: "existing.png",
    mimeType: "image/png",
    buffer: Buffer.from("isolated fixture"),
  });
  const secondChooser = page.waitForEvent("filechooser");
  await input.click();
  await (await secondChooser).setFiles([]);
  await input.dispatchEvent("cancel");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(draft).toHaveValue("保留这段留言");
  await expect(dialog.getByText("existing.png")).toBeVisible();
  await dialog.getByRole("button", { name: "关闭留言区" }).click();
  await expect(dialog).toHaveCount(0);
});
