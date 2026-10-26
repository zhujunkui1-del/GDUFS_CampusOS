-- Anonymous page views only. No IP, account, URL, or browser identity is stored.
CREATE TABLE site_visit_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  started_at_ms INTEGER NOT NULL
);
INSERT INTO site_visit_settings VALUES(1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
CREATE TABLE site_visit_days (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL CHECK(views>=0),
  cumulative INTEGER NOT NULL CHECK(cumulative>=views)
);
CREATE TABLE site_visit_batches (
  id TEXT PRIMARY KEY,
  views INTEGER NOT NULL CHECK(views BETWEEN 1 AND 20),
  received_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_site_visit_batch_expiry ON site_visit_batches(received_at_ms);
CREATE TRIGGER site_visit_count AFTER INSERT ON site_visit_batches BEGIN
  INSERT INTO site_visit_days(day,views,cumulative)
  VALUES(date('now','+8 hours'),NEW.views,
    COALESCE((SELECT cumulative FROM site_visit_days ORDER BY day DESC LIMIT 1),0)+NEW.views)
  ON CONFLICT(day) DO UPDATE SET views=views+NEW.views,cumulative=cumulative+NEW.views;
END;

-- Only a non-secret status snapshot. Login QR payloads stay in expiring relay jobs.
CREATE TABLE external_source_session_state (
  provider TEXT PRIMARY KEY CHECK(provider='xiaohongshu'),
  state TEXT NOT NULL CHECK(state IN ('logged_in','login_required','verification_required','unknown','unavailable')),
  checked_at_ms INTEGER NOT NULL
);
