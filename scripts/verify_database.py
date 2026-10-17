"""Verify migrations and constraints using isolated, in-memory test fixtures."""
import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in sorted(Path("migrations").glob("*.sql")):
    db.executescript(migration.read_text(encoding="utf-8"))
tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
seeded_controls = {'console_engine_settings': 1}
assert all(db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] == seeded_controls.get(name, 0) for name in tables)
assert db.execute("SELECT id,sync_hours,network_budget,earliest_import_day FROM console_engine_settings").fetchone() == ('console-v2-settings', 24, 20, None)

def rejects(sql, args=()):
    try:
        db.execute(sql, args)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"Constraint unexpectedly accepted: {sql}")

db.execute("INSERT INTO source_records(id,title,source_url) VALUES('test-source','Isolated fixture','https://example.invalid/test')")
db.execute("INSERT INTO campus_zones(id,name,source_id) VALUES('teaching','Test zone','test-source')")
place_sql = "INSERT INTO campus_places(id,name,category,zone_id,longitude,latitude,source_id,status,geography_status,verified_at) VALUES(?, 'Isolated fixture','building','teaching',0,0,'test-source','approved','verified','2026-10-12T00:00:00Z')"
rejects(place_sql, ('test-place',))
db.execute("UPDATE source_records SET license_status='approved', verified_at='2026-10-12T00:00:00Z', owner_decision='Test only' WHERE id='test-source'")
db.execute(place_sql, ('test-place',))
db.execute("INSERT INTO path_nodes(id,longitude,latitude,level,source_id) VALUES('test-a',0,0,'ground','test-source')")
db.execute("INSERT INTO path_nodes(id,longitude,latitude,level,source_id) VALUES('test-b',0,0,'underground','test-source')")
edge_sql = "INSERT INTO path_edges(id,from_node,to_node,length_meters,level,verified,source_id,network_version,verified_at) VALUES('test-edge','test-a','test-b',1,'underground',1,'test-source','test-only','2026-10-12T00:00:00Z')"
rejects(edge_sql)
db.execute("UPDATE path_nodes SET verified_at='2026-10-12T00:00:00Z'")
db.execute(edge_sql)
rejects("INSERT INTO place_entrances(id,place_id,path_node_id,source_id) VALUES('test-entrance','missing','test-a','test-source')")
rejects("INSERT INTO conversations(id) VALUES('unowned-conversation')")
rejects("INSERT INTO route_snapshots(id,owner_session_hash,path_geojson,network_version,distance_meters,estimated_minutes,expires_at) VALUES('test-route','test-session','{\"type\":\"LineString\"}','test-only',0,0,'2026-10-12T00:00:00Z')")
rejects("INSERT INTO campus_events(id,title,campus_scope,place_id) VALUES('test-event','Test','baiyun','test-place')")
db.execute("UPDATE source_records SET license_status='rejected' WHERE id='test-source'")
assert db.execute("SELECT status FROM campus_places WHERE id='test-place'").fetchone()[0] == 'license_pending'
assert db.execute("SELECT verified FROM path_edges WHERE id='test-edge'").fetchone()[0] == 0
assert not list(db.execute("PRAGMA foreign_key_check"))
assert db.execute("PRAGMA integrity_check").fetchone()[0] == 'ok'
print(f"PASS: {len(tables)} tables migrated with only declared engine controls; source approval, graph verification, ownership, campus and foreign-key constraints passed. All test fixtures remained in memory.")
