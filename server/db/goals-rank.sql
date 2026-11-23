-- Schema v4: goals keep the order they are dragged into, smallest rank first. Existing goals rank
-- newest first, the order they were shown in, so nothing moves when this runs.
ALTER TABLE goals ADD COLUMN rank INTEGER NOT NULL DEFAULT 0;
UPDATE goals SET rank = (
  SELECT COUNT(*) FROM goals AS newer
  WHERE newer.created_at > goals.created_at OR (newer.created_at = goals.created_at AND newer.id > goals.id)
);
