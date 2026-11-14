CREATE TABLE project_feedback (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'archived')),
  submitted_at TEXT NOT NULL
);

CREATE INDEX project_feedback_status_time
ON project_feedback(status, submitted_at DESC, id DESC);
