import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyImportPlan } from "../db/import-legacy.mjs";

test("legacy import preserves recovery evidence without fabricating canonical artifacts", () => {
  const plan = buildLegacyImportPlan({
    sources: [{ id: "src_old", name: "Legacy weather", sourceType: "API", status: "TESTED", private: { url: "https://example.test/weather" }, dataset: { snapshotId: "snapshot_old", digest: "legacy-sha256", rows: [{ timestamp: "2025-01-01T00:00:00.000Z", value: 4 }], quality: { warnings: [] }, provenance: { provider: "legacy" } } }],
    tests: [{ id: "test_old", sourceId: "src_old", alpha: 12 }],
    commitments: [{ id: "memo_old", status: "CONFIRMED" }],
  }, { dataKey: Buffer.alloc(32, 7) });
  assert.equal(plan.sourceRows[0].sourceType, "json_api");
  assert.equal(plan.sourceRows[0].status, "active");
  assert.equal(plan.derivations[0].legacyReportedHash, "legacy-sha256");
  assert.equal(plan.analysis[0].legacyTestId, "test_old");
  assert.equal(plan.report.counts.legacyDerivedDatasets, 1);
  assert.deepEqual(plan.report.exclusions, { sourceSnapshotsCreated: 0, datasetVersionsCreated: 0, blockchainCommitmentsCreated: 0 });
});
