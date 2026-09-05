import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAlphaTest } from "./lib/alpha-lab.mjs";
import { canonicalJson, commitmentLeaf, merkleTree, newSalt } from "./lib/privacy.mjs";
import { fetchExternalText, validateExternalUrl } from "./lib/url-policy.mjs";
import { loadMarketTarget, loadSourceDataset, sourceCatalog, targetCatalog } from "./providers/real-data.mjs";
import { commitMerkleRoot } from "./signer/client.mjs";
import { analyzeSource, analyzerConfig } from "./analyzers/index.mjs";
import { discoverCandidates, discoveryProviderOptions } from "./discovery/providers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const statePath = join(here, "data", "private", "qarau-state.enc");
const keyPath = join(here, "data", "private", "dev-data-key");
const MAX_CSV_BYTES = 1_000_000;
const MAX_JSON_BYTES = 2_000_000;
const SCORE_WEIGHTS = Object.freeze({ quality: 0.3, testability: 0.3, economicRelevance: 0.3, novelty: 0.1 });

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function clamp(value) { return Math.max(0, Math.min(100, Math.round(value))); }

async function encryptionKey() {
  const configured = process.env.DATA_ENCRYPTION_KEY;
  if (configured && /^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  await mkdir(dirname(keyPath), { recursive: true });
  try { return Buffer.from((await readFile(keyPath, "utf8")).trim(), "hex"); }
  catch {
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("hex"), { mode: 0o600, flag: "wx" });
    await chmod(keyPath, 0o600).catch(() => {});
    return key;
  }
}

function emptyState() { return { sources: [], datasets: [], targetSnapshots: [], tests: [], commitments: [], claims: [], accessReceipts: [], jobs: [], audits: [], schemaVersion: 3 }; }

class EncryptedStore {
  async init() { this.key = await encryptionKey(); this.state = await this.read(); this.pendingSave = Promise.resolve(); }
  async read() {
    try {
      const [iv, tag, ciphertext] = (await readFile(statePath, "utf8")).trim().split(".").map((part) => Buffer.from(part, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      throw new Error("private_store_unavailable");
    }
  }
  save() {
    this.pendingSave = this.pendingSave.then(() => this.write());
    return this.pendingSave;
  }
  async write() {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.state)), cipher.final()]);
    const record = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
    await mkdir(dirname(statePath), { recursive: true });
    const temp = `${statePath}.${process.pid}.tmp`;
    await writeFile(temp, record, { mode: 0o600 });
    await rename(temp, statePath);
  }
}

export function sanitizeText(value) {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 20_000).trim();
}

export function extractPageMetadata(html) {
  const source = String(html).slice(0, 512_000);
  const title = sanitizeText(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 120);
  const meta = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = source.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"));
    const reversed = source.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"));
    return sanitizeText(direct?.[1] || reversed?.[1] || "").slice(0, 500);
  };
  const description = meta("description") || meta("og:description");
  const provider = meta("og:site_name");
  const text = sanitizeText(source);
  const semanticText = `${description} ${text}`;
  const formats = ["CSV", "JSON", "XML"].filter((format) => new RegExp(`\\b${format}\\b`, "i").test(semanticText));
  return { title, description, provider, text, formats, apiAvailable: /\bAPI\b|application programming interface/i.test(semanticText), historicalDataAvailable: /historical|archive|time[- ]series/i.test(semanticText) };
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell); cell = ""; }
    else cell += character;
  }
  if (quoted) throw new Error("invalid_csv_quotes");
  cells.push(cell);
  return cells;
}

