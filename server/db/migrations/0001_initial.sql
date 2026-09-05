CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE source_type AS ENUM ('html', 'json_api', 'csv', 'download');
CREATE TYPE source_status AS ENUM ('candidate', 'approved', 'active', 'broken', 'disabled');
CREATE TYPE license_status AS ENUM ('unknown', 'review_required', 'approved', 'rejected');
CREATE TYPE ingestion_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE ingestion_change_type AS ENUM ('initial', 'new_records', 'changed_records', 'no_change', 'broken');
CREATE TYPE dataset_version_status AS ENUM ('allocated', 'normalizing', 'uploading', 'stored', 'sealed', 'failed');
CREATE TYPE mapping_status AS ENUM ('proposed', 'approved', 'rejected');
CREATE TYPE analysis_status AS ENUM ('queued', 'running', 'completed', 'rejected', 'failed');
CREATE TYPE validation_split AS ENUM ('train', 'validation', 'test', 'regime');
CREATE TYPE leakage_check_type AS ENUM ('look_ahead', 'timestamp_alignment', 'sample_size', 'instantaneous_strength', 'duplicate_information', 'missingness_stability');
CREATE TYPE check_status AS ENUM ('pass', 'warn', 'block');
CREATE TYPE package_status AS ENUM ('draft', 'sealed', 'commit_pending', 'committed', 'publication_failed');
CREATE TYPE job_status AS ENUM ('queued', 'running', 'retry_wait', 'completed', 'failed', 'dead_letter');
CREATE TYPE pipeline_stage AS ENUM ('discovery', 'fetch', 'parse', 'normalize', 'signal', 'screen', 'validate', 'package', 'chain_publish', 'reconcile');
CREATE TYPE chain_confirmation_status AS ENUM ('processed', 'confirmed', 'finalized', 'failed');

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url_ciphertext bytea NOT NULL,
  canonical_url_hash bytea NOT NULL UNIQUE CHECK (octet_length(canonical_url_hash) = 32),
  domain text NOT NULL,
  title text,
  description text,
  source_type source_type NOT NULL,
  expected_fields jsonb NOT NULL DEFAULT '[]',
  temporal_coverage jsonb NOT NULL DEFAULT '{}',
  expected_update_interval interval,
  status source_status NOT NULL DEFAULT 'candidate',
  reliability jsonb NOT NULL DEFAULT '{}',
  last_successful_ingestion_at timestamptz,
  next_scrape_at timestamptz,
  license_status license_status NOT NULL DEFAULT 'unknown',
  redistribution_rights boolean,
  derivative_rights boolean,
  license_evidence_object_key text,
  license_evidence_hash bytea CHECK (license_evidence_hash IS NULL OR octet_length(license_evidence_hash) = 32),
  license_reviewed_by uuid,
  license_reviewed_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  provider text NOT NULL,
  query text NOT NULL,
  result_rank integer NOT NULL CHECK (result_rank > 0),
  result_url_hash bytea NOT NULL CHECK (octet_length(result_url_hash) = 32),
  provider_payload_hash bytea NOT NULL CHECK (octet_length(provider_payload_hash) = 32),
  discovered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload_version integer NOT NULL CHECK (payload_version > 0),
  payload jsonb NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  idempotency_key text NOT NULL UNIQUE,
  resource_type text,
  resource_id uuid,
  progress jsonb NOT NULL DEFAULT '{}',
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  result jsonb,
  error_code text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX jobs_claim_idx ON jobs (available_at, created_at) WHERE status IN ('queued', 'retry_wait');
CREATE INDEX jobs_lease_idx ON jobs (lease_until) WHERE status = 'running';

