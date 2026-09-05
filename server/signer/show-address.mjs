import { operationalSigner } from "./key-store.mjs";

const signer = await operationalSigner();
process.stdout.write(`${signer.address}\n`);
