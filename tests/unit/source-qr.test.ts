import { it, expect, vi } from "vitest";
import { sourceQrImage } from "../../services/external-search/qr-image.mjs";
it("returns the original source PNG rather than a masked or clipped screenshot", async () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const screenshot = vi.fn(() => {
    throw Error("DOM screenshot must not be used");
  });
  const locator = {
    evaluate: async (fn: (el: unknown) => unknown) =>
      fn({ tagName: "IMG", currentSrc: png }),
    screenshot,
  };
  expect(await sourceQrImage(locator)).toBe(png);
  expect(screenshot).not.toHaveBeenCalled();
});
