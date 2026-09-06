import { createHash } from "node:crypto";

export const HASH_DOMAINS = Object.freeze({
  datasetId: "QARAU_DATASET_ID_V1\0",
  rawSnapshot: "QARAU_RAW_SNAPSHOT_V1\0",
  normalizedDataset: "QARAU_NORMALIZED_DATASET_V1\0",
  analysisManifest: "QARAU_ANALYSIS_MANIFEST_V1\0",
  analysisResult: "QARAU_ANALYSIS_RESULT_V1\0",
  accessPolicy: "QARAU_ACCESS_POLICY_V1\0",
});

export const ACCESS_TIERS = Object.freeze({ EXCLUSIVE_EARLY: 1, DELAYED: 2 });

export const SOLANA_ACCOUNT_LAYOUTS = Object.freeze({
  Registry: Object.freeze({
    fields: Object.freeze({ authority: 32, treasury: 32, schemaVersion: 2, paused: 1, bump: 1 }),
    space: 76,
  }),
  DatasetCommitment: Object.freeze({
    fields: Object.freeze({
      datasetIdHash: 32,
      version: 4,
      rawSnapshotHash: 32,
      normalizedDatasetHash: 32,
      analysisManifestHash: 32,
      analysisResultHash: 32,
      accessPolicyHash: 32,
      publisher: 32,
      createdAt: 8,
      maxSeats: 4,
      allowedTierMask: 1,
      delayedVersionLag: 4,
      delayedReleaseSeconds: 8,
      grantDurationSeconds: 8,
      status: 1,
      bump: 1,
    }),
    space: 271,
  }),
  Sale: Object.freeze({
    fields: Object.freeze({
      datasetCommitment: 32,
      treasury: 32,
      startsAt: 8,
      endsAt: 8,
      paymentAsset: 1,
      earlyPriceLamports: 8,
      delayedPriceLamports: 8,
      grantDurationSeconds: 8,
      delayedInitialCommitment: 32,
      maxSeats: 4,
      occupiedSeats: 4,
      enabledTierMask: 1,
      status: 1,
      bump: 1,
    }),
    space: 156,
  }),
  AccessGrant: Object.freeze({
    fields: Object.freeze({
      datasetCommitment: 32,
      sale: 32,
      buyer: 32,
      datasetIdHash: 32,
      purchasedVersion: 4,
      tier: 1,
      grantedAt: 8,
      expiresAt: 8,
      status: 1,
      bump: 1,
    }),
    space: 159,
  }),
  AccessRound: Object.freeze({
    fields: Object.freeze({
      datasetCommitment: 32,
      treasury: 32,
      opensAt: 8,
      closesAt: 8,
      minimumBidLamports: 8,
      maxWinners: 4,
      bidCount: 4,
      winnersCount: 4,
      claimedCount: 4,
      enabledTierMask: 1,
      settlementRule: 1,
      status: 1,
      clearingPriceLamports: 8,
      bids: 4 + (32 * 49),
      bump: 1,
    }),
    space: 1696,
  }),
  Bid: Object.freeze({
    fields: Object.freeze({ accessRound: 32, bidder: 32, amountLamports: 8, tier: 1, placedAt: 8, status: 1, bump: 1 }),
    space: 91,
  }),
  AccessEntitlement: Object.freeze({
    fields: Object.freeze({ datasetCommitment: 32, accessRound: 32, wallet: 32, datasetIdHash: 32, purchasedVersion: 4, tier: 1, grantedAt: 8, expiresAt: 8, bidAmountLamports: 8, status: 1, bump: 1 }),
    space: 167,
  }),
});

function assertPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("canonical_object_required");
  }
}

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("canonical_numbers_must_be_safe_integers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  assertPlainObject(value);
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new TypeError("canonical_undefined_forbidden");
    return [key, normalize(value[key])];
  }));
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function canonicalJsonlBytes(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError("canonical_jsonl_rows_required");
  return Buffer.from(`${rows.map(canonicalJson).join("\n")}\n`, "utf8");
}

export function canonicalDecimal(value) {
  const text = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw new TypeError("invalid_canonical_decimal");
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [integer, fraction = ""] = unsigned.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const normalized = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return normalized === "0" ? "0" : negative ? `-${normalized}` : normalized;
}

export function hashBytes(domain, bytes) {
  if (!Object.values(HASH_DOMAINS).includes(domain)) throw new TypeError("unknown_hash_domain");
  if (!Buffer.isBuffer(bytes)) throw new TypeError("hash_bytes_required");
  return createHash("sha256").update(domain, "utf8").update(bytes).digest("hex");
}

export function hashCanonicalArtifact(domain, value) {
  return hashBytes(domain, canonicalJsonBytes(value));
}

export function uuidBytes(uuid) {
  const hex = String(uuid).toLowerCase().replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new TypeError("invalid_uuid");
  return Buffer.from(hex, "hex");
}

export function datasetIdHash(uuid) {
  return hashBytes(HASH_DOMAINS.datasetId, uuidBytes(uuid));
}

export function validateAccessPolicy(policy) {
  assertPlainObject(policy);
  const keys = Object.keys(policy).sort().join(",");
  if (keys !== "allowed_tier_mask,delayed,early,expiry,grant_scope,policy_version") throw new TypeError("invalid_access_policy_shape");
  if (policy.policy_version !== 1 || policy.grant_scope !== "PURCHASED_DATASET_LINE") throw new TypeError("unsupported_access_policy");
  if (!Number.isSafeInteger(policy.allowed_tier_mask) || policy.allowed_tier_mask < 1 || policy.allowed_tier_mask > 3) throw new TypeError("invalid_tier_mask");
  if (policy.early?.available_immediately !== true) throw new TypeError("invalid_early_policy");
  if (!Number.isSafeInteger(policy.delayed?.version_lag) || policy.delayed.version_lag < 1) throw new TypeError("invalid_delayed_version_lag");
  for (const field of [policy.delayed?.release_seconds, policy.expiry?.grant_duration_seconds]) {
    if (!/^[1-9]\d*$/.test(String(field ?? ""))) throw new TypeError("invalid_policy_duration");
  }
  return Object.freeze(structuredClone(policy));
}

export function assertAccountSpaces() {
  for (const [name, layout] of Object.entries(SOLANA_ACCOUNT_LAYOUTS)) {
    const calculated = 8 + Object.values(layout.fields).reduce((total, size) => total + size, 0);
    if (calculated !== layout.space) throw new Error(`invalid_account_space:${name}:${calculated}:${layout.space}`);
  }
  return true;
}
