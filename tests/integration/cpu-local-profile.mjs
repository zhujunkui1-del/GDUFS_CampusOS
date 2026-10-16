// Official V8 Profiler protocol against local workerd. These are NOT cloud CPU
// measurements. No production credentials or private messages are recorded.
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import WebSocket from "ws";
const dir = process.env.CPU_CAPTURE_DIR || "docs/verification/s2-e-cpu/before";
mkdirSync(dir, { recursive: true });
const targets = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl, {
  origin: "http://localhost:9229",
});
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let sequence = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const work = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) work?.reject(Error(message.error.message));
    else work?.resolve(message.result);
  }
};
function call(method) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method }));
  });
}
await call("Profiler.enable");
const base = "http://127.0.0.1:8787";
const input = {
  start: { type: "place", placeId: "osm-way-312536955" },
  endPlaceId: "osm-way-307250998",
  mode: "walking",
};
const results = [];
for (let phase = 0; phase < 2; phase++) {
  await call("Profiler.start");
  for (let i = 0; i < (phase ? 12 : 1); i++) {
    const r = await fetch(base + "/api/map/skills/plan_route", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const value = await r.json();
    assert.equal(r.status, 200, JSON.stringify(value));
    assert.equal(value.ok, true);
  }
  const { profile } = await call("Profiler.stop");
  mkdirSync(".map-tools/cpu", { recursive: true });
  writeFileSync(
    `.map-tools/cpu/local-${phase ? "warm" : "cold"}.cpuprofile`,
    JSON.stringify(profile),
  );
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children || []) parents.set(child, node.id);
  const self = new Map(),
    inclusive = new Map();
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const id = profile.samples[i],
      time = (profile.timeDeltas?.[i] || 0) / 1000;
    self.set(id, (self.get(id) || 0) + time);
    for (let n = id; n !== undefined; n = parents.get(n))
      inclusive.set(n, (inclusive.get(n) || 0) + time);
  }
  const top = profile.nodes
    .map((node) => ({
      function: node.callFrame.functionName,
      file: node.callFrame.url.replace(/^.*(?=\.open-next\/)/, ""),
      line: node.callFrame.lineNumber + 1,
      selfMs: Math.round((self.get(node.id) || 0) * 100) / 100,
      inclusiveMs: Math.round((inclusive.get(node.id) || 0) * 100) / 100,
    }))
    .filter((n) => n.selfMs > 0 && !["(idle)", "(root)"].includes(n.function))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 35);
  results.push({ phase: phase ? "warm-12" : "cold-1", top });
}
socket.terminate();
const result = {
  at: new Date().toISOString(),
  localWorkerdOnly: true,
  interpretation:
    "V8 sampling includes idle/GC and framework startup. Not Cloudflare per-invocation CPU or wall latency.",
  results,
};
writeFileSync(
  `${dir}/local-profile.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
