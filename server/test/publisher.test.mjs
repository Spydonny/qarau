import assert from "node:assert/strict";
import test from "node:test";
import { createCommitmentData, createSaleData } from "../signer/publisher.mjs";

test("publisher instruction payloads are fixed-width and reject malformed hashes", () => {
  const commitment = createCommitmentData({ datasetIdHash: "01".repeat(32), version: 2, rawSnapshotHash: "02".repeat(32), normalizedDatasetHash: "03".repeat(32), analysisManifestHash: "04".repeat(32), analysisResultHash: "05".repeat(32), accessPolicyHash: "06".repeat(32), maxSeats: 10, allowedTierMask: 3, delayedVersionLag: 1, delayedReleaseSeconds: 60, grantDurationSeconds: 600 });
  assert.equal(commitment.length, 221);
  assert.equal(createSaleData({ startsAt: 1, endsAt: 2, earlyPriceLamports: 10, delayedPriceLamports: 5, enabledTierMask: 3 }).length, 33);
  assert.throws(() => createCommitmentData({ datasetIdHash: "ff", version: 1 }));
});
