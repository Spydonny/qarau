-- Chain-derived rows must carry provenance. Public Devnet APIs only trust
-- rows written after RPC/finality verification; local demo fixtures remain
-- queryable for development but can never masquerade as chain state.
ALTER TABLE blockchain_commitments
  ADD COLUMN chain_state_source text NOT NULL DEFAULT 'unverified'
  CHECK (chain_state_source IN ('rpc_verified', 'synthetic_demo', 'unverified'));

ALTER TABLE access_rounds
  ADD COLUMN chain_state_source text NOT NULL DEFAULT 'unverified'
  CHECK (chain_state_source IN ('rpc_verified', 'synthetic_demo', 'unverified'));

UPDATE blockchain_commitments
SET chain_state_source = CASE
  WHEN decoded_account->>'demo_seed' = 'true' THEN 'synthetic_demo'
  WHEN network = 'devnet' AND confirmation_status = 'finalized' AND verified_at IS NOT NULL THEN 'rpc_verified'
  ELSE 'unverified'
END;

UPDATE access_rounds
SET chain_state_source = CASE
  WHEN decoded_state->>'demo_seed' = 'true' THEN 'synthetic_demo'
  WHEN network = 'devnet' AND confirmation_status = 'finalized' AND last_reconciled_at IS NOT NULL THEN 'rpc_verified'
  ELSE 'unverified'
END;

CREATE INDEX blockchain_commitments_public_chain_idx
  ON blockchain_commitments (package_id)
  WHERE network = 'devnet' AND confirmation_status = 'finalized' AND chain_state_source = 'rpc_verified';

CREATE INDEX access_rounds_public_chain_idx
  ON access_rounds (package_id)
  WHERE network = 'devnet' AND confirmation_status = 'finalized' AND chain_state_source = 'rpc_verified';
