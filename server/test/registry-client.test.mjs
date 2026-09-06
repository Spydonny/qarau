import assert from "node:assert/strict";
import test from "node:test";
import { deriveAccessGrantPda, deriveDatasetCommitmentPda, deriveSalePda, purchaseInstructionData } from "../solana/registry-client.mjs";

const program = "5n92bg5CrZrt956eXmakgAiqesbfFav7mdNqsfk8Ex3u";
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
