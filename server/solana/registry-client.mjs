import { createHash } from "node:crypto";
import { AccountRole, address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from "@solana/kit";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function discriminator(name) { return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8); }
function instructionDiscriminator(name) { return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function u64(value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; }
function equal(left, right) { return Buffer.from(left).equals(Buffer.from(right)); }

export async function deriveRegistryPda(programId) { return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["registry"] }))[0]; }
export async function deriveDatasetCommitmentPda(programId, datasetIdHash, version) {
  if (!Buffer.isBuffer(datasetIdHash) || datasetIdHash.length !== 32 || !Number.isInteger(version) || version < 1) throw new Error("invalid_commitment_pda_input");
  return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["dataset", datasetIdHash, u32(version)] }))[0];
}
export async function deriveSalePda(programId, commitmentPda) { return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["sale", getAddressEncoder().encode(address(commitmentPda))] }))[0]; }
export async function deriveAccessGrantPda(programId, salePda, buyer) { return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["grant", getAddressEncoder().encode(address(salePda)), getAddressEncoder().encode(address(buyer))] }))[0]; }
export async function deriveAccessRoundPda(programId, commitmentPda) { return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["auction", getAddressEncoder().encode(address(commitmentPda))] }))[0]; }
export async function deriveBidPda(programId, roundPda, bidder) { return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["bid", getAddressEncoder().encode(address(roundPda)), getAddressEncoder().encode(address(bidder))] }))[0]; }
export async function deriveAccessEntitlementPda(programId, roundPda, wallet) { return (await getProgramDerivedAddress({ programAddress: address(programId), seeds: ["entitlement", getAddressEncoder().encode(address(roundPda)), getAddressEncoder().encode(address(wallet))] }))[0]; }

function decodedAddress(bytes) { return getAddressDecoder().decode(Uint8Array.from(bytes)); }

export function decodeAccessGrant(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length !== 159 || !equal(raw.subarray(0, 8), discriminator("AccessGrant"))) throw new Error("invalid_access_grant_account");
  let offset = 8;
  const nextAddress = () => { const value = decodedAddress(raw.subarray(offset, offset + 32)); offset += 32; return value; };
  const datasetCommitment = nextAddress(); const sale = nextAddress(); const buyer = nextAddress();
  const datasetIdHash = raw.subarray(offset, offset + 32).toString("hex"); offset += 32;
  const purchasedVersion = raw.readUInt32LE(offset); offset += 4;
  const tier = raw.readUInt8(offset); offset += 1;
  const grantedAt = raw.readBigInt64LE(offset); offset += 8;
  const expiresAt = raw.readBigInt64LE(offset); offset += 8;
  const status = raw.readUInt8(offset); offset += 1;
  const bump = raw.readUInt8(offset);
  return Object.freeze({ datasetCommitment, sale, buyer, datasetIdHash, purchasedVersion, tier, grantedAt: Number(grantedAt), expiresAt: Number(expiresAt), status, bump });
}

export function decodeDatasetCommitment(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length !== 271 || !equal(raw.subarray(0, 8), discriminator("DatasetCommitment"))) throw new Error("invalid_dataset_commitment_account");
  let offset = 8;
  const nextHash = () => { const value = raw.subarray(offset, offset + 32).toString("hex"); offset += 32; return value; };
  const datasetIdHash = nextHash(); const version = raw.readUInt32LE(offset); offset += 4;
  const rawSnapshotHash = nextHash(); const normalizedDatasetHash = nextHash(); const analysisManifestHash = nextHash(); const analysisResultHash = nextHash(); const accessPolicyHash = nextHash();
  const publisher = decodedAddress(raw.subarray(offset, offset + 32)); offset += 32;
  const createdAt = Number(raw.readBigInt64LE(offset)); offset += 8;
  const maxSeats = raw.readUInt32LE(offset); offset += 4;
  const allowedTierMask = raw.readUInt8(offset); offset += 1;
  const delayedVersionLag = raw.readUInt32LE(offset); offset += 4;
  const delayedReleaseSeconds = Number(raw.readBigInt64LE(offset)); offset += 8;
  const grantDurationSeconds = Number(raw.readBigInt64LE(offset)); offset += 8;
  const status = raw.readUInt8(offset); offset += 1;
  const bump = raw.readUInt8(offset);
  return Object.freeze({ datasetIdHash, version, rawSnapshotHash, normalizedDatasetHash, analysisManifestHash, analysisResultHash, accessPolicyHash, publisher, createdAt, maxSeats, allowedTierMask, delayedVersionLag, delayedReleaseSeconds, grantDurationSeconds, status, bump });
}

