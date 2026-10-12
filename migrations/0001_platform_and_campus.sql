PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL UNIQUE,
  phone_encrypted BLOB NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE login_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  device_description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX login_sessions_user ON login_sessions(user_id, expires_at);
CREATE TABLE otp_challenges (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'recover', 'change_phone')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0 AND attempts <= max_attempts),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE external_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  status TEXT NOT NULL CHECK (status IN ('not_connected', 'authorized', 'expired', 'revoked')),
  token_encrypted BLOB,
  expires_at TEXT,
  UNIQUE(user_id, provider)
);
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  map_mode TEXT NOT NULL DEFAULT '2.5d' CHECK (map_mode IN ('2d', '2.5d')),
  interests_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interests_json))
);
CREATE TABLE user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  guest_session_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((user_id IS NOT NULL AND guest_session_hash IS NULL) OR (user_id IS NULL AND guest_session_hash IS NOT NULL))
);
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX messages_conversation ON conversation_messages(conversation_id, created_at);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'needs_input', 'needs_confirmation', 'failed')),
  tool_calls_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tool_calls_json)),
  cost_microunits INTEGER NOT NULL DEFAULT 0 CHECK (cost_microunits >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  license_status TEXT NOT NULL DEFAULT 'pending' CHECK (license_status IN ('pending', 'approved', 'rejected')),
  allowed_uses_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_uses_json)),
  verified_at TEXT,
  owner_decision TEXT,
  CHECK (license_status <> 'approved' OR (verified_at IS NOT NULL AND owner_decision IS NOT NULL))
);
CREATE TABLE campus_zones (
  id TEXT PRIMARY KEY CHECK (id IN ('teaching', 'living', 'connection')),
  name TEXT NOT NULL,
  polygon_json TEXT CHECK (polygon_json IS NULL OR json_valid(polygon_json)),
  source_id TEXT NOT NULL REFERENCES source_records(id),
  verified_at TEXT
);
CREATE TABLE campus_places (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL DEFAULT 'gdufs_university_town' CHECK (campus_id = 'gdufs_university_town'),
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
  category TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES campus_zones(id),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  coord_crs TEXT NOT NULL DEFAULT 'WGS84' CHECK (coord_crs = 'WGS84'),
  geom_json TEXT CHECK (geom_json IS NULL OR json_valid(geom_json)),
  source_id TEXT NOT NULL REFERENCES source_records(id),
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'owner_review_pending', 'license_pending', 'geography_pending', 'approved', 'rejected')),
  geography_status TEXT NOT NULL DEFAULT 'pending' CHECK (geography_status IN ('pending', 'verified', 'rejected')),
  verified_at TEXT,
  CHECK (status <> 'approved' OR (geography_status = 'verified' AND longitude IS NOT NULL AND latitude IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX places_zone_category ON campus_places(zone_id, category, status);
CREATE TRIGGER place_approval_insert BEFORE INSERT ON campus_places
WHEN NEW.status = 'approved' AND NOT EXISTS (SELECT 1 FROM source_records WHERE id = NEW.source_id AND license_status = 'approved')
BEGIN SELECT RAISE(ABORT, 'place source is not approved'); END;
CREATE TRIGGER place_approval_update BEFORE UPDATE ON campus_places
WHEN NEW.status = 'approved' AND NOT EXISTS (SELECT 1 FROM source_records WHERE id = NEW.source_id AND license_status = 'approved')
BEGIN SELECT RAISE(ABORT, 'place source is not approved'); END;

CREATE TABLE path_nodes (
  id TEXT PRIMARY KEY,
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  coord_crs TEXT NOT NULL DEFAULT 'WGS84' CHECK (coord_crs = 'WGS84'),
  level TEXT NOT NULL CHECK (level IN ('ground', 'underground', 'elevated')),
  source_id TEXT NOT NULL REFERENCES source_records(id),
  verified_at TEXT
);
CREATE TABLE place_entrances (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES campus_places(id),
  path_node_id TEXT NOT NULL REFERENCES path_nodes(id),
  source_id TEXT NOT NULL REFERENCES source_records(id),
  verified_at TEXT
);
CREATE TABLE path_edges (
  id TEXT PRIMARY KEY,
  from_node TEXT NOT NULL REFERENCES path_nodes(id),
  to_node TEXT NOT NULL REFERENCES path_nodes(id),
  length_meters REAL NOT NULL CHECK (length_meters > 0),
  level TEXT NOT NULL CHECK (level IN ('ground', 'underground', 'elevated')),
  accessible INTEGER CHECK (accessible IS NULL OR accessible IN (0, 1)),
  bidirectional INTEGER NOT NULL DEFAULT 1 CHECK (bidirectional IN (0, 1)),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  source_id TEXT NOT NULL REFERENCES source_records(id),
  network_version TEXT NOT NULL,
  verified_at TEXT,
  CHECK (from_node <> to_node),
  CHECK (verified = 0 OR verified_at IS NOT NULL)
);
CREATE INDEX edges_start ON path_edges(from_node, verified, network_version);
CREATE INDEX edges_end ON path_edges(to_node, verified, network_version);
CREATE TRIGGER edge_verification_insert BEFORE INSERT ON path_edges
WHEN NEW.verified = 1 AND (
  NOT EXISTS (SELECT 1 FROM source_records WHERE id = NEW.source_id AND license_status = 'approved') OR
  NOT EXISTS (SELECT 1 FROM path_nodes WHERE id = NEW.from_node AND verified_at IS NOT NULL) OR
  NOT EXISTS (SELECT 1 FROM path_nodes WHERE id = NEW.to_node AND verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'path source or endpoints are not verified'); END;
CREATE TRIGGER edge_verification_update BEFORE UPDATE ON path_edges
WHEN NEW.verified = 1 AND (
  NOT EXISTS (SELECT 1 FROM source_records WHERE id = NEW.source_id AND license_status = 'approved') OR
  NOT EXISTS (SELECT 1 FROM path_nodes WHERE id = NEW.from_node AND verified_at IS NOT NULL) OR
  NOT EXISTS (SELECT 1 FROM path_nodes WHERE id = NEW.to_node AND verified_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'path source or endpoints are not verified'); END;
CREATE TRIGGER revoke_source_map_data AFTER UPDATE OF license_status ON source_records
WHEN NEW.license_status <> 'approved'
BEGIN
  UPDATE campus_places SET status = 'license_pending' WHERE source_id = NEW.id AND status = 'approved';
  UPDATE path_edges SET verified = 0 WHERE source_id = NEW.id;
END;
CREATE TABLE route_snapshots (
  id TEXT PRIMARY KEY,
  owner_session_hash TEXT NOT NULL,
  path_geojson TEXT NOT NULL CHECK (json_valid(path_geojson) AND json_extract(path_geojson, '$.type') = 'LineString' AND json_array_length(path_geojson, '$.coordinates') >= 2),
  network_version TEXT NOT NULL,
  distance_meters REAL NOT NULL CHECK (distance_meters >= 0),
  estimated_minutes REAL NOT NULL CHECK (estimated_minutes >= 0),
  expires_at TEXT NOT NULL
);
CREATE TABLE place_media (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES campus_places(id),
  source_id TEXT NOT NULL REFERENCES source_records(id),
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'floorplan', 'panorama')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  alt_text TEXT NOT NULL,
  verified_at TEXT
);
CREATE TABLE user_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'deleted')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX tasks_user_time ON user_tasks(user_id, starts_at);
CREATE TABLE user_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  place_id TEXT REFERENCES campus_places(id),
  confirmed_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX schedules_user_time ON user_schedules(user_id, start_at);
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('place', 'event', 'document')),
  target_id TEXT NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
