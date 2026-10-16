// Decode only pprof function names, never stacks, request data or profile labels.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
function fields(bytes) {
  let offset = 0;
  function integer() {
    let value = 0,
      shift = 0;
    for (;;) {
      const b = bytes[offset++];
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) return value;
      shift += 7;
    }
  }
  const result = [];
  while (offset < bytes.length) {
    const tag = integer(),
      wire = tag & 7,
      field = tag >> 3;
    if (wire === 0) result.push({ field, value: integer() });
    else if (wire === 2) {
      const length = integer();
      result.push({ field, value: bytes.subarray(offset, offset + length) });
      offset += length;
    } else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else throw Error("Unsupported pprof wire type");
  }
  return result;
}
const profiles = ["before-active-chat", "before-route"].map((name) => {
  let raw = readFileSync(`.map-tools/cpu/${name}.pprof.gz`);
  if (raw[0] === 31 && raw[1] === 139) raw = gunzipSync(raw);
  const data = fields(raw);
  const strings = data
    .filter((f) => f.field === 6)
    .map((f) => f.value.toString("utf8"));
  const functions = data
    .filter((f) => f.field === 5)
    .map((f) => strings[fields(f.value).find((v) => v.field === 2)?.value]);
  return {
    label: name,
    decoded: true,
    bytes: raw.length,
    sampleCount: data.filter((f) => f.field === 2).length,
    functions,
    hasApplicationFunctions: functions.some(
      (fn) => fn && !["(root)", "(idle)"].includes(fn),
    ),
  };
});
const result = {
  recordedAt: new Date().toISOString(),
  officialProductionProfileApi: true,
  profiles,
  dashboardAttempt:
    "Capture during real requests returned No recent executions were found for this Worker.",
  usableCloudFunctionAttribution: false,
  fallback:
    "Local workerd V8 sampling and actual per-invocation Cloudflare CPU metrics; kept separate.",
};
writeFileSync(
  "docs/verification/s2-e-cpu/profile-observation.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
