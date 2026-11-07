-- Derived article facets, additive only: no body, publication or visibility change.
-- One row per article, so an enumeration query ("还有别的学院的院运会吗") can be
-- grouped in SQL instead of hoping the right chunks survive a top-3 retrieval.
ALTER TABLE document_article_analysis ADD COLUMN college TEXT NOT NULL DEFAULT '';
ALTER TABLE document_article_analysis ADD COLUMN event_type TEXT NOT NULL DEFAULT '';
ALTER TABLE document_article_analysis ADD COLUMN event_start TEXT;
ALTER TABLE document_article_analysis ADD COLUMN event_end TEXT;

CREATE INDEX article_college_event ON document_article_analysis(college, event_type, event_start);
CREATE INDEX article_event_start ON document_article_analysis(event_start, event_type);
