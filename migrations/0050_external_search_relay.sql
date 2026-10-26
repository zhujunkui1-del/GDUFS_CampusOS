-- Short-lived public search requests only; no article corpus or browser cookies.
CREATE TABLE agent_external_search_jobs (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','running','done')),
  runner_id TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_external_search_pending ON agent_external_search_jobs(created_at_ms,id) WHERE state='pending';
CREATE INDEX idx_external_search_expiry ON agent_external_search_jobs(expires_at_ms);