export function decodeAccessRound(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length !== 1696 || !equal(raw.subarray(0, 8), discriminator("AccessRound"))) throw new Error("invalid_access_round_account");
  let offset = 8;
  const nextAddress = () => { const value = decodedAddress(raw.subarray(offset, offset + 32)); offset += 32; return value; };
  const datasetCommitment = nextAddress(); const treasury = nextAddress();
  const opensAt = Number(raw.readBigInt64LE(offset)); offset += 8;
  const closesAt = Number(raw.readBigInt64LE(offset)); offset += 8;
  const minimumBidLamports = Number(raw.readBigUInt64LE(offset)); offset += 8;
  const maxWinners = raw.readUInt32LE(offset); offset += 4;
  const bidCount = raw.readUInt32LE(offset); offset += 4;
  const winnersCount = raw.readUInt32LE(offset); offset += 4;
  const claimedCount = raw.readUInt32LE(offset); offset += 4;
  const enabledTierMask = raw.readUInt8(offset); offset += 1;
  const settlementRule = raw.readUInt8(offset); offset += 1;
  const status = raw.readUInt8(offset); offset += 1;
  const clearingPriceLamports = Number(raw.readBigUInt64LE(offset)); offset += 8;
  const entries = raw.readUInt32LE(offset); offset += 4;
  if (entries > 32 || entries !== bidCount) throw new Error("invalid_access_round_bid_count");
  const bids = [];
  for (let index = 0; index < entries; index += 1) {
    const bidder = nextAddress();
    const amountLamports = Number(raw.readBigUInt64LE(offset)); offset += 8;
    const tier = raw.readUInt8(offset); offset += 1;
    const placedAt = Number(raw.readBigInt64LE(offset)); offset += 8;
    bids.push(Object.freeze({ bidder, amountLamports, tier, placedAt, rank: index + 1 }));
  }
  const bump = raw.readUInt8(offset);
  return Object.freeze({ datasetCommitment, treasury, opensAt, closesAt, minimumBidLamports, maxWinners, bidCount, winnersCount, claimedCount, enabledTierMask, settlementRule, status, clearingPriceLamports, bids: Object.freeze(bids), bump });
}

export function decodeBid(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length !== 91 || !equal(raw.subarray(0, 8), discriminator("Bid"))) throw new Error("invalid_bid_account");
  let offset = 8;
  const accessRound = decodedAddress(raw.subarray(offset, offset + 32)); offset += 32;
  const bidder = decodedAddress(raw.subarray(offset, offset + 32)); offset += 32;
  const amountLamports = Number(raw.readBigUInt64LE(offset)); offset += 8;
  const tier = raw.readUInt8(offset); offset += 1;
  const placedAt = Number(raw.readBigInt64LE(offset)); offset += 8;
  const status = raw.readUInt8(offset); offset += 1;
  const bump = raw.readUInt8(offset);
  return Object.freeze({ accessRound, bidder, amountLamports, tier, placedAt, status, bump });
}

export function decodeAccessEntitlement(bytes) {
  const raw = Buffer.from(bytes);
  if (raw.length !== 167 || !equal(raw.subarray(0, 8), discriminator("AccessEntitlement"))) throw new Error("invalid_access_entitlement_account");
  let offset = 8;
  const nextAddress = () => { const value = decodedAddress(raw.subarray(offset, offset + 32)); offset += 32; return value; };
  const datasetCommitment = nextAddress(); const accessRound = nextAddress(); const wallet = nextAddress();
  const datasetIdHash = raw.subarray(offset, offset + 32).toString("hex"); offset += 32;
  const purchasedVersion = raw.readUInt32LE(offset); offset += 4;
  const tier = raw.readUInt8(offset); offset += 1;
  const grantedAt = Number(raw.readBigInt64LE(offset)); offset += 8;
  const expiresAt = Number(raw.readBigInt64LE(offset)); offset += 8;
  const bidAmountLamports = Number(raw.readBigUInt64LE(offset)); offset += 8;
  const status = raw.readUInt8(offset); offset += 1;
  const bump = raw.readUInt8(offset);
  return Object.freeze({ datasetCommitment, accessRound, wallet, datasetIdHash, purchasedVersion, tier, grantedAt, expiresAt, bidAmountLamports, status, bump });
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error("solana_rpc_unavailable");
  const payload = await response.json();
  if (payload.error) throw new Error("solana_rpc_unavailable");
  return payload.result;
}

export async function readDatasetCommitment({ rpcUrl, programId, datasetPda }) {
  const result = await rpc(rpcUrl, "getAccountInfo", [datasetPda, { commitment: "finalized", encoding: "base64" }]);
  const account = result?.value;
  if (!account || account.owner !== programId || !Array.isArray(account.data) || typeof account.data[0] !== "string") return null;
  return Object.freeze({ datasetPda, slot: Number(result.context?.slot ?? 0), ...decodeDatasetCommitment(Buffer.from(account.data[0], "base64")) });
}