CREATE TABLE ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  job_id uuid UNIQUE REFERENCES jobs(id),
  status ingestion_status NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  started_at timestamptz,
  retrieved_at timestamptz,
  source_timestamp timestamptz,
  finished_at timestamptz,
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  result_status text,
  response_headers jsonb NOT NULL DEFAULT '{}',
  content_type text,
  content_length bigint CHECK (content_length IS NULL OR content_length >= 0),
  content_hash bytea CHECK (content_hash IS NULL OR octet_length(content_hash) = 32),
  raw_object_key text,
  parser_name text,
  parser_version text,
  record_count integer CHECK (record_count IS NULL OR record_count >= 0),
  change_type ingestion_change_type,
  previous_run_id uuid REFERENCES ingestion_runs(id),
  error_code text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  ingestion_run_id uuid NOT NULL UNIQUE REFERENCES ingestion_runs(id),
  raw_object_key text NOT NULL UNIQUE,
  raw_hash bytea NOT NULL CHECK (octet_length(raw_hash) = 32),
  retrieval_timestamp timestamptz NOT NULL,
  source_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL UNIQUE REFERENCES sources(id),
  name text NOT NULL,
  semantic_schema jsonb NOT NULL DEFAULT '{}',
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  source_snapshot_id uuid NOT NULL UNIQUE REFERENCES source_snapshots(id),
  version integer NOT NULL CHECK (version > 0),
  status dataset_version_status NOT NULL DEFAULT 'allocated',
  normalized_object_key text,
  normalized_hash bytea CHECK (normalized_hash IS NULL OR octet_length(normalized_hash) = 32),
  schema_profile jsonb NOT NULL DEFAULT '{}',
  quality_metrics jsonb NOT NULL DEFAULT '{}',
  coverage_start timestamptz,
  coverage_end timestamptz,
  frequency text,
  record_count integer CHECK (record_count IS NULL OR record_count >= 0),
  missing_rate numeric CHECK (missing_rate IS NULL OR missing_rate BETWEEN 0 AND 1),
  duplicate_rate numeric CHECK (duplicate_rate IS NULL OR duplicate_rate BETWEEN 0 AND 1),
  outlier_rate numeric CHECK (outlier_rate IS NULL OR outlier_rate BETWEEN 0 AND 1),
  continuity numeric CHECK (continuity IS NULL OR continuity BETWEEN 0 AND 1),
  normalizer_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz,
  UNIQUE (dataset_id, version),
  CHECK (coverage_end IS NULL OR coverage_start IS NULL OR coverage_end >= coverage_start),
  CHECK (status <> 'sealed' OR (normalized_object_key IS NOT NULL AND normalized_hash IS NOT NULL AND sealed_at IS NOT NULL))
);

CREATE TABLE market_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN ('crypto', 'fx', 'equity', 'etf')),
  provider text NOT NULL,
  calendar text NOT NULL,
  timezone text NOT NULL,
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, symbol)
);

CREATE TABLE dataset_target_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  target_id uuid NOT NULL REFERENCES market_targets(id),
  physical_variable text NOT NULL,
  economic_mechanism text NOT NULL,
  affected_asset text NOT NULL,
  ai_rationale text,
  confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status mapping_status NOT NULL DEFAULT 'proposed',
  mapping_version integer NOT NULL CHECK (mapping_version > 0),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, target_id, mapping_version),
  CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES market_targets(id),
  raw_object_key text NOT NULL UNIQUE,
  normalized_object_key text NOT NULL UNIQUE,
  raw_hash bytea NOT NULL CHECK (octet_length(raw_hash) = 32),
  normalized_hash bytea NOT NULL CHECK (octet_length(normalized_hash) = 32),
  retrieved_at timestamptz NOT NULL,
  coverage_start timestamptz NOT NULL,
  coverage_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_end >= coverage_start)
);

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id),
  market_snapshot_id uuid NOT NULL REFERENCES market_snapshots(id),
  mapping_id uuid NOT NULL REFERENCES dataset_target_mappings(id),
  status analysis_status NOT NULL DEFAULT 'queued',
  pipeline_version text NOT NULL,
  manifest_object_key text,
  manifest_hash bytea CHECK (manifest_hash IS NULL OR octet_length(manifest_hash) = 32),
  result_object_key text,
  result_hash bytea CHECK (result_hash IS NULL OR octet_length(result_hash) = 32),
  report_object_key text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  alpha_score numeric CHECK (alpha_score IS NULL OR alpha_score BETWEEN 0 AND 100),
  score_version text,
  blocking_leakage boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE signal_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id),
  source_column text NOT NULL,
  transformation text NOT NULL,
  window_size integer CHECK (window_size IS NULL OR window_size > 0),
  lag integer NOT NULL CHECK (lag >= 0),
  horizon integer NOT NULL CHECK (horizon > 0),
  artifact_object_key text,
  artifact_hash bytea CHECK (artifact_hash IS NULL OR octet_length(artifact_hash) = 32),
  parameters jsonb NOT NULL,
  semantic_fingerprint bytea NOT NULL CHECK (octet_length(semantic_fingerprint) = 32),
  UNIQUE (analysis_run_id, semantic_fingerprint)
);

