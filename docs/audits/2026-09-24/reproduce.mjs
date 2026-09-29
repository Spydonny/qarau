// Diagnostic assertions intentionally confirm the audited defects, not desired behavior.
// Uses synthetic data and a loopback HTTP server; no real DB, wallet, or RPC calls.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createV1Router } from '../../../server/api/v1.mjs';
import { createAnalysisRunHandler } from '../../../server/jobs/handlers/analysis-run.mjs';
import { constructSignals, evaluateSignal } from '../../../server/analysis/quantitative.mjs';
import { aiSafeRepresentation } from '../../../server/analyzers/index.mjs';
import { loadServiceConfig } from '../../../server/runtime/config.mjs';
import { initOwner, registerAuthRoutes } from '../../../server/auth.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const hash = Buffer.alloc(32, 1);
let savedPackage;
let jobWrites = 0;
const pool = { async query(sql, args = []) {
  const rows = (() => {
    if (sql.startsWith('SELECT * FROM analysis_runs')) return [{ id, status: 'completed', dataset_version_id: id, manifest_hash: hash, result_hash: hash, alpha_score: 65 }];
    if (sql.startsWith('SELECT * FROM dataset_versions')) return [{ id, dataset_id: id, source_snapshot_id: id, normalized_hash: hash }];
    if (sql.startsWith('SELECT * FROM source_snapshots')) return [{ raw_hash: hash }];
    if (sql.startsWith('SELECT title, description')) return [{ title: 'PRIVATE SOURCE XYZ', description: 'Private source description https://private-source.example/data', license_status: 'approved', redistribution_rights: true }];
    if (sql.startsWith('SELECT * FROM dataset_packages WHERE analysis_run_id')) return [];
    if (sql.startsWith('SELECT * FROM dataset_packages WHERE id')) return [savedPackage];
    if (sql.startsWith('INSERT INTO dataset_packages')) {
      const columns = sql.match(/\(([^)]+)\)/)[1].split(', ');
      savedPackage = Object.fromEntries(columns.map((column, i) => [column, args[i]]));
      return [savedPackage];
    }
    if (sql.startsWith('SELECT id FROM access_rounds') || sql.startsWith('SELECT * FROM jobs') || sql.startsWith('SELECT payload FROM jobs')) return [];
    if (sql.startsWith('INSERT INTO jobs')) { jobWrites++; return []; }
    if (sql.startsWith('SELECT package.*, commitment.dataset_pda')) return [{ ...savedPackage, status: 'committed', dataset_pda: 'synthetic', round_pda: 'synthetic', commitment_network: 'devnet', commitment_confirmation_status: 'finalized', commitment_chain_state_source: 'rpc_verified', round_network: 'devnet', round_confirmation_status: 'finalized', round_chain_state_source: 'rpc_verified' }];
    throw new Error(`unexpected_mock_query:${sql.slice(0, 70)}`);
  })();
  return { rows, rowCount: rows.length };
}};
const app = express();
app.use(express.json());
app.use('/api/v1', createV1Router({ pool, artifactStore: { async putOnce() {} }, solana: { rpcUrl: 'https://api.devnet.solana.com', programId: 'unused' }, ownerMiddleware: (_req, _res, next) => next(), csrfMiddleware: (_req, _res, next) => next() }));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
try {
  const sealed = await fetch(`${base}/analysis-runs/${id}/packages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(sealed.status, 201);
  const listed = await (await fetch(`${base}/opportunities`)).json();
  assert.equal(listed.packages[0].title, 'PRIVATE SOURCE XYZ');
  assert.match(listed.packages[0].description, /private-source.example/);
  assert.equal(listed.packages[0].validation_summary.analysis_run_id, id);
  console.log('CONFIRMED: private source title, description and analysis ID reach public projection');
  const published = await fetch(`${base}/packages/${savedPackage.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(published.status, 400);
  assert.equal((await published.json()).error, 'unsupported_job_payload_version');
  assert.equal(jobWrites, 0);
  console.log('CONFIRMED: publish HTTP 400 before any job insert');
} finally { await new Promise(resolve => server.close(resolve)); }

for (const status of ['running', 'failed']) {
  const handler = createAnalysisRunHandler({ pool: { async query() { return { rows: [{ id, status }], rowCount: 1 }; } }, artifactStore: {} });
  await assert.rejects(handler({ payload: { analysisRunId: id } }), /analysis_run_not_queued/);
}
console.log('CONFIRMED: redelivery cannot resume running or failed analysis');

const safe = aiSafeRepresentation({ private: { summary: 'PRIVATE SOURCE XYZ https://private-source.example/data' }, sensitivityMode: 'PUBLIC_SOURCE' });
assert.match(safe.sourceText, /private-source.example/);
console.log('CONFIRMED: AI-safe representation retains identifying free text');

const dates = Array.from({ length: 5 }, (_, i) => new Date(Date.UTC(2024, 0, i + 1)).toISOString());
const signals = constructSignals(dates.map((timestamp, i) => ({ timestamp, available_at: i === 0 ? dates[4] : timestamp, values: { value: i + 1 } })), { rollingWindows: [2] });
const delta = signals.find(x => x.transformation === 'delta_change').rows[0];
assert.equal(delta.timestamp, dates[1]);
assert.equal(delta.availableAt, dates[1]);
assert.equal(delta.value, 1);
console.log('CONFIRMED: derived value is marked available before one of its inputs');

const rows = Array.from({ length: 200 }, (_, i) => ({ timestamp: new Date(Date.UTC(2024, 0, i + 1)).toISOString(), availableAt: new Date(Date.UTC(2024, 0, i + 1)).toISOString(), value: Math.sin(i * 1.7) }));
let price = 100;
const marketRows = rows.map((row, i) => { if (i) price *= 1 + .005 * (rows[i - 1].value + Math.cos(i * 2.3)); return { timestamp: row.timestamp, price }; });
const evaluation = sign => evaluateSignal({ signal: { field: 'value', transformation: 'delta_change', rows: rows.map(row => ({ ...row, value: row.value * sign })) }, marketRows, lag: 0, horizon: 1 });
const positive = evaluation(1), negative = evaluation(-1);
const score = result => result.alpha.components.find(x => x.component === 'out_of_sample').normalized_score;
assert.equal(positive.validation.orientation, 1);
assert.equal(negative.validation.orientation, -1);
assert.ok(Math.abs(positive.validation.splits[2].information_coefficient - negative.validation.splits[2].information_coefficient) < 1e-9);
assert.ok(score(positive) > 90 && score(negative) === 0);
console.log(`CONFIRMED: equivalent oriented strategies score ${score(positive)} versus ${score(negative)} on holdout`);

const config = loadServiceConfig('publisher-signer', { SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com/?devnet', SOLANA_PROGRAM_ID: '63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw', PUBLISHER_SIGNER_TOKEN: 'synthetic-token-123456', SOLANA_PUBLISHER_KEY_PATH: '/synthetic/key.json' });
assert.match(config.values.SOLANA_RPC_URL, /mainnet-beta/);
console.log('CONFIRMED: mainnet hostname with devnet query passes network validation (no network request made)');

// This synthetic digest avoids reading or modifying the operator's credential.
process.env.OWNER_PASSWORD_HASH = '00';
await initOwner();
const authApp = express();
authApp.set('trust proxy', 1);
authApp.use(express.json());
registerAuthRoutes(authApp);
const authServer = authApp.listen(0, '127.0.0.1');
await once(authServer, 'listening');
try {
  const login = `http://127.0.0.1:${authServer.address().port}/api/auth/login`;
  const attempt = forwarded => fetch(login, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': forwarded }, body: '{"password":"wrong"}' });
  for (let i = 0; i < 5; i++) assert.equal((await attempt('198.51.100.1')).status, 401);
  assert.equal((await attempt('198.51.100.1')).status, 429);
  assert.equal((await attempt('198.51.100.2')).status, 401);
  console.log('CONFIRMED: changing client-supplied X-Forwarded-For bypasses login lockout on direct API access');
} finally { await new Promise(resolve => authServer.close(resolve)); }
