import assert from "node:assert/strict";
import test from "node:test";

import { chooseProtectedVersion } from "../api/v1.mjs";

const currentContext = {
  dataset_id: "dataset-1",
  dataset_version: 5,
  normalized_object_key: "normalized/current.jsonl",
  analysis_run_id: "analysis-current",
  report_object_key: "analysis/current/report.json",
  derived_signal_object_key: "analysis/current/signal.jsonl",
  access_policy: {
    delayed: { version_lag: 2, release_seconds: "60" },
  },
};

test("early access keeps the package version and does not query prior artifacts", async () => {
  const pool = { query: async () => assert.fail("early access must not query delayed artifacts") };

  const selected = await chooseProtectedVersion(pool, currentContext, { tier: 1, grantedAt: 0 });

  assert.equal(selected, currentContext);
});

test("delayed access resolves dataset, report and derived artifact from the same prior version", async () => {
  const calls = [];
  const pool = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (calls.length === 1) {
        return { rowCount: 1, rows: [{ id: "version-3", version: 3, normalized_object_key: "normalized/v3.jsonl" }] };
      }
      return {
        rowCount: 1,
        rows: [{
          analysis_run_id: "analysis-v3",
          report_object_key: "analysis/v3/report.json",
          derived_signal_object_key: "analysis/v3/signal.jsonl",
        }],
      };
    },
  };

  const selected = await chooseProtectedVersion(pool, currentContext, { tier: 2, grantedAt: 0 });

  assert.deepEqual(calls.map(({ parameters }) => parameters), [["dataset-1", 3], ["version-3"]]);
  assert.equal(selected.dataset_version, 3);
  assert.equal(selected.normalized_object_key, "normalized/v3.jsonl");
  assert.equal(selected.analysis_run_id, "analysis-v3");
  assert.equal(selected.report_object_key, "analysis/v3/report.json");
  assert.equal(selected.derived_signal_object_key, "analysis/v3/signal.jsonl");
  assert.notEqual(selected.report_object_key, currentContext.report_object_key);
  assert.notEqual(selected.derived_signal_object_key, currentContext.derived_signal_object_key);
});

test("delayed access fails closed when prior-version analysis artifacts are unavailable", async () => {
  const pool = {
    query: async (_sql, parameters) => parameters[0] === "dataset-1"
      ? { rowCount: 1, rows: [{ id: "version-3", version: 3, normalized_object_key: "normalized/v3.jsonl" }] }
      : { rowCount: 0, rows: [] },
  };

  await assert.rejects(
    chooseProtectedVersion(pool, currentContext, { tier: 2, grantedAt: 0 }),
    /delayed_artifacts_unavailable/,
  );
});