CREATE TABLE screening_results (
  signal_candidate_id uuid NOT NULL REFERENCES signal_candidates(id),
  target_id uuid NOT NULL REFERENCES market_targets(id),
  horizon integer NOT NULL CHECK (horizon > 0),
  pearson numeric,
  spearman numeric,
  mutual_information numeric,
  lagged_correlation numeric,
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  p_value numeric CHECK (p_value IS NULL OR p_value BETWEEN 0 AND 1),
  q_value numeric CHECK (q_value IS NULL OR q_value BETWEEN 0 AND 1),
  PRIMARY KEY (signal_candidate_id, target_id, horizon)
);

CREATE TABLE validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id),
  signal_candidate_id uuid NOT NULL REFERENCES signal_candidates(id),
  split validation_split NOT NULL,
  regime_name text,
  information_coefficient numeric,
  directional_accuracy numeric,
  return_spread numeric,
  sharpe_like numeric,
  max_drawdown numeric,
  observations integer NOT NULL CHECK (observations >= 0),
  trades integer NOT NULL CHECK (trades >= 0),
  stability numeric,
  sign smallint CHECK (sign IN (-1, 0, 1)),
  metrics jsonb NOT NULL DEFAULT '{}',
  UNIQUE NULLS NOT DISTINCT (analysis_run_id, signal_candidate_id, split, regime_name),
  CHECK ((split = 'regime') = (regime_name IS NOT NULL))
);

CREATE TABLE leakage_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id),
  signal_candidate_id uuid REFERENCES signal_candidates(id),
  check_type leakage_check_type NOT NULL,
  status check_status NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  score_penalty numeric NOT NULL DEFAULT 0 CHECK (score_penalty BETWEEN 0 AND 100),
  explanation text NOT NULL,
  UNIQUE NULLS NOT DISTINCT (analysis_run_id, signal_candidate_id, check_type)
);

CREATE TABLE alpha_score_components (
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id),
  component text NOT NULL,
  raw_value numeric NOT NULL,
  normalized_score numeric NOT NULL CHECK (normalized_score BETWEEN 0 AND 100),
  weight numeric NOT NULL CHECK (weight BETWEEN 0 AND 1),
  penalty numeric NOT NULL DEFAULT 0 CHECK (penalty BETWEEN 0 AND 100),
  explanation text NOT NULL,
  PRIMARY KEY (analysis_run_id, component)
);

CREATE TABLE dataset_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id),
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id),
  status package_status NOT NULL DEFAULT 'draft',
  public_metadata jsonb NOT NULL,
  private_metadata_object_key text,
  access_policy jsonb NOT NULL,
  access_policy_object_key text,
  access_policy_hash bytea NOT NULL CHECK (octet_length(access_policy_hash) = 32),
  max_seats integer NOT NULL CHECK (max_seats > 0),
  raw_snapshot_hash bytea NOT NULL CHECK (octet_length(raw_snapshot_hash) = 32),
  normalized_dataset_hash bytea NOT NULL CHECK (octet_length(normalized_dataset_hash) = 32),
  analysis_manifest_hash bytea NOT NULL CHECK (octet_length(analysis_manifest_hash) = 32),
  analysis_result_hash bytea NOT NULL CHECK (octet_length(analysis_result_hash) = 32),
  sealed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_version_id, analysis_run_id),
  CHECK (status = 'draft' OR sealed_at IS NOT NULL)
);

CREATE TABLE blockchain_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL UNIQUE REFERENCES dataset_packages(id),
  network text NOT NULL CHECK (network IN ('localnet', 'devnet')),
  program_id text NOT NULL,
  dataset_pda text NOT NULL UNIQUE,
  transaction_signature text UNIQUE,
  slot bigint CHECK (slot IS NULL OR slot >= 0),
  confirmation_status chain_confirmation_status NOT NULL DEFAULT 'processed',
  decoded_account jsonb,
  verified_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL UNIQUE REFERENCES dataset_packages(id),
  sale_pda text NOT NULL UNIQUE,
  decoded_state jsonb NOT NULL DEFAULT '{}',
  observed_slot bigint CHECK (observed_slot IS NULL OR observed_slot >= 0),
  confirmation_status chain_confirmation_status NOT NULL DEFAULT 'processed',
  stale_after timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz
);

