import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, commitmentLeaf, merkleRoot, merkleTree, verifyMerkleProof } from "../lib/privacy.mjs";

test("canonical commitments are deterministic and domain separated", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, "x"] }), canonicalJson({ a: [true, "x"], b: 1 }));
  const salt = Buffer.alloc(32, 7);
  const source = commitmentLeaf("QARAU_SOURCE_V1", { id: "src_1" }, salt);
  const analysis = commitmentLeaf("QARAU_ANALYSIS_V1", { id: "src_1" }, salt);
  assert.notEqual(source, analysis);
  assert.equal(merkleRoot([source]), source);
});

test("Merkle tree keeps a private proof for every queued leaf", () => {
  const leaves = [1, 2, 3].map((value) => commitmentLeaf("QARAU_SOURCE_V1", { value }, Buffer.alloc(32, value)));
  const tree = merkleTree(leaves);
  assert.equal(tree.root, merkleRoot(leaves));
  assert.ok(leaves.every((leaf, index) => verifyMerkleProof(leaf, tree.proofs[index], tree.root)));
  assert.equal(verifyMerkleProof(leaves[0], tree.proofs[1], tree.root), false);
});
