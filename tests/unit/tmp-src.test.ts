import { it } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";

const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});

const ORIGIN = "https://xxgk.gdufs.edu.cn";

it("inspect source", async () => {
  const f = await consoleV2Fixture();
  const store = new ConsoleSyncStore(f.db, f.actor);
  try {
    const created = await store.createGovernedSource(
      sourceInput({ websiteUrl: ORIGIN, governance: confirmed }),
    );
    const id = created.id;
    await store.verifySource(id, {
      ...cmd(created.version),
      status: "verified",
      officialStatus: "verified_official",
      permissionStatus: "approved",
      authorityConfirmed: true,
      note: "隔离环境核验",
      evidenceUrls: [ORIGIN + "/"],
    });
    const s = await store.sourceV2(id);
    console.log(
      "SOURCE",
      JSON.stringify({
        websiteUrl: s.websiteUrl,
        verificationStatus: s.verificationStatus,
        officialStatus: s.officialStatus,
        permissionStatus: s.permissionStatus,
        version: s.version,
        channelType: s.channelType,
        sourceType: s.sourceType,
      }),
    );
    const row = f.sqlite
      .prepare(
        "SELECT website_url,channel_type,source_type,verification_status,official_status,permission_status FROM knowledge_sources WHERE id=?",
      )
      .get(id);
    console.log("ROW", JSON.stringify(row));
  } finally {
    f.close();
  }
}, 120000);
