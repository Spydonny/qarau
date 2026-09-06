import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isVerifiedDevnetOpportunity } from "../api/v1.mjs";

const verified = {
  status: "committed",
  dataset_pda: "commitment",
  round_pda: "round",
  commitment_network: "devnet",
  commitment_confirmation_status: "finalized",
  commitment_chain_state_source: "rpc_verified",
  round_network: "devnet",
  round_confirmation_status: "finalized",
  round_chain_state_source: "rpc_verified",
};

test("public opportunities require both commitment and round to be RPC-verified Devnet state", () => {
  assert.equal(isVerifiedDevnetOpportunity(verified), true);
  for (const mutation of [
    { commitment_chain_state_source: "synthetic_demo" },
    { round_chain_state_source: "synthetic_demo" },
    { commitment_chain_state_source: "unverified" },
    { round_chain_state_source: "unverified" },
    { commitment_network: "localnet" },
    { round_network: "localnet" },
    { commitment_confirmation_status: "confirmed" },
    { round_confirmation_status: "processed" },
    { dataset_pda: null },
    { round_pda: null },
  ]) assert.equal(isVerifiedDevnetOpportunity({ ...verified, ...mutation }), false, JSON.stringify(mutation));
});

test("auction demo seed cannot claim finalized Devnet provenance", async () => {
  const seed = await readFile(new URL("../../scripts/seed-auction-demo.sql", import.meta.url), "utf8");
  assert.doesNotMatch(seed, /'devnet'.*'finalized'.*jsonb_build_object\('demo_seed', true\)/);
  assert.match(seed, /'localnet'/);
  assert.match(seed, /'processed', 'synthetic_demo'/);
});
