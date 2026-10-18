import { sqliteD1 } from "./sqlite-d1";
import { ConsoleGovernanceStore } from "@/lib/server/console/v2-governance";
export const actor = {
  id: "v2-fixture-admin",
  email: "v2@example.invalid",
  role: "admin" as const,
};
export async function consoleV2Fixture() {
  const f = sqliteD1();
  f.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(actor.id, actor.email);
  return { ...f, actor, store: new ConsoleGovernanceStore(f.db, actor) };
}
export const sourceInput = (extra: object = {}) => ({
  commandId: crypto.randomUUID(),
  displayName: "隔离来源",
  sourceType: "official_web",
  organization: "隔离广外机构",
  campusScope: "all",
  websiteUrl: "https://example.invalid/",
  wechatId: null,
  evidenceUrls: [],
  priority: 3,
  connectorType: "disabled",
  fetchPolicy: { mode: "disabled", maxRequests: 0 },
  ...extra,
});
export const confirmed = {
  affiliation: "confirmed",
  operating: "active",
  affiliationEvidence: ["https://example.invalid/relation"],
  operatingEvidence: ["https://example.invalid/current"],
  note: "隔离核验，不是实际学校来源",
  enabled: true,
  retainHistory: true,
};
