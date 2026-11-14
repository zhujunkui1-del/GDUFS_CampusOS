CREATE TABLE building_profiles(place_id TEXT PRIMARY KEY,description TEXT NOT NULL,photos_json TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
CREATE TABLE project_images(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('building','feedback')),feedback_id TEXT REFERENCES project_feedback(id),name TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX project_images_feedback ON project_images(feedback_id);
