import { operationalSigner, publisherSigner } from "./key-store.mjs";

const signer = process.env.SOLANA_PUBLISHER_KEY_PATH
  ? await publisherSigner(process.env.SOLANA_PUBLISHER_KEY_PATH)
  : await operationalSigner();
process.stdout.write(`${signer.address}\n`);
