CREATE TABLE user_article_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  origin_surface TEXT NOT NULL CHECK (origin_surface IN ('radar', 'knowledge', 'calendar')),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  UNIQUE (user_id, article_id)
);

CREATE INDEX user_article_favorites_created
  ON user_article_favorites (user_id, created_at_ms DESC, id DESC);

CREATE INDEX user_article_favorites_surface_created
  ON user_article_favorites (user_id, origin_surface, created_at_ms DESC, id DESC);
