ALTER TABLE user_tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE user_tasks ADD COLUMN event_id TEXT;
ALTER TABLE user_tasks ADD COLUMN article_id TEXT;
ALTER TABLE user_tasks ADD COLUMN event_day TEXT;
CREATE INDEX user_tasks_active ON user_tasks(user_id, status, due_at);