async function readProgramAccount({ rpcUrl, programId, accountAddress, decode }) {
  const result = await rpc(rpcUrl, "getAccountInfo", [accountAddress, { commitment: "finalized", encoding: "base64" }]);
  const account = result?.value;
  if (!account || account.owner !== programId || !Array.isArray(account.data) || typeof account.data[0] !== "string") return null;
  return Object.freeze({ slot: Number(result.context?.slot ?? 0), ...decode(Buffer.from(account.data[0], "base64")) });
}

export async function readAccessRound({ rpcUrl, programId, roundPda }) {
  const decoded = await readProgramAccount({ rpcUrl, programId, accountAddress: roundPda, decode: decodeAccessRound });
  return decoded && Object.freeze({ roundPda, ...decoded });
}

export async function readBid({ rpcUrl, programId, roundPda, bidder }) {
  const bidPda = await deriveBidPda(programId, roundPda, bidder);
  const decoded = await readProgramAccount({ rpcUrl, programId, accountAddress: bidPda, decode: decodeBid });
  if (!decoded || decoded.accessRound !== roundPda || decoded.bidder !== bidder) return null;
  return Object.freeze({ bidPda, ...decoded });
}

export async function readAccessEntitlement({ rpcUrl, programId, roundPda, wallet }) {
  const entitlementPda = await deriveAccessEntitlementPda(programId, roundPda, wallet);
  const decoded = await readProgramAccount({ rpcUrl, programId, accountAddress: entitlementPda, decode: decodeAccessEntitlement });
  if (!decoded || decoded.accessRound !== roundPda || decoded.wallet !== wallet || decoded.status !== 1 || decoded.expiresAt <= Math.floor(Date.now() / 1_000)) return null;
  return Object.freeze({ entitlementPda, ...decoded });
}

export async function readFinalizedSignature({ rpcUrl, signature }) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(String(signature))) throw new Error("invalid_transaction_signature");
  const result = await rpc(rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  const status = result?.value?.[0];
  if (!status || status.err || status.confirmationStatus !== "finalized") return null;
  return Object.freeze({ slot: Number(status.slot), confirmationStatus: status.confirmationStatus });
}

export async function transactionTouchesPurchase({ rpcUrl, signature, programId, salePda, grantPda, buyer }) {
  const result = await rpc(rpcUrl, "getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
  const keys = result?.transaction?.message?.accountKeys;
  if (!Array.isArray(keys)) return false;
  const values = new Set(keys.map((key) => typeof key === "string" ? key : key?.pubkey).filter(Boolean));
  return [programId, salePda, grantPda, buyer].every((key) => values.has(key));
}

export async function transactionTouchesAccounts({ rpcUrl, signature, required }) {
  const result = await rpc(rpcUrl, "getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
  const keys = result?.transaction?.message?.accountKeys;
  if (!Array.isArray(keys)) return false;
  const values = new Set(keys.map((key) => typeof key === "string" ? key : key?.pubkey).filter(Boolean));
  return required.every((key) => values.has(key));
}

export async function readAccessGrant({ rpcUrl, programId, salePda, buyer }) {
  const grantPda = await deriveAccessGrantPda(programId, salePda, buyer);
  const result = await rpc(rpcUrl, "getAccountInfo", [grantPda, { commitment: "finalized", encoding: "base64" }]);
  const account = result?.value;
  if (!account || account.owner !== programId || !Array.isArray(account.data) || typeof account.data[0] !== "string") return null;
  const decoded = decodeAccessGrant(Buffer.from(account.data[0], "base64"));
  if (decoded.buyer !== buyer || decoded.sale !== salePda || decoded.status !== 1 || decoded.expiresAt <= Math.floor(Date.now() / 1_000)) return null;
  return Object.freeze({ grantPda, slot: Number(result.context?.slot ?? 0), ...decoded });
}

/** Builds the real, unsigned v0 purchase transaction for a wallet to sign. */
export async function buildPurchaseTransaction({ rpcUrl, programId, commitmentPda, salePda, treasury, buyer, tier }) {
  const registryPda = await deriveRegistryPda(programId);
  const accessGrantPda = await deriveAccessGrantPda(programId, salePda, buyer);
  const latest = await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "finalized" }]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(address(buyer), value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(latest.value, value),
    (value) => appendTransactionMessageInstruction({
      programAddress: address(programId),
      accounts: [
        { address: registryPda, role: AccountRole.READONLY },
        { address: address(commitmentPda), role: AccountRole.READONLY },
        { address: address(salePda), role: AccountRole.WRITABLE },
        { address: address(treasury), role: AccountRole.WRITABLE },
        { address: accessGrantPda, role: AccountRole.WRITABLE },
        { address: address(buyer), role: AccountRole.WRITABLE_SIGNER },
        { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      ],
      data: purchaseInstructionData(tier),
    }, value),
  );
  const transaction = compileTransaction(message);
  const wire = getTransactionEncoder().encode(transaction);
  return Object.freeze({ transactionBase64: Buffer.from(wire).toString("base64"), blockhash: latest.value.blockhash, lastValidBlockHeight: Number(latest.value.lastValidBlockHeight), registryPda, accessGrantPda, salePda, commitmentPda, tier });
}

function unsignedTransaction({ latest, programId, buyer, accounts, data }) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(address(buyer), value),
    (value) => setTransactionMessageLifetimeUsingBlockhash(latest.value, value),
    (value) => appendTransactionMessageInstruction({ programAddress: address(programId), accounts, data }, value),
  );
  return Buffer.from(getTransactionEncoder().encode(compileTransaction(message))).toString("base64");
}

