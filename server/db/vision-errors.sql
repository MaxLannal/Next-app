-- Schema v8: why a photo's or PDF's reading didn't land, so the page can say so and the hub can try
-- again by itself when the cause passes ('balance', 'unreachable'). Null while there's no failure.
ALTER TABLE attachments ADD COLUMN vision_error TEXT;
-- Readings that failed before the reason was kept are tried again, as if Claude had been out of reach.
UPDATE attachments SET vision_error = 'unreachable' WHERE vision_status = 'failed';