CREATE TABLE wallet_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash bytea NOT NULL UNIQUE CHECK (octet_length(nonce_hash) = 32),
  expected_address text,
  domain text NOT NULL,
  uri text NOT NULL,
  chain_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);

CREATE TABLE wallet_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  wallet_id uuid NOT NULL REFERENCES user_wallets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  CHECK (absolute_expires_at >= idle_expires_at)
);

CREATE TABLE access_grant_cache (
  grant_pda text PRIMARY KEY,
  package_id uuid NOT NULL REFERENCES dataset_packages(id),
  wallet_id uuid NOT NULL REFERENCES user_wallets(id),
  tier text NOT NULL CHECK (tier IN ('exclusive_early', 'delayed')),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  transaction_signature text NOT NULL,
  slot bigint NOT NULL CHECK (slot >= 0),
  last_reconciled_at timestamptz NOT NULL,
  UNIQUE (package_id, wallet_id)
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_signature text NOT NULL UNIQUE,
  package_id uuid NOT NULL REFERENCES dataset_packages(id),
  sale_pda text NOT NULL,
  commitment_pda text NOT NULL,
  grant_pda text NOT NULL,
  wallet_id uuid NOT NULL REFERENCES user_wallets(id),
  tier text NOT NULL CHECK (tier IN ('exclusive_early', 'delayed')),
  expected_lamports bigint NOT NULL CHECK (expected_lamports > 0),
  decoded_lamports bigint CHECK (decoded_lamports IS NULL OR decoded_lamports > 0),
  observed_slot bigint CHECK (observed_slot IS NULL OR observed_slot >= 0),
  finalized_slot bigint CHECK (finalized_slot IS NULL OR finalized_slot >= observed_slot),
  block_time timestamptz,
  confirmation_status chain_confirmation_status NOT NULL DEFAULT 'processed',
  validation_verdict text NOT NULL CHECK (validation_verdict IN ('pending', 'valid', 'invalid')),
  validation_errors jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id text,
  wallet_address text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_id text,
  outcome text NOT NULL,
  ip_hash bytea CHECK (ip_hash IS NULL OR octet_length(ip_hash) = 32),
  user_agent_hash bytea CHECK (user_agent_hash IS NULL OR octet_length(user_agent_hash) = 32),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pipeline_stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  stage pipeline_stage NOT NULL,
  status ingestion_status NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL CHECK (attempt > 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_detail text,
  metrics jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record:%', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER source_snapshots_immutable BEFORE UPDATE OR DELETE ON source_snapshots FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER market_snapshots_immutable BEFORE UPDATE OR DELETE ON market_snapshots FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER purchases_immutable BEFORE UPDATE OR DELETE ON purchases FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION enforce_dataset_version_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'sealed' OR OLD.status = 'failed' THEN
    RAISE EXCEPTION 'terminal_dataset_version:%', OLD.status USING ERRCODE = '55000';
  END IF;
  IF NEW.dataset_id <> OLD.dataset_id OR NEW.source_snapshot_id <> OLD.source_snapshot_id OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'immutable_dataset_version_identity' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'allocated' AND NEW.status IN ('normalizing', 'failed')) OR
    (OLD.status = 'normalizing' AND NEW.status IN ('uploading', 'failed')) OR
    (OLD.status = 'uploading' AND NEW.status IN ('stored', 'failed')) OR
    (OLD.status = 'stored' AND NEW.status IN ('sealed', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid_dataset_version_transition:%->%', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER dataset_version_transition BEFORE UPDATE ON dataset_versions FOR EACH ROW EXECUTE FUNCTION enforce_dataset_version_transition();

CREATE INDEX sources_due_idx ON sources (next_scrape_at) WHERE status = 'active';
CREATE INDEX ingestion_runs_source_idx ON ingestion_runs (source_id, created_at DESC);
CREATE INDEX dataset_versions_dataset_idx ON dataset_versions (dataset_id, version DESC);
CREATE INDEX analysis_runs_version_idx ON analysis_runs (dataset_version_id, created_at DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id, created_at DESC);
