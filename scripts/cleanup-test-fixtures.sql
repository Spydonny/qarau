\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(71618285);

CREATE TEMP TABLE cleanup_sources ON COMMIT DROP AS
  SELECT id FROM sources WHERE domain = 'example.test';
CREATE TEMP TABLE cleanup_datasets ON COMMIT DROP AS
  SELECT id FROM datasets WHERE source_id IN (SELECT id FROM cleanup_sources);
CREATE TEMP TABLE cleanup_versions ON COMMIT DROP AS
  SELECT id FROM dataset_versions WHERE dataset_id IN (SELECT id FROM cleanup_datasets);
CREATE TEMP TABLE cleanup_analyses ON COMMIT DROP AS
  SELECT id, market_snapshot_id, mapping_id FROM analysis_runs WHERE dataset_version_id IN (SELECT id FROM cleanup_versions);
CREATE TEMP TABLE cleanup_signals ON COMMIT DROP AS
  SELECT id FROM signal_candidates WHERE analysis_run_id IN (SELECT id FROM cleanup_analyses);
CREATE TEMP TABLE cleanup_packages ON COMMIT DROP AS
  SELECT id FROM dataset_packages WHERE dataset_version_id IN (SELECT id FROM cleanup_versions);
CREATE TEMP TABLE cleanup_ingestions ON COMMIT DROP AS
  SELECT id, job_id FROM ingestion_runs WHERE source_id IN (SELECT id FROM cleanup_sources);
CREATE TEMP TABLE cleanup_targets ON COMMIT DROP AS
  SELECT DISTINCT target_id AS id FROM dataset_target_mappings
  WHERE dataset_id IN (SELECT id FROM cleanup_datasets);
CREATE TEMP TABLE cleanup_jobs ON COMMIT DROP AS
  SELECT id FROM jobs
  WHERE id IN (SELECT job_id FROM cleanup_ingestions WHERE job_id IS NOT NULL)
     OR resource_id IN (
       SELECT id FROM cleanup_sources
       UNION ALL SELECT id FROM cleanup_versions
       UNION ALL SELECT id FROM cleanup_analyses
       UNION ALL SELECT id FROM cleanup_packages
     )
     OR idempotency_key LIKE 'scrape-handler-%'
     OR idempotency_key LIKE 'queue-first-%'
     OR idempotency_key LIKE 'queue-retry-%';

DELETE FROM pipeline_stage_runs WHERE job_id IN (SELECT id FROM cleanup_jobs);
ALTER TABLE purchases DISABLE TRIGGER purchases_immutable;
DELETE FROM purchases WHERE package_id IN (SELECT id FROM cleanup_packages);
ALTER TABLE purchases ENABLE TRIGGER purchases_immutable;
DELETE FROM access_grant_cache WHERE package_id IN (SELECT id FROM cleanup_packages);
DELETE FROM sales WHERE package_id IN (SELECT id FROM cleanup_packages);
DELETE FROM blockchain_commitments WHERE package_id IN (SELECT id FROM cleanup_packages);
DELETE FROM dataset_packages WHERE id IN (SELECT id FROM cleanup_packages);
DELETE FROM alpha_score_components WHERE analysis_run_id IN (SELECT id FROM cleanup_analyses);
DELETE FROM leakage_check_results WHERE analysis_run_id IN (SELECT id FROM cleanup_analyses);
DELETE FROM validation_results WHERE analysis_run_id IN (SELECT id FROM cleanup_analyses);
DELETE FROM screening_results WHERE signal_candidate_id IN (SELECT id FROM cleanup_signals);
DELETE FROM signal_candidates WHERE id IN (SELECT id FROM cleanup_signals);
DELETE FROM analysis_runs WHERE id IN (SELECT id FROM cleanup_analyses);
DELETE FROM legacy_analysis_records WHERE dataset_id IN (SELECT id FROM cleanup_datasets);
DELETE FROM legacy_dataset_derivations WHERE dataset_id IN (SELECT id FROM cleanup_datasets);
DELETE FROM dataset_versions WHERE id IN (SELECT id FROM cleanup_versions);
DELETE FROM dataset_target_mappings WHERE dataset_id IN (SELECT id FROM cleanup_datasets);

ALTER TABLE market_snapshots DISABLE TRIGGER market_snapshots_immutable;
DELETE FROM market_snapshots
WHERE id IN (SELECT market_snapshot_id FROM cleanup_analyses)
  AND target_id IN (SELECT id FROM cleanup_targets);
ALTER TABLE market_snapshots ENABLE TRIGGER market_snapshots_immutable;
DELETE FROM market_targets
WHERE id IN (SELECT id FROM cleanup_targets)
  AND provider = 'fixture'
  AND NOT EXISTS (SELECT 1 FROM market_snapshots WHERE target_id = market_targets.id)
  AND NOT EXISTS (SELECT 1 FROM dataset_target_mappings WHERE target_id = market_targets.id);

ALTER TABLE source_snapshots DISABLE TRIGGER source_snapshots_immutable;
DELETE FROM source_snapshots WHERE source_id IN (SELECT id FROM cleanup_sources);
ALTER TABLE source_snapshots ENABLE TRIGGER source_snapshots_immutable;
DELETE FROM ingestion_runs WHERE id IN (SELECT id FROM cleanup_ingestions);
DELETE FROM source_discoveries WHERE source_id IN (SELECT id FROM cleanup_sources);
DELETE FROM datasets WHERE id IN (SELECT id FROM cleanup_datasets);
DELETE FROM sources WHERE id IN (SELECT id FROM cleanup_sources);
DELETE FROM jobs WHERE id IN (SELECT id FROM cleanup_jobs);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sources WHERE domain = 'example.test') THEN
    RAISE EXCEPTION 'fixture cleanup incomplete';
  END IF;
END
$$;
COMMIT;
