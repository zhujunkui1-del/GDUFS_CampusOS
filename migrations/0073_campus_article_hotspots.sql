CREATE TABLE campus_article_hotspots (
  document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TRIGGER campus_article_hotspots_insert AFTER INSERT ON campus_article_hotspots BEGIN
  UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;

CREATE TRIGGER campus_article_hotspots_delete AFTER DELETE ON campus_article_hotspots BEGIN
  UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1 WHERE id='console-v2-settings';
END;
