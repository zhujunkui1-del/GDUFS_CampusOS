-- The daily enrichment budget was a constant in two places. It still has to
-- stay small by default (each reviewed article costs several model calls), but
-- it is an operator decision, not a compile-time fact.
ALTER TABLE console_engine_settings ADD COLUMN calendar_ai_cap INTEGER NOT NULL DEFAULT 40 CHECK(calendar_ai_cap BETWEEN 1 AND 400);
