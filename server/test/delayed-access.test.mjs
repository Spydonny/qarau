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

function matchShallow(doc, filter) {
  return Object.entries(filter ?? {}).every(([key, cond]) => {
    if (cond && typeof cond === "object" && "$lte" in cond) return doc[key] <= cond.$lte;
    if (cond && typeof cond === "object" && "$in" in cond) return cond.$in.includes(doc[key]);
    return doc[key] === cond;
  });
}

function fakeDb(tables, onQuery = null) {
  return {
    collection: (name) => ({
      find: (filter = {}) => {
        if (onQuery) onQuery(name, filter);
        let rows = (tables[name] ?? []).filter((doc) => matchShallow(doc, filter));
        const cursor = {
          sort: (spec) => {
            const [[key, dir]] = Object.entries(spec);
            rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir);
            return cursor;
          },
          skip: (n) => { rows = rows.slice(n); return cursor; },
          limit: (n) => { rows = rows.slice(0, n); return cursor; },
          toArray: async () => rows.map((doc) => ({ ...doc })),
        };
        return cursor;
      },
    }),
  };
}

test("early access keeps the package version and does not query prior artifacts", async () => {
  const db = { collection: () => assert.fail("early access must not query delayed artifacts") };

  const selected = await chooseProtectedVersion(db, currentContext, { tier: 1, grantedAt: 0 });

  assert.equal(selected, currentContext);
});

const versionRow = { _id: "version-3", dataset_id: "dataset-1", version: 3, status: "sealed", normalized_object_key: "normalized/v3.jsonl", normalized_hash: "v3hash" };
const runRow = { _id: "analysis-v3", dataset_version_id: "version-3", status: "completed", blocking_leakage: false, report_object_key: "analysis/v3/report.json", result_hash: "r3", completed_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" };
const signalRow = { _id: "sig-1", analysis_run_id: "analysis-v3", artifact_object_key: "analysis/v3/signal.jsonl" };

test("delayed access resolves dataset, report and derived artifact from the same prior version", async () => {
  const seen = [];
  const db = fakeDb(
    { dataset_versions: [versionRow], analysis_runs: [runRow], signal_candidates: [signalRow] },
    (name, filter) => seen.push({ name, filter }),
  );

  const selected = await chooseProtectedVersion(db, currentContext, { tier: 2, grantedAt: 0 });

  assert.deepEqual(seen.map(({ name }) => name), ["dataset_versions", "analysis_runs", "signal_candidates"]);
  assert.equal(selected.dataset_version, 3);
  assert.equal(selected.normalized_object_key, "normalized/v3.jsonl");
  assert.equal(selected.analysis_run_id, "analysis-v3");
  assert.equal(selected.report_object_key, "analysis/v3/report.json");
  assert.equal(selected.derived_signal_object_key, "analysis/v3/signal.jsonl");
  assert.notEqual(selected.report_object_key, currentContext.report_object_key);
  assert.notEqual(selected.derived_signal_object_key, currentContext.derived_signal_object_key);
});

test("delayed access fails closed when prior-version analysis artifacts are unavailable", async () => {
  const db = fakeDb({ dataset_versions: [versionRow], analysis_runs: [], signal_candidates: [] });

  await assert.rejects(
    chooseProtectedVersion(db, currentContext, { tier: 2, grantedAt: 0 }),
    /delayed_artifacts_unavailable/,
  );
});
