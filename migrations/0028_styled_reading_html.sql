-- D-057: replace the lossy text representation with source HTML layout and images.
ALTER TABLE campus_collector_articles ADD COLUMN rendering_version INTEGER NOT NULL DEFAULT 1 CHECK(rendering_version IN(1,2));
