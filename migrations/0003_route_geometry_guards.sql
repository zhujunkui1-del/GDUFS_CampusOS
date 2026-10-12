-- SQLite CHECK expressions that evaluate to NULL do not reject a row.
-- Reject missing/empty geometry explicitly, including on snapshot updates.
CREATE TRIGGER route_geometry_insert BEFORE INSERT ON route_snapshots
WHEN COALESCE(json_extract(NEW.path_geojson, '$.type') = 'LineString' AND json_type(NEW.path_geojson, '$.coordinates') = 'array' AND json_array_length(NEW.path_geojson, '$.coordinates') >= 2, 0) = 0
BEGIN SELECT RAISE(ABORT, 'route requires a nonempty LineString'); END;
CREATE TRIGGER route_geometry_update BEFORE UPDATE OF path_geojson ON route_snapshots
WHEN COALESCE(json_extract(NEW.path_geojson, '$.type') = 'LineString' AND json_type(NEW.path_geojson, '$.coordinates') = 'array' AND json_array_length(NEW.path_geojson, '$.coordinates') >= 2, 0) = 0
BEGIN SELECT RAISE(ABORT, 'route requires a nonempty LineString'); END;
