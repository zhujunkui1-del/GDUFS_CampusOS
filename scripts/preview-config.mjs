// Guard the public preview target before build, migration or deployment.
export function assertPreviewTarget(config, accountId) {
  const env = config.env?.preview;
  const db = env?.d1_databases;
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId))
    throw new Error("An explicit Cloudflare account is required");
  if (
    env?.name !== "campusos-preview" ||
    env.main !== "preview-worker.ts" ||
    env.workers_dev !== true ||
    env.preview_urls !== false ||
    !Array.isArray(env.routes) ||
    env.routes.length
  )
    throw new Error(
      "Preview must target campusos-preview on workers.dev without routes",
    );
  if (
    db?.length !== 1 ||
    db[0].binding !== "DB" ||
    db[0].database_name !== "campusos-preview" ||
    !/^[a-f0-9-]{36}$/.test(db[0].database_id) ||
    db[0].database_id === "00000000-0000-0000-0000-000000000000"
  )
    throw new Error("Preview requires its dedicated DB binding and real UUID");
  if (
    config.env?.production?.d1_databases?.some(
      (item) => item.database_id === db[0].database_id,
    ) ||
    config.d1_databases?.some((item) => item.database_id === db[0].database_id)
  )
    throw new Error(
      "Preview database cannot be shared with local or production",
    );
  if (
    env.services?.length !== 1 ||
    env.services[0].binding !== "WORKER_SELF_REFERENCE" ||
    env.services[0].service !== env.name
  )
    throw new Error("Preview self-reference must not target another Worker");
  return {
    environment: "preview",
    worker: env.name,
    database: db[0].database_name,
    databaseId: db[0].database_id,
  };
}
