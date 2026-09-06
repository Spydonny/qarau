CREATE TABLE source_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL UNIQUE REFERENCES sources(id),
  gates jsonb NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 10),
  passed boolean NOT NULL,
  rejection_reasons text[] NOT NULL DEFAULT '{}',
  screened_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(gates) = 'object')
);

CREATE TABLE access_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL UNIQUE REFERENCES dataset_packages(id),
  network text NOT NULL CHECK (network IN ('localnet', 'devnet')),
  program_id text NOT NULL,
  round_pda text NOT NULL UNIQUE,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  minimum_bid_lamports bigint NOT NULL CHECK (minimum_bid_lamports > 0),
  max_winners integer NOT NULL CHECK (max_winners BETWEEN 1 AND 10),
  enabled_tier_mask integer NOT NULL CHECK (enabled_tier_mask BETWEEN 1 AND 3),
  settlement_rule text NOT NULL CHECK (settlement_rule = 'top_n_pay_as_bid'),
  state text NOT NULL CHECK (state IN ('upcoming', 'live', 'ended', 'settled', 'access_granted', 'expired')),
  bid_count integer NOT NULL DEFAULT 0 CHECK (bid_count BETWEEN 0 AND 32),
  winners_count integer NOT NULL DEFAULT 0 CHECK (winners_count BETWEEN 0 AND 10),
  clearing_price_lamports bigint CHECK (clearing_price_lamports IS NULL OR clearing_price_lamports > 0),
  transaction_signature text UNIQUE,
  slot bigint CHECK (slot IS NULL OR slot >= 0),
  confirmation_status chain_confirmation_status NOT NULL DEFAULT 'processed',
  decoded_state jsonb NOT NULL DEFAULT '{}',
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

CREATE TABLE auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_round_id uuid NOT NULL REFERENCES access_rounds(id),
  bid_pda text NOT NULL UNIQUE,
  wallet_id uuid NOT NULL REFERENCES user_wallets(id),
  amount_lamports bigint NOT NULL CHECK (amount_lamports > 0),
  tier text NOT NULL CHECK (tier IN ('exclusive_early', 'delayed')),
  status text NOT NULL CHECK (status IN ('active', 'winner', 'loser', 'claimed', 'refunded')),
  transaction_signature text NOT NULL UNIQUE,
  observed_slot bigint NOT NULL CHECK (observed_slot >= 0),
  placed_at timestamptz NOT NULL,
  last_reconciled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (access_round_id, wallet_id)
);

CREATE TABLE access_entitlement_cache (
  entitlement_pda text PRIMARY KEY,
  access_round_id uuid NOT NULL REFERENCES access_rounds(id),
  package_id uuid NOT NULL REFERENCES dataset_packages(id),
  wallet_id uuid NOT NULL REFERENCES user_wallets(id),
  tier text NOT NULL CHECK (tier IN ('exclusive_early', 'delayed')),
  bid_amount_lamports bigint NOT NULL CHECK (bid_amount_lamports > 0),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  transaction_signature text NOT NULL UNIQUE,
  slot bigint NOT NULL CHECK (slot >= 0),
  last_reconciled_at timestamptz NOT NULL,
  UNIQUE (access_round_id, wallet_id)
);

CREATE INDEX source_screenings_passed_idx ON source_screenings (passed, screened_at DESC);
CREATE INDEX access_rounds_state_idx ON access_rounds (state, opens_at, closes_at);
CREATE INDEX auction_bids_round_rank_idx ON auction_bids (access_round_id, amount_lamports DESC, placed_at, bid_pda);
CREATE INDEX access_entitlement_wallet_idx ON access_entitlement_cache (wallet_id, status, expires_at);

INSERT INTO source_screenings (source_id, gates, score, passed, rejection_reasons, screened_at)
SELECT id,
       '{"availability":{"status":"pass"},"freshness":{"status":"pass"},"history":{"status":"pass"},"granularity":{"status":"pass"},"coverage":{"status":"pass"},"stability":{"status":"pass"},"cost":{"status":"pass"},"licensing":{"status":"pass"},"uniqueness":{"status":"pass"},"quant_usability":{"status":"pass"}}'::jsonb,
       10,
       true,
       '{}',
       COALESCE(updated_at, discovered_at, now())
FROM sources
WHERE status IN ('approved', 'active')
ON CONFLICT (source_id) DO NOTHING;
