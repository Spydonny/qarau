import { createHash } from "node:crypto";
import { AccountRole, address, appendTransactionMessageInstruction, createSolanaRpc, createTransactionMessage, getAddressEncoder, getBase64EncodedWireTransaction, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners } from "@solana/kit";
import { deriveDatasetCommitmentPda, deriveRegistryPda, deriveSalePda, readDatasetCommitment } from "../solana/registry-client.mjs";

const SYSTEM = "11111111111111111111111111111111";
function discriminator(name) { return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function u64(value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; }
function i64(value) { const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(BigInt(value)); return bytes; }
function bytes(value, name) { const parsed = Buffer.from(String(value), "hex"); if (parsed.length !== 32) throw new Error(`invalid_${name}`); return parsed; }
function publicKey(value) { return Buffer.from(getAddressEncoder().encode(address(value))); }
function instruction(programId, name, accounts, data) { return { programAddress: address(programId), accounts, data: Buffer.concat([discriminator(name), data]) }; }

export function createCommitmentData(input) {
  return Buffer.concat([bytes(input.datasetIdHash, "dataset_id_hash"), u32(input.version), bytes(input.rawSnapshotHash, "raw_snapshot_hash"), bytes(input.normalizedDatasetHash, "normalized_dataset_hash"), bytes(input.analysisManifestHash, "analysis_manifest_hash"), bytes(input.analysisResultHash, "analysis_result_hash"), bytes(input.accessPolicyHash, "access_policy_hash"), u32(input.maxSeats), Buffer.from([input.allowedTierMask]), u32(input.delayedVersionLag), i64(input.delayedReleaseSeconds), i64(input.grantDurationSeconds)]);
}
export function createSaleData(input) { return Buffer.concat([i64(input.startsAt), i64(input.endsAt), u64(input.earlyPriceLamports), u64(input.delayedPriceLamports), Buffer.from([input.enabledTierMask])]); }

async function confirm(rpc, signature, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send(); const status = response.value[0];
    if (status?.err) throw new Error("solana_transaction_failed");
    if (status?.confirmationStatus === "finalized") return { slot: Number(status.slot), confirmationStatus: status.confirmationStatus };
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("solana_finalization_timeout");
}

async function send(rpc, signer, instructions) {
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  const message = instructions.reduce((built, item) => appendTransactionMessageInstruction(item, built), pipe(createTransactionMessage({ version: 0 }), (value) => setTransactionMessageFeePayerSigner(signer, value), (value) => setTransactionMessageLifetimeUsingBlockhash(latest, value)));
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3, skipPreflight: false }).send();
  return { signature, ...(await confirm(rpc, signature)) };
}

/** Restricted publisher operation: initialize (once), commit, then create sale. */
export async function publishPackageOnChain({ signer, rpcUrl, programId, input }) {
  if (!signer || !rpcUrl || !programId || process.env.DISABLE_SOLANA_SIGNING === "true") throw new Error("publisher_signing_disabled");
  if (!/devnet|localhost|127\.0\.0\.1/i.test(rpcUrl)) throw new Error("unsupported_solana_network");
  const rpc = createSolanaRpc(rpcUrl); const registryPda = await deriveRegistryPda(programId);
  const commitmentPda = await deriveDatasetCommitmentPda(programId, bytes(input.datasetIdHash, "dataset_id_hash"), input.version); const salePda = await deriveSalePda(programId, commitmentPda);
  const treasury = input.treasury ?? signer.address;
  const registry = await rpc.getAccountInfo(registryPda, { commitment: "finalized", encoding: "base64" }).send();
  const completed = [];
  if (!registry.value) completed.push(await send(rpc, signer, [instruction(programId, "initialize", [{ address: registryPda, role: AccountRole.WRITABLE }, { address: signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: address(SYSTEM), role: AccountRole.READONLY }], publicKey(treasury))]));
  const existing = await readDatasetCommitment({ rpcUrl, programId, datasetPda: commitmentPda });
  if (!existing) completed.push(await send(rpc, signer, [instruction(programId, "create_dataset_commitment", [{ address: registryPda, role: AccountRole.READONLY }, { address: commitmentPda, role: AccountRole.WRITABLE }, { address: signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: address(SYSTEM), role: AccountRole.READONLY }], createCommitmentData(input))]));
  const sale = await rpc.getAccountInfo(salePda, { commitment: "finalized", encoding: "base64" }).send();
  if (!sale.value) completed.push(await send(rpc, signer, [instruction(programId, "create_sale", [{ address: registryPda, role: AccountRole.READONLY }, { address: commitmentPda, role: AccountRole.READONLY }, { address: salePda, role: AccountRole.WRITABLE }, { address: address(treasury), role: AccountRole.WRITABLE }, { address: signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: signer.address, role: AccountRole.READONLY }, { address: address(SYSTEM), role: AccountRole.READONLY }], createSaleData(input))]));
  return Object.freeze({ registryPda, commitmentPda, salePda, treasury, transactions: completed, finalizedSlot: completed.at(-1)?.slot ?? Number((await rpc.getSlot({ commitment: "finalized" }).send())) });
}

export const publisherInternals = Object.freeze({ createCommitmentData, createSaleData, discriminator });
