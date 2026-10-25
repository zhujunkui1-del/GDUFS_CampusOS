-- A day alone cannot distinguish two sessions at the same venue.
UPDATE article_activity_index SET group_key=CASE
 WHEN starts_at IS NOT NULL AND place_raw IS NOT NULL THEN title||'|'||starts_at||'|'||place_raw ELSE NULL END
WHERE group_key IS NOT (CASE WHEN starts_at IS NOT NULL AND place_raw IS NOT NULL THEN title||'|'||starts_at||'|'||place_raw ELSE NULL END);
