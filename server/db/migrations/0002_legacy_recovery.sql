CREATE TABLE legacy_import_runs (
  id uuid PRIMARY KEY,
  source_state_hash bytea NOT NULL UNIQUE CHECK (octet_length(source_state_hash) = 32),
  source_state_path_hash bytea NOT NULL CHECK (octet_length(source_state_path_hash) = 32),
  key_reference text NOT NULL,
  report jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legacy_id_map (
  legacy_kind text NOT NULL,
  legacy_id text NOT NULL,
  new_id uuid NOT NULL,
  import_run_id uuid NOT NULL REFERENCES legacy_import_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (legacy_kind, legacy_id)
);

CREATE TABLE legacy_dataset_derivations (
  id uuid PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  legacy_source_id text NOT NULL,
  legacy_snapshot_id text,
  classification text NOT NULL CHECK (classification = 'LEGACY_DERIVED'),
  legacy_rows jsonb NOT NULL,
  legacy_rows_hash bytea NOT NULL CHECK (octet_length(legacy_rows_hash) = 32),
  legacy_reported_hash text,
  quality_metrics jsonb NOT NULL DEFAULT '{}',
  provenance jsonb NOT NULL DEFAULT '{}',
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, legacy_rows_hash)
);

CREATE TABLE legacy_analysis_records (
  id uuid PRIMARY KEY,
  dataset_id uuid REFERENCES datasets(id),
  legacy_test_id text NOT NULL UNIQUE,
  classification text NOT NULL CHECK (classification = 'LEGACY_UNSEALED'),
  payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legacy_commitment_records (
  id uuid PRIMARY KEY,
  legacy_commitment_id text NOT NULL UNIQUE,
  classification text NOT NULL CHECK (classification = 'LEGACY_MEMO_UNVERIFIED'),
  payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  imported_at timestamptz NOT NULL DEFAULT now()
);
