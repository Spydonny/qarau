import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, inTransaction } from "./pool.mjs";
import { migrate } from "./migrate.mjs";

const defaultStatePath = fileURLToPath(new URL("../data/private/qarau-state.enc", import.meta.url));
const defaultKeyPath = fileURLToPath(new URL("../data/private/dev-data-key", import.meta.url));

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function deterministicUuid(scope, legacyId) {
  const bytes = Buffer.from(sha256(`${scope}\0${legacyId}`)).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sourceType(source) {
  if (source.sourceType === "API") return "json_api";
  if (source.sourceType === "CSV" || source.discoveryProvider === "CSV_UPLOAD") return "csv";
  if (source.sourceType === "DOWNLOAD") return "download";
  return "html";
}

function sourceStatus(source) {
  if (source.status === "ARCHIVED" || source.status === "DISABLED") return "disabled";
  if (source.status === "BROKEN") return "broken";
  if (source.status === "TESTED" || source.status === "ACTIVE") return "active";
  if (source.status === "APPROVED") return "approved";
  return "candidate";
}

function legacyUrl(source) {
  const value = source?.private?.normalizedUrl ?? source?.private?.url ?? source?.documentationUrl;
  try { return new URL(value).toString(); } catch { return null; }
}

function encryptLegacyUrl(url, dataKey) {
  if (!Buffer.isBuffer(dataKey) || dataKey.length !== 32) throw new Error("legacy_import_invalid_key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  return Buffer.from(`v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`, "utf8");
}

function assertImportSafety(environment) {
  if (environment.LEGACY_IMPORT_ACK_STOPPED !== "true") throw new Error("legacy_import_requires_stopped_api_acknowledgement");
  if (environment.LEGACY_IMPORT_NETWORK_DISABLED !== "true") throw new Error("legacy_import_requires_network_disabled_acknowledgement");
  if (!environment.LEGACY_BACKUP_REFERENCE) throw new Error("legacy_import_backup_reference_required");
}

export async function readLegacyState({ statePath = process.env.LEGACY_STATE_PATH ?? defaultStatePath, keyPath = process.env.LEGACY_KEY_PATH ?? defaultKeyPath, dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY } = {}) {
  const keyHex = dataEncryptionKey ?? (await readFile(keyPath, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error("legacy_import_invalid_key");
  const encrypted = await readFile(statePath, "utf8");
  const [iv, tag, ciphertext] = encrypted.trim().split(".").map((part) => Buffer.from(part, "base64url"));
  if (iv?.length !== 12 || tag?.length !== 16 || !ciphertext?.length) throw new Error("legacy_import_invalid_state_file");
  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
    decipher.setAuthTag(tag);
    return { state: JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")), statePath: resolve(statePath), dataKey: Buffer.from(keyHex, "hex"), keyReference: dataEncryptionKey ? "DATA_ENCRYPTION_KEY" : `file:${resolve(keyPath)}` };
  } catch {
    throw new Error("legacy_import_state_unreadable");
  }
}

export function buildLegacyImportPlan(state, { statePath = defaultStatePath, keyReference = "unknown", dataKey } = {}) {
  const sources = Array.isArray(state?.sources) ? state.sources : [];
  const tests = Array.isArray(state?.tests) ? state.tests : [];
  const commitments = Array.isArray(state?.commitments) ? state.commitments : [];
  const seenUrlHashes = new Map();
  const sourceRows = [];
  const idMap = [];
  const datasets = [];
  const derivations = [];

  for (const source of sources) {
    const legacyId = String(source?.id ?? "");
    const url = legacyUrl(source);
    if (!legacyId || !url) continue;
    const urlHash = sha256(url);
    const canonicalSourceId = seenUrlHashes.get(urlHash.toString("hex")) ?? deterministicUuid("source", legacyId);
    seenUrlHashes.set(urlHash.toString("hex"), canonicalSourceId);
    idMap.push({ legacyKind: "source", legacyId, newId: canonicalSourceId });
    if (canonicalSourceId !== deterministicUuid("source", legacyId)) continue;
    sourceRows.push({
      id: canonicalSourceId,
      canonicalUrl: url,
      canonicalUrlCiphertext: encryptLegacyUrl(url, dataKey),
      canonicalUrlHash: urlHash,
      domain: new URL(url).hostname,
      title: String(source.name ?? "Legacy source").slice(0, 500),
      description: String(source.measurementDescription ?? "Imported from legacy encrypted state").slice(0, 10_000),
      sourceType: sourceType(source),
      status: sourceStatus(source),
      discoveredAt: source.discoveredAt ?? source.createdAt ?? new Date().toISOString(),
    });
    if (!source.dataset || !Array.isArray(source.dataset.rows)) continue;
    const datasetId = deterministicUuid("dataset", legacyId);
    const rows = source.dataset.rows;
    const rowsHash = sha256(stableJson(rows));
    idMap.push({ legacyKind: "dataset", legacyId, newId: datasetId });
    datasets.push({ id: datasetId, sourceId: canonicalSourceId, name: String(source.name ?? "Legacy dataset").slice(0, 500) });
    derivations.push({ id: deterministicUuid("legacy-derivation", legacyId), datasetId, legacySourceId: legacyId, legacySnapshotId: source.dataset.snapshotId ? String(source.dataset.snapshotId) : null, rows, rowsHash, legacyReportedHash: source.dataset.digest ?? null, qualityMetrics: source.dataset.quality ?? {}, provenance: source.dataset.provenance ?? {} });
  }

  const sourceToDataset = new Map(idMap.filter((row) => row.legacyKind === "dataset").map((row) => [row.legacyId, row.newId]));
  const analysis = tests.filter((item) => item?.id).map((item) => ({ id: deterministicUuid("legacy-analysis", String(item.id)), legacyTestId: String(item.id), datasetId: sourceToDataset.get(String(item.sourceId)) ?? null, payload: item, payloadHash: sha256(stableJson(item)) }));
  const legacyCommitments = commitments.filter((item) => item?.id).map((item) => ({ id: deterministicUuid("legacy-commitment", String(item.id)), legacyCommitmentId: String(item.id), payload: item, payloadHash: sha256(stableJson(item)) }));
  const report = Object.freeze({
    classification: "legacy_recovery_only",
    stateHash: sha256(stableJson(state)).toString("hex"),
    statePathHash: sha256(resolve(statePath)).toString("hex"),
    keyReference,
    counts: { legacySources: sources.length, importableSources: sourceRows.length, sourceAliases: idMap.filter((row) => row.legacyKind === "source").length - sourceRows.length, datasets: datasets.length, legacyDerivedDatasets: derivations.length, legacyUnsealedAnalyses: analysis.length, legacyMemoCommitments: legacyCommitments.length },
    exclusions: { sourceSnapshotsCreated: 0, datasetVersionsCreated: 0, blockchainCommitmentsCreated: 0 },
  });
  return Object.freeze({ sourceRows, idMap, datasets, derivations, analysis, legacyCommitments, report });
}

async function persistPlan(pool, plan, { backupReference }) {
  return inTransaction(pool, async (client) => {
    const importRunId = deterministicUuid("legacy-import-run", plan.report.stateHash);
    await client.query(
      `INSERT INTO legacy_import_runs (id, source_state_hash, source_state_path_hash, key_reference, report)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_state_hash) DO NOTHING`,
      [importRunId, Buffer.from(plan.report.stateHash, "hex"), Buffer.from(plan.report.statePathHash, "hex"), backupReference, plan.report],
    );
    for (const source of plan.sourceRows) {
      await client.query(
        `INSERT INTO sources (id, canonical_url_ciphertext, canonical_url_hash, domain, title, description, source_type, status, discovered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::source_type, $8::source_status, $9)
         ON CONFLICT (id) DO NOTHING`,
        [source.id, source.canonicalUrlCiphertext, source.canonicalUrlHash, source.domain, source.title, source.description, source.sourceType, source.status, source.discoveredAt],
      );
    }
    for (const dataset of plan.datasets) {
      await client.query("INSERT INTO datasets (id, source_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [dataset.id, dataset.sourceId, dataset.name]);
    }
    for (const mapping of plan.idMap) {
      await client.query("INSERT INTO legacy_id_map (legacy_kind, legacy_id, new_id, import_run_id) VALUES ($1, $2, $3, $4) ON CONFLICT (legacy_kind, legacy_id) DO NOTHING", [mapping.legacyKind, mapping.legacyId, mapping.newId, importRunId]);
    }
    for (const row of plan.derivations) {
      await client.query(
        `INSERT INTO legacy_dataset_derivations (id, dataset_id, legacy_source_id, legacy_snapshot_id, classification, legacy_rows, legacy_rows_hash, legacy_reported_hash, quality_metrics, provenance)
         VALUES ($1, $2, $3, $4, 'LEGACY_DERIVED', $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.datasetId, row.legacySourceId, row.legacySnapshotId, row.rows, row.rowsHash, row.legacyReportedHash, row.qualityMetrics, row.provenance],
      );
    }
    for (const row of plan.analysis) {
      await client.query("INSERT INTO legacy_analysis_records (id, dataset_id, legacy_test_id, classification, payload, payload_hash) VALUES ($1, $2, $3, 'LEGACY_UNSEALED', $4, $5) ON CONFLICT (legacy_test_id) DO NOTHING", [row.id, row.datasetId, row.legacyTestId, row.payload, row.payloadHash]);
    }
    for (const row of plan.legacyCommitments) {
      await client.query("INSERT INTO legacy_commitment_records (id, legacy_commitment_id, classification, payload, payload_hash) VALUES ($1, $2, 'LEGACY_MEMO_UNVERIFIED', $3, $4) ON CONFLICT (legacy_commitment_id) DO NOTHING", [row.id, row.legacyCommitmentId, row.payload, row.payloadHash]);
    }
    return { importRunId, ...plan.report };
  });
}

export async function importLegacy({ environment = process.env, dryRun = true } = {}) {
  assertImportSafety(environment);
  const legacy = await readLegacyState();
  const plan = buildLegacyImportPlan(legacy.state, legacy);
  if (dryRun) return { dryRun: true, ...plan.report };
  const pool = createPool(environment.DATABASE_URL);
  try {
    await migrate(pool);
    return { dryRun: false, ...(await persistPlan(pool, plan, { backupReference: environment.LEGACY_BACKUP_REFERENCE })) };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dryRun = !process.argv.includes("--apply");
  const result = await importLegacy({ dryRun });
  console.log(JSON.stringify(result));
}
