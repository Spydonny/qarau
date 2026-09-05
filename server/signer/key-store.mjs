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
