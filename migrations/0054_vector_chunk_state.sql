-- Preview-only semantic index bookkeeping. Vectors live in Vectorize; this
-- table only records which current chunks were embedded and with which model.
-- It grants no visibility: every vector hit is revalidated against the public
-- document view and the current content revision before use.
CREATE TABLE vector_chunk_state (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  index_version TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN('ready','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  embedded_at TEXT,
  last_error TEXT
);
CREATE INDEX vector_chunk_state_pending
  ON vector_chunk_state(status, attempts, chunk_id);
