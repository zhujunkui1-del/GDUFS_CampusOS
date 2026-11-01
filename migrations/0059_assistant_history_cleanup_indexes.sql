-- Account histories and request IDs now outlive guest TTL; cleanup must not scan them.
CREATE INDEX assistant_run_live_site ON agent_runs(status,lease_until_ms);
CREATE INDEX assistant_run_live_owner ON agent_runs(owner_key,status,lease_until_ms);
CREATE INDEX assistant_deleted_expiry ON conversations(expires_at_ms) WHERE deleted_at_ms IS NOT NULL;
