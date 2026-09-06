-- Removes everything scripts/seed-auction-demo.sql inserted, and nothing else.
-- Selection is by the demo_seed marker, never by id ranges or timestamps.
BEGIN;

DELETE FROM access_entitlement_cache e
 USING access_rounds r
 WHERE e.access_round_id = r.id AND r.decoded_state->>'demo_seed' = 'true';

DELETE FROM auction_bids b
 USING access_rounds r
 WHERE b.access_round_id = r.id AND r.decoded_state->>'demo_seed' = 'true';

DELETE FROM access_rounds WHERE decoded_state->>'demo_seed' = 'true';

DELETE FROM blockchain_commitments WHERE decoded_account->>'demo_seed' = 'true';

DELETE FROM dataset_packages WHERE public_metadata->>'demo_seed' = 'true';

DELETE FROM analysis_runs
 WHERE manifest_object_key LIKE 'analysis/demo%/manifest.json';

DELETE FROM user_wallets w
 WHERE NOT EXISTS (SELECT 1 FROM auction_bids b WHERE b.wallet_id = w.id)
   AND NOT EXISTS (SELECT 1 FROM access_entitlement_cache e WHERE e.wallet_id = w.id)
   AND NOT EXISTS (SELECT 1 FROM wallet_sessions s WHERE s.wallet_id = w.id);

COMMIT;
