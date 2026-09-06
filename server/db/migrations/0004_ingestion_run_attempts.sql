-- A retried job keeps its row in `jobs` and only increments `attempts`, so the
-- retry reuses the same job id. A UNIQUE constraint on job_id alone therefore
-- made every second attempt collide with the first attempt's run at the very
-- first insert, before it could reach the source again. Each transient failure
-- burned its remaining attempts on duplicate-key errors, dead-lettered, and
-- overwrote the original cause in jobs.error_detail.
-- One ingestion run per job attempt instead, which is what `attempt` is for.
ALTER TABLE ingestion_runs DROP CONSTRAINT IF EXISTS ingestion_runs_job_id_key;
ALTER TABLE ingestion_runs ADD CONSTRAINT ingestion_runs_job_attempt_key UNIQUE (job_id, attempt);
