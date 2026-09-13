import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveredView } from "../domain/delivered-view.mjs";

test("delivered view reads the chronological test split and actual selected hashes", () => {
  const context = {
    id: "pkg-1",
    public_metadata: { title: "Water signal" },
    program_id: "program",
    dataset_pda: "commitment",
    normalized_dataset_hash: Buffer.alloc(32, 7),
    analysis_result_hash: Buffer.alloc(32, 9),
  };
  const report = { best: { validation: { splits: [
    { split: "train", information_coefficient: 0.8 },
    { split: "test", information_coefficient: 0.12, sharpe_like: 1.7, directional_accuracy: 0.625, trades: 8 },
  ] } } };
  const bytes = Buffer.from('{"timestamp":"2026-01-01","available_at":"2026-01-02","values":{"flow":"42"}}\n');
  const view = buildDeliveredView({ context, grant: { entitlementPda: "entitlement" }, bytes, reportBytes: Buffer.from(JSON.stringify(report)), proofVerified: true });
  assert.equal(view.summary.information_coefficient, 0.12);
  assert.equal(view.summary.sharpe_like, 1.7);
  assert.equal(view.summary.hit_rate_pct, 62.5);
  assert.equal(view.summary.traded_days, 8);
  assert.equal(view.summary.publication_lag_hours, 24);
  assert.equal(view.proof.normalized_dataset_hash, "07".repeat(32));
  assert.equal(view.proof.result_hash, "09".repeat(32));
  assert.equal(view.proof.verified, true);
  assert.equal("cumulative_pct" in view.rows[0], false);
  assert.equal(view.download_url, "/api/v1/dataset/pkg-1/export");
});

test("delivered view never claims verification implicitly", () => {
  const context = { id: "pkg-2", public_metadata: {}, program_id: "program", dataset_pda: "commitment", normalized_dataset_hash: Buffer.alloc(32), analysis_result_hash: Buffer.alloc(32) };
  const view = buildDeliveredView({ context, grant: { entitlementPda: "entitlement" }, bytes: Buffer.from('{"timestamp":"2026-01-01","values":{"x":"1"}}\n'), reportBytes: Buffer.from("{}") });
  assert.equal(view.proof.verified, false);
});