export function parseCsv(csv, valueColumn = "value") {
  if (typeof csv !== "string" || Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES || csv.includes("\0")) throw new Error("invalid_csv");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 3 || lines.length > 50_001) throw new Error("invalid_csv_rows");
  const headers = splitCsvLine(lines.shift()).map((part) => part.trim());
  if (headers.length > 32 || !headers.includes("timestamp") || !headers.includes(valueColumn) || headers.some((header) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(header))) throw new Error("invalid_csv_schema");
  const seen = new Set();
  const rows = lines.map((line) => {
    const values = splitCsvLine(line);
    if (values.length !== headers.length || values.some((value) => value.length > 1_000)) throw new Error("invalid_csv_row");
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
    if (!Number.isFinite(Date.parse(record.timestamp)) || seen.has(record.timestamp)) throw new Error("invalid_csv_timestamp");
    seen.add(record.timestamp);
    const numericColumns = headers.filter((header) => header !== "timestamp" && header !== "available_at");
    const features = Object.fromEntries(numericColumns.map((header) => [header, Number(record[header])]));
    if (Object.values(features).some((value) => !Number.isFinite(value))) throw new Error("invalid_csv_data");
    const availableAt = record.available_at || record.timestamp;
    if (!Number.isFinite(Date.parse(availableAt)) || Date.parse(availableAt) < Date.parse(record.timestamp)) throw new Error("invalid_availability_timestamp");
    return { timestamp: new Date(record.timestamp).toISOString(), value: features[valueColumn], availableAt: new Date(availableAt).toISOString(), features };
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return { rows, featureColumns: headers.filter((header) => !["timestamp", "available_at"].includes(header)) };
}

export function parseJsonRows(payload, { timestampField = "timestamp", valueField = "value", availableAtField = "available_at" } = {}) {
  const items = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(items) || items.length < 2 || items.length > 50_000) throw new Error("invalid_json_rows");
  const seen = new Set();
  return items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("invalid_json_row");
    const timestampValue = Date.parse(item[timestampField]);
    const availableAtValue = Date.parse(item[availableAtField] ?? item[timestampField]);
    const value = Number(item[valueField]);
    if (!Number.isFinite(timestampValue) || !Number.isFinite(availableAtValue) || !Number.isFinite(value) || seen.has(timestampValue) || availableAtValue < timestampValue) throw new Error("invalid_json_data");
    const timestamp = new Date(timestampValue).toISOString();
    const availableAt = new Date(availableAtValue).toISOString();
    seen.add(timestampValue);
    return { timestamp, value, availableAt, features: { [valueField]: value } };
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function datasetQuality(rows) {
  const timestamps = rows.map((row) => Date.parse(row.timestamp));
  const values = rows.map((row) => row.value);
  const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]);
  const medianInterval = intervals.length ? [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const impossibleJumps = values.slice(1).filter((value, index) => deviation && Math.abs(value - values[index]) > deviation * 8).length;
  const uniqueRatio = new Set(values.map((value) => value.toFixed(8))).size / values.length;
  const largeGaps = medianInterval ? intervals.filter((interval) => interval > medianInterval * 5).length : 0;
  const midpoint = Math.floor(values.length / 2);
  const firstMean = meanOrZero(values.slice(0, midpoint));
  const secondMean = meanOrZero(values.slice(midpoint));
  const distributionShift = deviation ? Math.abs(secondMean - firstMean) / deviation : 0;
  const timestampAnomalies = timestamps.filter((timestamp, index) => timestamp > Date.now() + 86_400_000 || (index && timestamp <= timestamps[index - 1])).length;
  const warnings = [];
  if (rows.length < 100) warnings.push("SHORT_HISTORY");
  if (impossibleJumps > Math.max(2, rows.length * 0.01)) warnings.push("ABNORMAL_JUMPS");
  if (uniqueRatio < 0.05) warnings.push("REPEATED_PATTERN");
  if (largeGaps > Math.max(2, intervals.length * 0.05)) warnings.push("LARGE_GAPS");
  if (distributionShift > 1.5) warnings.push("DISTRIBUTION_SHIFT");
  if (timestampAnomalies) warnings.push("TIMESTAMP_ANOMALY");
  if (rows.some((row) => !row.availableAt)) warnings.push("LATENCY_UNVERIFIED");
  return { rowCount: rows.length, missingRatio: 0, duplicateTimestamps: 0, impossibleJumps, repeatedValueRatio: 1 - uniqueRatio, medianIntervalMs: medianInterval, largeGaps, distributionShift, timestampAnomalies, warnings };
}

