import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFrom(value) {
  if (!/^[0-9a-f]{64}$/i.test(String(value))) throw new Error("source_url_encryption_key_required");
  return Buffer.from(value, "hex");
}

export function encryptSourceUrl(url, key) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid_source_url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(key), iv);
  const ciphertext = Buffer.concat([cipher.update(parsed.toString(), "utf8"), cipher.final()]);
  return Buffer.from(`v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`, "utf8");
}

export function decryptSourceUrl(ciphertext, key) {
  const [version, iv, tag, body, ...rest] = Buffer.from(ciphertext).toString("utf8").split(".");
  if (version !== "v1" || rest.length || !iv || !tag || !body) throw new Error("invalid_source_url_ciphertext");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(key), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const url = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    return new URL(url).toString();
  } catch {
    throw new Error("source_url_decryption_failed");
  }
}
