-- The calendar queue stalled whenever the daily budget ran out: the processor
-- fell back to calendar_status='pending' and nothing ever writes that value, so
-- the remaining needs_enrichment rows were never picked up again until the next
-- day. The cap is raised to 100 so a normal backlog can drain in one day, and
-- the processor now reports the backlog instead of going silent.
UPDATE console_engine_settings SET calendar_ai_cap=100 WHERE id='console-v2-settings' AND calendar_ai_cap<100;
