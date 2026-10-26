// Read original QR pixels, avoiding DOM screenshot masks and viewport clipping.
export async function sourceQrImage(locator) {
  const data = await locator.evaluate(async (el) => {
    const image = el.tagName === "IMG" ? el : el.querySelector("img");
    if (image) {
      const src = image.currentSrc || image.getAttribute("src") || "";
      if (src.startsWith("data:image/png;base64,")) return src;
      await image.decode();
      const width = image.naturalWidth,
        height = image.naturalHeight;
      if (width < 20 || width > 1024 || height !== width) return null;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      return canvas.toDataURL("image/png");
    }
    const canvas = el.tagName === "CANVAS" ? el : el.querySelector("canvas");
    return canvas ? canvas.toDataURL("image/png") : null;
  });
  const png = typeof data === "string" ? data.replace(/\s+/g, "") : "";
  if (
    png.length > 180000 ||
    !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png)
  )
    throw Error("QR_IMAGE_UNAVAILABLE");
  return png;
}
