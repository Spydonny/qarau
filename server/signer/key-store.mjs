import { createKeyPairSignerFromBytes, generateKeyPairSigner, writeKeyPairSigner } from "@solana/kit";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const signerPrivateDir = join(here, "..", "data", "private", "signer");
export const signerKeyPath = join(signerPrivateDir, "operational-devnet.json");
export const signerLedgerPath = join(signerPrivateDir, "ledger.json");

export async function operationalSigner() {
  try { return await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(await readFile(signerKeyPath, "utf8")))); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(signerPrivateDir, { recursive: true });
    const created = await generateKeyPairSigner(true);
    await writeKeyPairSigner(created, signerKeyPath);
    await chmod(signerKeyPath, 0o600).catch(() => {});
    return created;
  }
}

/** The isolated publisher role is the only process permitted to create this key. */
export async function publisherSigner(keyPath = process.env.SOLANA_PUBLISHER_KEY_PATH) {
  if (!keyPath) throw new Error("publisher_key_path_required");
  try { return await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(await readFile(keyPath, "utf8")))); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(dirname(keyPath), { recursive: true });
    const created = await generateKeyPairSigner(true);
    await writeKeyPairSigner(created, keyPath);
    await chmod(keyPath, 0o600).catch(() => {});
    return created;
  }
}
