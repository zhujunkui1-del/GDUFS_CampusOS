type Asset = { url: string; bytes: number; sha256: string };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const buffers = new Map<
  string,
  { promise: Promise<ArrayBuffer>; bytes: number }
>();
let residentBytes = 0;

/** Share validated bytes across mode changes; decoded scenes belong to each layer. */
export function readModelAsset(asset: Asset): Promise<ArrayBuffer> {
  const key = asset.url + ":" + asset.sha256;
  const existing = buffers.get(key);
  if (existing) {
    buffers.delete(key);
    buffers.set(key, existing);
    return existing.promise;
  }
  if (asset.bytes > MAX_ASSET_BYTES || asset.bytes < 20)
    return Promise.reject(new Error("model-budget"));
  while (residentBytes + asset.bytes > MAX_BYTES && buffers.size) {
    const oldest = buffers.keys().next().value!;
    residentBytes -= buffers.get(oldest)!.bytes;
    buffers.delete(oldest);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const promise = fetch(asset.url, {
    cache: "force-cache",
    signal: controller.signal,
  })
    .then(async (response) => {
      if (
        !response.ok ||
        response.headers.get("content-type")?.includes("text/html")
      )
        throw new Error("model-fetch");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== asset.bytes) throw new Error("model-size");
      const view = new DataView(bytes);
      if (
        view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== bytes.byteLength
      )
        throw new Error("model-format");
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (hash !== asset.sha256) throw new Error("model-integrity");
      return bytes;
    })
    .catch((error: unknown) => {
      if (buffers.get(key)?.promise === promise) {
        residentBytes -= asset.bytes;
        buffers.delete(key);
      }
      throw error;
    })
    .finally(() => clearTimeout(timeout));
  buffers.set(key, { promise, bytes: asset.bytes });
  residentBytes += asset.bytes;
  return promise;
}
