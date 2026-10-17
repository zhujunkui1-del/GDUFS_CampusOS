import { readFileSync } from "node:fs";
export function previewConsoleCredential(values: Record<string, string>) {
  if (values.CONSOLE_AUTH_MODE !== "admin_password")
    return values.CONSOLE_ADMIN_ACCESS_KEY;
  // Explicit local owner-provided input, never an application import or fixture.
  return readFileSync("CampusOS_Codex_完整设计文档_v2/key.md", "utf8")
    .replace(/^\uFEFF/, "")
    .trim();
}
