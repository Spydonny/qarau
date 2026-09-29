ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS best_signal_candidate_id uuid REFERENCES signal_candidates(id);
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS best_artifact_hash bytea CHECK (best_artifact_hash IS NULL OR octet_length(best_artifact_hash) = 32);
CREATE INDEX IF NOT EXISTS analysis_runs_best_candidate_idx ON analysis_runs (best_signal_candidate_id);
