import { createRoot } from "react-dom/client";
import { DateGateWorkspace } from "@/features/console/date-gate-workspace";
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/rpc?path=" + encodeURIComponent(path), {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error);
  return result;
}
createRoot(document.getElementById("root")!).render(
  <DateGateWorkspace request={request} admin={true} Dialog={() => null} />,
);
