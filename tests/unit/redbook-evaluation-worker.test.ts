import { it, expect, vi } from "vitest";
vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
import worker from "../../services/xhs-redbook-eval/worker.mjs";
const key = Buffer.alloc(32, 4).toString("base64");
const env = () => ({
  SERVICE_TOKEN: "fixture-evaluation-token",
  SESSION_KEY: key,
  SESSION_OBJECT: "evaluation/redbook-20261027-1234abcd.enc",
  SESSIONS: { get: vi.fn() },
  EVALUATOR: { getByName: vi.fn(() => ({ fetch: vi.fn() })) },
});
const req = (body: unknown, authorized = true) =>
  new Request("https://evaluation.test/probe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorized
        ? { Authorization: "Bearer fixture-evaluation-token" }
        : {}),
    },
    body: JSON.stringify(body),
  });
it("does not read private state for unauthenticated or invalid evaluation input", async () => {
  const e = env();
  expect(
    (await worker.fetch(req({ query: "广外", platform: "xhs" }, false), e))
      .status,
  ).toBe(401);
  for (const body of [
    null,
    { query: "广外", platform: "xhs", cookies: [] },
    { query: "广外", platform: "unknown" },
  ])
    expect((await worker.fetch(req(body), e)).status).toBe(400);
  expect(e.SESSIONS.get).not.toHaveBeenCalled();
});
it("decrypts only authenticated evaluation ciphertext and refuses tampering before forwarding", async () => {
  const state = { cookies: [], origins: [] },
    plain = new TextEncoder().encode(JSON.stringify(state)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey(
    "raw",
    Buffer.from(key, "base64"),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        "campusos:xhs-provider-evaluation:v1",
      ),
    },
    imported,
    plain,
  );
  const bytes = new Uint8Array(iv.length + cipher.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(cipher), 12);
  const fetch = vi.fn(async (request: Request) => {
    expect((await request.json()).state).toEqual(state);
    return Response.json({ status: "fixture-only", searchVerified: false });
  });
  const e = env();
  e.EVALUATOR.getByName.mockReturnValue({ fetch });
  e.SESSIONS.get.mockResolvedValue({ arrayBuffer: async () => bytes.buffer });
  const response = await worker.fetch(
    req({ query: "广外", platform: "xhs" }),
    e,
  );
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledOnce();
  bytes[20] ^= 1;
  const rejected = await worker.fetch(
    req({ query: "广外", platform: "xhs" }),
    e,
  );
  expect(rejected.status).toBe(503);
  expect((await rejected.json()).error).toBe("session_integrity");
  expect(fetch).toHaveBeenCalledOnce();
});