export async function buildBidTransaction({ rpcUrl, programId, roundPda, bidder, amountLamports, tier }) {
  if (!Number.isSafeInteger(amountLamports) || amountLamports < 1 || ![1, 2].includes(tier)) throw new Error("invalid_bid_request");
  const registryPda = await deriveRegistryPda(programId);
  const bidPda = await deriveBidPda(programId, roundPda, bidder);
  const latest = await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "finalized" }]);
  const transactionBase64 = unsignedTransaction({ latest, programId, buyer: bidder, accounts: [
    { address: registryPda, role: AccountRole.READONLY },
    { address: address(roundPda), role: AccountRole.WRITABLE },
    { address: bidPda, role: AccountRole.WRITABLE },
    { address: address(bidder), role: AccountRole.WRITABLE_SIGNER },
    { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
  ], data: placeBidInstructionData(amountLamports, tier) });
  return Object.freeze({ transactionBase64, blockhash: latest.value.blockhash, lastValidBlockHeight: Number(latest.value.lastValidBlockHeight), registryPda, roundPda, bidPda, amountLamports, tier });
}

export async function buildClaimEntitlementTransaction({ rpcUrl, programId, commitmentPda, roundPda, treasury, bidder }) {
  const registryPda = await deriveRegistryPda(programId);
  const bidPda = await deriveBidPda(programId, roundPda, bidder);
  const entitlementPda = await deriveAccessEntitlementPda(programId, roundPda, bidder);
  const latest = await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "finalized" }]);
  const transactionBase64 = unsignedTransaction({ latest, programId, buyer: bidder, accounts: [
    { address: registryPda, role: AccountRole.READONLY },
    { address: address(commitmentPda), role: AccountRole.READONLY },
    { address: address(roundPda), role: AccountRole.WRITABLE },
    { address: bidPda, role: AccountRole.WRITABLE },
    { address: address(treasury), role: AccountRole.WRITABLE },
    { address: entitlementPda, role: AccountRole.WRITABLE },
    { address: address(bidder), role: AccountRole.WRITABLE_SIGNER },
    { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
  ], data: instructionDiscriminator("claim_entitlement") });
  return Object.freeze({ transactionBase64, blockhash: latest.value.blockhash, lastValidBlockHeight: Number(latest.value.lastValidBlockHeight), registryPda, commitmentPda, roundPda, bidPda, entitlementPda });
}

export async function buildRefundLosingBidTransaction({ rpcUrl, programId, roundPda, bidder }) {
  const registryPda = await deriveRegistryPda(programId);
  const bidPda = await deriveBidPda(programId, roundPda, bidder);
  const latest = await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "finalized" }]);
  const transactionBase64 = unsignedTransaction({ latest, programId, buyer: bidder, accounts: [
    { address: registryPda, role: AccountRole.READONLY },
    { address: address(roundPda), role: AccountRole.READONLY },
    { address: bidPda, role: AccountRole.WRITABLE },
    { address: address(bidder), role: AccountRole.WRITABLE_SIGNER },
  ], data: instructionDiscriminator("refund_losing_bid") });
  return Object.freeze({ transactionBase64, blockhash: latest.value.blockhash, lastValidBlockHeight: Number(latest.value.lastValidBlockHeight), registryPda, roundPda, bidPda });
}

export function purchaseInstructionData(tier) {
  if (![1, 2].includes(tier)) throw new Error("invalid_purchase_tier");
  return Buffer.concat([instructionDiscriminator("purchase"), Buffer.from([tier])]);
}

export function placeBidInstructionData(amountLamports, tier) {
  if (!Number.isSafeInteger(amountLamports) || amountLamports < 1 || ![1, 2].includes(tier)) throw new Error("invalid_bid_request");
  return Buffer.concat([instructionDiscriminator("place_bid"), u64(amountLamports), Buffer.from([tier])]);
}

export const solanaConstants = Object.freeze({ SYSTEM_PROGRAM, purchaseInstructionData, placeBidInstructionData, discriminator, instructionDiscriminator });
