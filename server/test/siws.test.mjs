import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { formatSiwsMessage, verifySolanaSignature } from "../wallet/siws.mjs";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) { let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`); let out = ""; while (number) { out = alphabet[Number(number % 58n)] + out; number /= 58n; } return "1".repeat(bytes.findIndex((byte) => byte !== 0) === -1 ? bytes.length : bytes.findIndex((byte) => byte !== 0)) + (out || "1"); }

test("SIWS verifies an Ed25519 signature for the exact server-generated message", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = base58Encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const message = formatSiwsMessage({ domain: "localhost", address, uri: "http://localhost:5173", chainId: "solana:devnet", nonce: "a".repeat(32), issuedAt: "2026-09-06T00:00:00.000Z", expirationTime: "2026-09-06T00:05:00.000Z" });
  const signature = sign(null, Buffer.from(message), privateKey).toString("base64");
  assert.equal(verifySolanaSignature({ address, message, signature }), true);
  assert.equal(verifySolanaSignature({ address, message: `${message} changed`, signature }), false);
});
