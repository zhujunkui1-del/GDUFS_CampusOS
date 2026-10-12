CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_web', 'official_account', 'group_import', 'social_link', 'manual', 'user_private')),
  allowed_domains_json TEXT NOT NULL CHECK (json_valid(allowed_domains_json)),
  entry_urls_json TEXT NOT NULL CHECK (json_valid(entry_urls_json)),
  fetch_policy_json TEXT NOT NULL CHECK (json_valid(fetch_policy_json)),
  authorization_status TEXT NOT NULL DEFAULT 'pending' CHECK (authorization_status IN ('pending', 'approved', 'rejected')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  last_checked_at TEXT
);
CREATE TABLE knowledge_documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id),
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  verified_at TEXT,
  valid_until TEXT,
  academic_year TEXT,
  campus_scope TEXT NOT NULL CHECK (campus_scope IN ('university_town', 'baiyun', 'all', 'online', 'unknown')),
  data_domain TEXT NOT NULL CHECK (data_domain IN ('official_policy', 'campus_announcements', 'approved_life_experience', 'user_private')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'expired', 'superseded', 'withdrawn')),
  superseded_by TEXT REFERENCES knowledge_documents(id),
  CHECK ((data_domain = 'user_private' AND owner_user_id IS NOT NULL) OR (data_domain <> 'user_private' AND owner_user_id IS NULL)),
  UNIQUE(url, content_hash)
);
CREATE INDEX documents_visibility ON knowledge_documents(data_domain, owner_user_id, review_status, lifecycle_status);
CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  vector_key TEXT UNIQUE,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0)
);
CREATE TABLE knowledge_facts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  evidence_chunk_id TEXT REFERENCES knowledge_chunks(id),
  claim TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  valid_until TEXT
);
CREATE TABLE campus_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  organizer TEXT,
  category TEXT,
  starts_at TEXT,
  ends_at TEXT,
  registration_deadline TEXT,
  deadline_semantics TEXT CHECK (deadline_semantics IS NULL OR deadline_semantics IN ('date_only', 'exact_time')),
  target_audience TEXT,
  campus_scope TEXT NOT NULL CHECK (campus_scope IN ('university_town', 'baiyun', 'all', 'online', 'unknown')),
  place_id TEXT REFERENCES campus_places(id),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('upcoming', 'ongoing', 'ended', 'cancelled', 'postponed', 'unknown')),
  CHECK (place_id IS NULL OR campus_scope = 'university_town'),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX events_time_scope ON campus_events(campus_scope, starts_at, review_status);
CREATE TABLE event_sources (
  event_id TEXT NOT NULL REFERENCES campus_events(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id),
  PRIMARY KEY (event_id, document_id)
);
CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE content_reviews (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('source', 'place', 'media', 'document', 'event')),
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
