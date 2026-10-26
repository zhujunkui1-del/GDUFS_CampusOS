import fs from "node:fs/promises";
import { PNG } from "pngjs";
import jsQR from "jsqr";
// Decode only the private captured image. Never print its login URL/nonce.
const path = "services/external-search/runtime/cloud-login.png";
const file = await fs.readFile(path);
if (file.length > 180000) throw Error("QR image exceeds diagnostic limit");
const png = PNG.sync.read(file), decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
const receipt = {
  checkedAt: new Date().toISOString(),
  capturedFileModifiedAt: (await fs.stat(path)).mtime.toISOString(),
  width: png.width, height: png.height, decodable: !!decoded,
  decodedPayloadStored: false, authenticationVerified: false,
};
await fs.writeFile("docs/verification/cloud-search/qr-original-image.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
if (!decoded) process.exitCode = 1;
