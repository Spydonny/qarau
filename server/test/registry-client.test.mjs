import assert from "node:assert/strict";
import test from "node:test";
import { deriveAccessEntitlementPda, deriveAccessGrantPda, deriveAccessRoundPda, deriveBidPda, deriveDatasetCommitmentPda, deriveSalePda, placeBidInstructionData, purchaseInstructionData } from "../solana/registry-client.mjs";

const program = "63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw";
test("registry PDAs and purchase bytes are deterministic", async () => {
  const commitment = await deriveDatasetCommitmentPda(program, Buffer.alloc(32, 7), 2);
  const sale = await deriveSalePda(program, commitment);
  const grant = await deriveAccessGrantPda(program, sale, "11111111111111111111111111111111");
  assert.match(commitment, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.match(sale, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.match(grant, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(purchaseInstructionData(1).length, 9);
  assert.throws(() => purchaseInstructionData(3));
});

test("access-round, bid and entitlement PDAs use distinct deterministic domains", async () => {
  const commitment = await deriveDatasetCommitmentPda(program, Buffer.alloc(32, 9), 4);
  const round = await deriveAccessRoundPda(program, commitment);
  const wallet = "11111111111111111111111111111111";
  const bid = await deriveBidPda(program, round, wallet);
  const entitlement = await deriveAccessEntitlementPda(program, round, wallet);
  assert.notEqual(round, bid);
  assert.notEqual(bid, entitlement);
  assert.equal(placeBidInstructionData(1_000_000, 1).length, 17);
  assert.throws(() => placeBidInstructionData(0, 1));
  assert.throws(() => placeBidInstructionData(1_000_000, 3));
});
