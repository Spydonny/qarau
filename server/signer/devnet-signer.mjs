import {
  address,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  getBase64EncodedWireTransaction,
  getUtf8Encoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { enforceDailyLimit, validateIntent } from "./policy.mjs";
import { operationalSigner, signerLedgerPath } from "./key-store.mjs";

const DEVNET_HTTP = "https://api.devnet.solana.com";
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const DAILY_TRANSACTION_LIMIT = 24;

async function input() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 2_048) throw new Error("intent_too_large");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function ledger() {
  try { return JSON.parse(await readFile(signerLedgerPath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

async function waitForConfirmation(rpc, signature, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    const status = response.value[0];
    if (status?.err) throw new Error("devnet_transaction_failed");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("devnet_confirmation_timeout");
}

async function ensureDevnetFunds(rpc, operationalSigner) {
  const balance = await rpc.getBalance(operationalSigner.address, { commitment: "confirmed" }).send();
  if (balance.value >= 50_000n) return;
  if (process.env.DEV_AUTO_AIRDROP !== "true") throw new Error("devnet_signer_needs_funding");
  try {
    const signature = await rpc.requestAirdrop(operationalSigner.address, lamports(10_000_000n)).send();
    await waitForConfirmation(rpc, signature);
  } catch {
    throw new Error("devnet_signer_needs_funding");
  }
}

async function main() {
  const intent = validateIntent(await input());
  const entries = await ledger();
  const existing = entries.find((entry) => entry.root === intent.root && entry.epoch === intent.epoch);
  if (existing) { process.stdout.write(JSON.stringify(existing)); return; }
  const day = new Date().toISOString().slice(0, 10);
  enforceDailyLimit(entries, day, DAILY_TRANSACTION_LIMIT);

  const operationalSignerKey = await operationalSigner();
  const rpc = createSolanaRpc(devnet(DEVNET_HTTP));
  await ensureDevnetFunds(rpc, operationalSignerKey);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const memo = JSON.stringify({ protocol: "QARAU", ...intent });
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(operationalSignerKey, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) => appendTransactionMessageInstruction({ programAddress: MEMO_PROGRAM, data: getUtf8Encoder().encode(memo) }, message),
  );
  const transaction = await signTransactionMessageWithSigners(transactionMessage);
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: "base64", maxRetries: 3, preflightCommitment: "confirmed", skipPreflight: false }).send();
  const status = await waitForConfirmation(rpc, signature);
  const result = { action: intent.action, epoch: intent.epoch, root: intent.root, version: intent.version, network: "devnet", program: MEMO_PROGRAM, signer: operationalSignerKey.address, signature, slot: Number(status.slot), confirmationStatus: status.confirmationStatus, verifiedAt: new Date().toISOString(), day };
  entries.push(result);
  await mkdir(dirname(signerLedgerPath), { recursive: true });
  await writeFile(signerLedgerPath, JSON.stringify(entries), { mode: 0o600 });
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => { process.stderr.write(String(error?.message || "signer_failed")); process.exitCode = 1; });