function meanOrZero(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function score(source) {
  const stats = source.dataset?.quality;
  const depthBonus = stats ? Math.min(30, Math.log10(Math.max(stats.rowCount, 1)) * 12) : 0;
  const quality = clamp(42 + depthBonus + (source.documentationUrl ? 12 : 0) - (stats?.warnings.length ?? 0) * 8);
  const testability = clamp(source.dataset ? 48 + Math.min(42, stats.rowCount / 12) : source.historicalDataAvailable ? 42 : 18);
  const economicRelevance = clamp(({ Energy: 80, Logistics: 82, Mobility: 74, Weather: 65, Pollution: 60, Water: 58 }[source.category] ?? 52) + (source.analysis ? 5 : 0));
  const novelty = clamp({ WORLD_BANK: 25, OPEN_METEO: 42, USGS: 62, MANUAL_API: 68, MANUAL_URL: 55, CSV_UPLOAD: 72 }[source.discoveryProvider] ?? 50);
  return { quality, testability, economicRelevance, novelty, candidate: clamp(quality * SCORE_WEIGHTS.quality + testability * SCORE_WEIGHTS.testability + economicRelevance * SCORE_WEIGHTS.economicRelevance + novelty * SCORE_WEIGHTS.novelty) };
}

export class QarauService {
  constructor() { this.store = new EncryptedStore(); this.scheduler = null; }
  async init() {
    await this.store.init();
    this.store.state = { ...emptyState(), ...this.store.state };
    let changed = false;
    for (const source of this.store.state.sources) {
      if (!source.sensitivityMode) { source.sensitivityMode = "PUBLIC_SOURCE"; changed = true; }
      if (source.discoveryProvider === "SEED" && source.status !== "ARCHIVED") { source.status = "ARCHIVED"; source.archivedReason = "SIMULATED_DATA_REMOVED"; source.dataset = null; changed = true; }
    }
    const knownCatalogKeys = new Set(this.store.state.sources.map((source) => source.private?.catalogKey).filter(Boolean));
    const catalog = await discoverCandidates({ provider: "PUBLIC_CATALOG" });
    const catalogByKey = new Map(catalog.map((entry) => [entry.catalogKey, entry]));
    for (const source of this.store.state.sources) {
      const entry = catalogByKey.get(source.private?.catalogKey);
      if (entry && !source.spatialResolution) { source.spatialResolution = entry.spatialResolution; changed = true; }
    }
    for (const entry of catalog) if (!knownCatalogKeys.has(entry.catalogKey)) { await this.createSource(entry); changed = true; }
    if (changed) await this.persist();
  }
  async persist() { await this.store.save(); }
  audit(action, resourceId, result = "OK") { this.store.state.audits.push({ id: id("audit"), actorId: "owner", action, resourceId, requestId: id("req"), result, timestamp: now() }); }
  job(kind, resourceId, status = "COMPLETE") { const job = { id: id("job"), kind, resourceId, status, progress: status === "COMPLETE" ? 100 : 0, createdAt: now(), startedAt: status === "QUEUED" ? null : now(), finishedAt: status === "COMPLETE" ? now() : null, error: null, result: null }; this.store.state.jobs.unshift(job); return job; }
  async enqueue(kind, resourceId, operation) {
    const job = this.job(kind, resourceId, "QUEUED");
    await this.persist();
    setImmediate(async () => {
      job.status = "RUNNING"; job.progress = 10; job.startedAt = now(); await this.persist();
      try { job.result = await operation(); job.status = "COMPLETE"; job.progress = 100; job.finishedAt = now(); this.audit(`${kind}_COMPLETED`, resourceId); }
      catch (error) { job.status = "FAILED"; job.error = String(error?.message || "operation_failed").slice(0, 160); job.finishedAt = now(); this.audit(`${kind}_FAILED`, resourceId, job.error); }
      await this.persist();
    });
    return job;
  }
  startScheduler() {
    if (this.scheduler) return;
    const minutes = Math.max(5, Math.min(1_440, Number(process.env.COMMITMENT_EPOCH_MINUTES) || 360));
    const cadenceMs = minutes * 60_000;
    const tick = async () => {
      if (Date.now() < this.nextEpochAt || !this.store.state.commitments.some((item) => item.status === "QUEUED") || process.env.DISABLE_SOLANA_SIGNING === "true") return;
      this.nextEpochAt = Math.ceil(Date.now() / cadenceMs) * cadenceMs;
      await this.commitEpoch().catch(() => {});
    };
    this.nextEpochAt = Math.ceil(Date.now() / cadenceMs) * cadenceMs;
    this.scheduler = setInterval(tick, Math.min(60_000, cadenceMs));
    this.scheduler.unref?.();
  }
  commitmentSchedule() {
    const minutes = Math.max(5, Math.min(1_440, Number(process.env.COMMITMENT_EPOCH_MINUTES) || 360));
    return { cadenceMinutes: minutes, nextEpochAt: new Date(this.nextEpochAt || Math.ceil(Date.now() / (minutes * 60_000)) * minutes * 60_000).toISOString(), queued: this.store.state.commitments.filter((item) => item.status === "QUEUED").length, immediateMode: process.env.DEV_ALLOW_IMMEDIATE_COMMIT === "true" };
  }
  async seed() { for (const entry of await discoverCandidates({ provider: "PUBLIC_CATALOG" })) await this.createSource(entry); await this.persist(); }
  async createSource(input = {}) {
    const normalized = validateExternalUrl(input.url).toString();
    const urlDigest = digest(normalized);
    const duplicate = this.store.state.sources.find((source) => source.urlDigest === urlDigest && source.private?.catalogKey === (input.catalogKey ?? null));
    if (duplicate) return duplicate;
    const source = {
      id: id("src"), publicId: id("pub"), status: "DISCOVERED", name: String(input.name || new URL(normalized).hostname).slice(0, 120), provider: String(input.provider || new URL(normalized).hostname).slice(0, 80), sourceType: input.sourceType || "WEB", category: input.category || "Other", categories: [input.category || "Other"], industry: input.industry || "Cross-industry", region: input.region || "Global", discoveryProvider: input.discoveryProvider || (input.sourceType === "API" ? "MANUAL_API" : "MANUAL_URL"), discoveredAt: now(), createdAt: now(), updatedAt: now(), urlDigest,
      measurementDescription: input.description || "Pending parsing and analysis", spatialResolution: input.spatialResolution || "UNKNOWN", temporalResolution: input.temporalResolution || "UNKNOWN", updateFrequency: input.updateFrequency || "UNKNOWN", latency: input.latency || "UNKNOWN", historicalDepth: Number(input.historicalDepth || 0), accessType: input.accessType || "WEB", pricingType: input.pricingType || "UNKNOWN", licenseSummary: input.licenseSummary || "UNKNOWN", dataFormats: input.dataFormats || [], apiAvailable: Boolean(input.apiAvailable || input.sourceType === "API"), historicalDataAvailable: Boolean(input.historicalDataAvailable), confidence: 0,
      sensitivityMode: ["PUBLIC_SOURCE", "PRIVATE_SOURCE", "HIGHLY_SENSITIVE_SOURCE"].includes(input.sensitivityMode) ? input.sensitivityMode : "PUBLIC_SOURCE",
      scores: {}, private: { url: normalized, normalizedUrl: normalized, summary: "", catalogKey: input.catalogKey ?? null, exactGeography: input.exactGeography ?? null }, documentationUrl: input.documentationUrl || normalized, dataset: null, analysis: null, commitmentStatus: "UNCOMMITTED", verificationStatus: "UNCLAIMED",
    };
    source.scores = score(source); this.store.state.sources.unshift(source); this.audit("SOURCE_DISCOVERED", source.id); return source;
  }
  view(source) {
    const { private: _private, dataset, analysis: _analysis, urlDigest: _urlDigest, ...safe } = source;
    return { ...safe, dataset: dataset ? { snapshotId: dataset.snapshotId, rows: dataset.rows.length, digest: dataset.digest, createdAt: dataset.createdAt, provider: dataset.provenance.provider, retrievedAt: dataset.provenance.retrievedAt, unit: dataset.provenance.unit, quality: dataset.quality } : null };
  }
  list(filters = {}) {
    const yes = (value) => String(value).toLowerCase() === "true";
    const value = (source, key) => source.scores?.[key] ?? 0;
    let sources = this.store.state.sources.filter((source) => source.status !== "ARCHIVED")
      .filter((source) => !filters.q || `${source.name} ${source.provider} ${source.category} ${source.industry} ${source.region}`.toLowerCase().includes(String(filters.q).toLowerCase()))
      .filter((source) => !filters.category || source.category === filters.category).filter((source) => !filters.industry || source.industry === filters.industry).filter((source) => !filters.geography || source.region === filters.geography).filter((source) => !filters.sourceType || source.sourceType === filters.sourceType).filter((source) => !filters.temporalResolution || source.temporalResolution === filters.temporalResolution).filter((source) => !filters.updateFrequency || source.updateFrequency === filters.updateFrequency).filter((source) => !filters.pricingType || source.pricingType === filters.pricingType)
      .filter((source) => filters.apiAvailable === undefined || source.apiAvailable === yes(filters.apiAvailable)).filter((source) => filters.historicalDataAvailable === undefined || source.historicalDataAvailable === yes(filters.historicalDataAvailable)).filter((source) => filters.tested === undefined || (source.status === "TESTED") === yes(filters.tested)).filter((source) => filters.committed === undefined || (source.commitmentStatus === "COMMITTED_ONCHAIN") === yes(filters.committed)).filter((source) => !filters.minHistoricalDepth || source.historicalDepth >= Number(filters.minHistoricalDepth))
      .filter((source) => ["quality", "economicRelevance", "novelty", "testability", "candidate"].every((key) => !filters[`min${key[0].toUpperCase()}${key.slice(1)}`] || value(source, key) >= Number(filters[`min${key[0].toUpperCase()}${key.slice(1)}`])));
    const sort = ["quality", "economicRelevance", "novelty", "testability", "candidate"].includes(filters.sort) ? filters.sort : "candidate";
    sources.sort((left, right) => value(right, sort) - value(left, sort) || right.updatedAt.localeCompare(left.updatedAt));
    const pageSize = Math.max(1, Math.min(100, Number(filters.pageSize) || 20)); const page = Math.max(1, Number(filters.page) || 1); const total = sources.length;
    sources = sources.slice((page - 1) * pageSize, page * pageSize);
    return { sources: sources.map((source) => this.view(source)), pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
  get(sourceId) { return this.store.state.sources.find((source) => source.id === sourceId && source.status !== "ARCHIVED") ?? null; }
  options() { const active = this.store.state.sources.filter((source) => source.status !== "ARCHIVED"); const unique = (field) => [...new Set(active.map((source) => source[field]).filter(Boolean))].sort(); return { categories: unique("category"), industries: unique("industry"), geographies: unique("region"), sourceTypes: unique("sourceType"), temporalResolutions: unique("temporalResolution"), updateFrequencies: unique("updateFrequency"), pricingTypes: unique("pricingType"), targets: targetCatalog(), providers: sourceCatalog(), discoveryProviders: discoveryProviderOptions(), scoreWeights: SCORE_WEIGHTS, analyzer: analyzerConfig() }; }
  async discover(input = {}) { const candidates = await discoverCandidates({ provider: input.provider, query: input.query, keys: input.providers }); const added = []; for (const entry of candidates) { const before = this.store.state.sources.length; const source = await this.createSource(entry); if (this.store.state.sources.length > before) added.push(this.view(source)); } const job = this.job("DISCOVER_SOURCES", "registry"); await this.persist(); return { job, sources: added, discovered: added.length }; }
  async parse(source) {
    if (process.env.DISABLE_CRAWLING === "true") throw new Error("crawling_disabled");
    try { const fetched = await fetchExternalText(source.private.url); const parsed = extractPageMetadata(fetched.text); source.private.summary = parsed.text; if (parsed.title && (!source.name || source.name === new URL(source.private.url).hostname || source.name === "Discovered source")) source.name = parsed.title; if (parsed.provider) source.provider = parsed.provider; if (parsed.description) source.measurementDescription = parsed.description; if (parsed.formats.length) source.dataFormats = parsed.formats; source.apiAvailable ||= parsed.apiAvailable; source.historicalDataAvailable ||= parsed.historicalDataAvailable; source.status = "PARSED"; source.updatedAt = now(); source.scores = score(source); const job = this.job("PARSE_SOURCE", source.id); this.audit("SOURCE_PARSED", source.id); await this.persist(); return { source: this.view(source), job }; }
    catch (error) { source.status = "FETCH_BLOCKED"; source.updatedAt = now(); this.audit("SOURCE_PARSE_FAILED", source.id, error.message); await this.persist(); throw error; }
  }
  async analyze(source) { source.analysis = await analyzeSource(source); source.status = "AI_ANALYZED"; source.updatedAt = now(); source.confidence = source.analysis.confidence; source.scores = score(source); const job = this.job("AI_ANALYZE_SOURCE", source.id); this.audit("SOURCE_ANALYZED", source.id); await this.persist(); return { source: this.view(source), analysis: source.analysis, job }; }
  async connect(source) {
    if (process.env.DISABLE_CRAWLING === "true") throw new Error("crawling_disabled");
    if (!source.private.catalogKey) throw new Error("provider_connector_unavailable");
    try { const loaded = await loadSourceDataset(source.private.catalogKey); return await this.saveSnapshot(source, loaded.rows, { ...loaded, sourceUrlDigest: digest(loaded.sourceUrl) }); }
    catch (error) { source.status = "INGEST_FAILED"; source.updatedAt = now(); this.audit("PROVIDER_INGEST_FAILED", source.id, error.message); await this.persist(); throw error; }
  }
  async saveSnapshot(source, rows, provenance) {
    const receivedAt = now(); const quality = datasetQuality(rows); const snapshot = { snapshotId: id("snap"), rows, digest: digest(JSON.stringify(rows)), createdAt: receivedAt, ingestionTime: receivedAt, actualReceivedTime: receivedAt, quality, provenance: { provider: provenance.provider, retrievedAt: provenance.retrievedAt || receivedAt, sourceUrlDigest: provenance.sourceUrlDigest, unit: provenance.unit || null, featureColumns: provenance.featureColumns || ["value"] } };
    source.dataset = snapshot; source.status = "DATA_CONNECTED"; source.updatedAt = now(); source.historicalDataAvailable = true; source.scores = score(source); this.store.state.datasets.unshift({ ...snapshot, sourceId: source.id });
    const job = this.job("INGEST_DATASET", source.id); this.audit("DATASET_INGESTED", source.id); await this.persist(); return { dataset: this.view(source).dataset, job };
  }
  async ingest(source, csv) { const parsed = parseCsv(csv); return this.saveSnapshot(source, parsed.rows, { provider: "CSV_UPLOAD", retrievedAt: now(), sourceUrlDigest: null, featureColumns: parsed.featureColumns }); }
  async ingestJson(source, options = {}) {
    if (process.env.DISABLE_CRAWLING === "true") throw new Error("crawling_disabled");
    const endpoint = validateExternalUrl(options.url || source.private.url).toString(); const fetched = await fetchExternalText(endpoint, { maxBytes: MAX_JSON_BYTES, timeoutMs: 12_000 });
    if (!/^application\/json/i.test(fetched.contentType)) throw new Error("invalid_json_mime");
    let payload; try { payload = JSON.parse(fetched.text); } catch { throw new Error("invalid_provider_json"); }
    const rows = parseJsonRows(payload, options); return this.saveSnapshot(source, rows, { provider: "JSON_API", retrievedAt: now(), sourceUrlDigest: digest(endpoint), featureColumns: [options.valueField || "value"] });
  }
  async test(source, { target = "EURUSD", targetCsv, lag = 2, horizon = 1, equitySymbol } = {}) {
    if (!source.dataset) throw new Error("invalid_test_request");
    let market; let targetProvenance;
    if (targetCsv) { const parsed = parseCsv(targetCsv, "price"); market = parsed.rows.map((row) => ({ timestamp: row.timestamp, price: row.value })); targetProvenance = { provider: "CSV_UPLOAD", symbol: target, retrievedAt: now() }; }
    else { const loaded = await loadMarketTarget(target, { equitySymbol }); market = loaded.rows; targetProvenance = { provider: loaded.provider, symbol: loaded.symbol, sourceUrlDigest: digest(loaded.sourceUrl), retrievedAt: loaded.retrievedAt }; }
    const derived = market.map((row, index) => ({ timestamp: row.timestamp, return: index ? row.price / market[index - 1].price - 1 : null, laggedReturn: index > 1 ? market[index - 1].price / market[index - 2].price - 1 : null, forwardReturn: index + Number(horizon) < market.length ? market[index + Number(horizon)].price / row.price - 1 : null }));
    const targetSnapshot = { snapshotId: id("target"), rows: market, derived, digest: digest(JSON.stringify(market)), createdAt: now(), provenance: targetProvenance }; this.store.state.targetSnapshots.unshift(targetSnapshot);
    const result = runAlphaTest({ source: source.dataset.rows, target: market, lag: Math.max(0, Math.min(30, Number(lag))), horizon: Math.max(1, Math.min(20, Number(horizon))) });
    const test = { id: id("test"), sourceId: source.id, sourceSnapshotId: source.dataset.snapshotId, targetSnapshotId: targetSnapshot.snapshotId, target: targetProvenance.symbol, targetProvider: targetProvenance.provider, createdAt: now(), analysisCodeVersion: "qarau-alpha-v2", configurationVersion: "v2", modelVersion: "ridge-linear-v2", ...result, commitmentStatus: "UNCOMMITTED" };
    this.store.state.tests.unshift(test); source.status = "TESTED"; source.updatedAt = now(); const job = this.job("RUN_ALPHA_TEST", test.id); this.audit("ALPHA_TEST_COMPLETED", test.id); await this.persist(); return { test, job };
  }
  async queueCommit(kind, resource) {
    if (process.env.DISABLE_SOLANA_SIGNING === "true") throw new Error("solana_signing_disabled");
    const existing = this.store.state.commitments.find((item) => item.kind === kind && item.resourceId === resource.id && ["QUEUED", "COMMITTED_ONCHAIN"].includes(item.status));
    if (existing) return existing;
    const domain = kind === "SOURCE" ? "QARAU_SOURCE_V1" : "QARAU_ANALYSIS_V1"; const record = kind === "SOURCE" ? { id: resource.id, snapshot: resource.dataset?.snapshotId ?? null, version: 1 } : { id: resource.id, sourceSnapshotId: resource.sourceSnapshotId, targetSnapshotId: resource.targetSnapshotId, version: 1 };
    const salt = newSalt(); const leaf = commitmentLeaf(domain, record, salt); const commitment = { id: id("commit"), kind, resourceId: resource.id, leaf, salt: salt.toString("base64url"), status: "QUEUED", epoch: null, root: null, signature: null, createdAt: now() };
    this.store.state.commitments.unshift(commitment); resource.commitmentStatus = "QUEUED"; this.job("QUEUE_COMMITMENT", commitment.id); this.audit("COMMITMENT_QUEUED", commitment.id); await this.persist(); return commitment;
  }
  async commitEpoch({ immediate = false } = {}) {
    if (immediate && process.env.DEV_ALLOW_IMMEDIATE_COMMIT !== "true") throw new Error("immediate_commit_disabled");
    const queued = this.store.state.commitments.filter((commitment) => commitment.status === "QUEUED"); if (!queued.length) return { committed: 0 };
    const cadenceSeconds = Math.max(300, Math.min(86_400, (Number(process.env.COMMITMENT_EPOCH_MINUTES) || 360) * 60));
    const epoch = String(Math.floor(Date.now() / (cadenceSeconds * 1_000)) * cadenceSeconds); const tree = merkleTree(queued.map((commitment) => commitment.leaf)); const root = tree.root;
    try {
      const anchor = await commitMerkleRoot({ action: "COMMIT_MERKLE_ROOT", root, epoch, version: 1 });
      for (const [index, commitment] of queued.entries()) {
        commitment.status = "COMMITTED_ONCHAIN"; commitment.epoch = epoch; commitment.root = root; commitment.merkleProof = tree.proofs[index]; commitment.signature = anchor.signature; commitment.slot = anchor.slot; commitment.verifiedAt = anchor.verifiedAt;
        const resource = commitment.kind === "SOURCE" ? this.get(commitment.resourceId) : this.store.state.tests.find((item) => item.id === commitment.resourceId);
        if (resource) { resource.commitmentStatus = "COMMITTED_ONCHAIN"; if (commitment.kind === "SOURCE") resource.status = "COMMITTED_ONCHAIN"; }
      }
      this.audit("MERKLE_EPOCH_COMMITTED", epoch); await this.persist();
      return { committed: queued.length, epoch, root, status: "COMMITTED_ONCHAIN", signature: anchor.signature, slot: anchor.slot, network: anchor.network, program: anchor.program };
    } catch (error) {
      this.audit("MERKLE_EPOCH_FAILED", epoch, error.message); await this.persist(); throw error;
    }
  }
  beginVerification(source, method = "ADMIN_REVIEW") {
    if (!['ADMIN_REVIEW', 'DNS_TXT', 'API_FIELD', 'HOSTED_FILE'].includes(method)) throw new Error("invalid_verification_method");
    const claim = { id: id("claim"), sourceId: source.id, method, status: "PENDING_VERIFICATION", challenge: randomBytes(24).toString("base64url"), createdAt: now(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(), verifiedAt: null };
    this.store.state.claims.unshift(claim); source.verificationStatus = claim.status; this.audit("PROVIDER_VERIFICATION_STARTED", source.id); return claim;
  }
  decideVerification(source, claimId, decision) {
    const claim = this.store.state.claims.find((item) => item.id === claimId && item.sourceId === source.id);
    if (!claim || claim.status !== "PENDING_VERIFICATION" || Date.parse(claim.expiresAt) < Date.now()) throw new Error("verification_not_available");
    if (!['VERIFIED', 'REJECTED'].includes(decision)) throw new Error("invalid_verification_decision");
    claim.status = decision; claim.verifiedAt = now(); source.verificationStatus = decision; this.audit(decision === "VERIFIED" ? "PROVIDER_VERIFIED" : "PROVIDER_REJECTED", source.id); return claim;
  }
  recordAccessReceipt(source, purpose = "INTERNAL_RESEARCH") {
    const salt = newSalt();
    const payload = { sourceId: source.id, actorId: "owner", purpose: String(purpose).slice(0, 80), timestamp: now() };
    const receipt = { id: id("receipt"), sourceId: source.id, purpose: payload.purpose, hash: digest(Buffer.concat([Buffer.from("QARAU_ACCESS_V1\0"), Buffer.from(canonicalJson(payload)), salt])), salt: salt.toString("base64url"), createdAt: payload.timestamp, status: "PRIVATE_RECORDED" };
    this.store.state.accessReceipts.unshift(receipt); this.audit("ACCESS_RECEIPT_RECORDED", source.id); return receipt;
  }
  transaction(commitmentId) {
    const item = this.store.state.commitments.find((commitment) => commitment.id === commitmentId);
    if (!item) return null;
    return { id: item.id, status: item.status, epoch: item.epoch, root: item.root, signature: item.signature, slot: item.slot ?? null, verifiedAt: item.verifiedAt ?? null, network: item.signature ? "devnet" : null };
  }
}
