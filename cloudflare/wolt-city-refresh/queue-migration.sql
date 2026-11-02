-- Run once against the existing wolt-demand-cache D1.
-- The old city_jobs rows remain intact; only new jobs use dispatch_status=queued.
ALTER TABLE city_jobs ADD COLUMN dispatched_at INTEGER;
CREATE TABLE IF NOT EXISTS scan_dispatch_lease (
 id INTEGER PRIMARY KEY CHECK (id=1),
 expires_at INTEGER NOT NULL
);
