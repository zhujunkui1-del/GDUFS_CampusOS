// A credential file may contain several vendors. Never select a global key match.
export function stepPlanCredential(text) {
  const section = text.split("阶跃星辰开放平台")[1] || "";
  const key = section.match(/接口密钥\s*[：:]\s*([^\s"'`]+)/)?.[1];
  if (
    !key ||
    !/^[A-Za-z0-9._-]{20,256}$/.test(key) ||
    !section.includes("https://api.stepfun.com/step_plan/v1")
  )
    throw Error("Missing valid Step Plan credential section");
  return {
    provider: "stepfun",
    model: "step-3.5-flash-2603",
    baseUrl: "https://api.stepfun.com/step_plan/v1",
    apiKey: key,
  };
}
