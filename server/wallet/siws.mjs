import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

const COOKIE = "qarau_wallet_session";
const IDLE_MS = 2 * 60 * 60 * 1_000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1_000;
const NONCE_MS = 5 * 60 * 1_000;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

function secureCookies() {
  return process.env.COOKIE_SECURE == null ? process.env.NODE_ENV === "production" : process.env.COOKIE_SECURE === "true";
}

function sha(value) { return createHash("sha256").update(value).digest(); }
function cookie(req, name) { for (const part of String(req.headers.cookie ?? "").split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return decodeURIComponent(rest.join("=")); } return null; }

function base58Decode(input) {
  if (typeof input !== "string" || input.length < 32 || input.length > 44) throw new Error("invalid_wallet_address");
  const bytes = [0];
  for (const character of input) {
    const value = BASE58.indexOf(character);
    if (value < 0) throw new Error("invalid_wallet_address");
    let carry = value;
    for (let index = 0; index < bytes.length; index += 1) { carry += bytes[index] * 58; bytes[index] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const character of input) { if (character !== "1") break; bytes.push(0); }
  const output = Buffer.from(bytes.reverse());
  if (output.length !== 32) throw new Error("invalid_wallet_address");
  return output;
}

export function formatSiwsMessage({ domain, address, uri, chainId, nonce, issuedAt, expirationTime }) {
  return `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to QARAU research access.\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
}

export function verifySolanaSignature({ address, message, signature }) {
  const publicKey = base58Decode(address);
  let bytes;
  try { bytes = Buffer.from(String(signature), "base64"); } catch { return false; }
  if (bytes.length !== 64 || typeof message !== "string" || message.length > 2_048) return false;
  try { return verify(null, Buffer.from(message, "utf8"), createPublicKey({ key: Buffer.concat([ED25519_SPKI, publicKey]), format: "der", type: "spki" }), bytes); }
  catch { return false; }
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: secureCookies(), path: "/", maxAge: ABSOLUTE_MS });
}

/** Database-backed SIWS challenge, verification, session and logout service (MongoDB). */
export function createSiwsService({ db, domain, uri, chainId = "solana:devnet" }) {
  if (!db || !domain || !uri) throw new Error("siws_configuration_required");
  const nonces = db.collection("wallet_nonces");
  const wallets = db.collection("user_wallets");
  const sessions = db.collection("wallet_sessions");
  async function challenge({ address = null } = {}) {
    if (address !== null) base58Decode(address);
    const nonce = randomBytes(24).toString("base64url");
    const issuedAt = new Date(); const expiresAt = new Date(issuedAt.getTime() + NONCE_MS);
    await nonces.insertOne({ nonce_hash: sha(nonce), expected_address: address, domain, uri, chain_id: chainId, issued_at: issuedAt, expires_at: expiresAt, consumed_at: null });
    return Object.freeze({ nonce, domain, uri, chain_id: chainId, issued_at: issuedAt.toISOString(), expiration_time: expiresAt.toISOString() });
  }
  async function authenticate(req) {
    const token = cookie(req, COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
    const now = new Date();
    const session = await sessions.findOne({ _id: sha(token), idle_expires_at: { $gt: now }, absolute_expires_at: { $gt: now } });
    if (!session) return null;
    const idleExpires = new Date(Math.min(session.absolute_expires_at.getTime(), now.getTime() + IDLE_MS));
    await sessions.updateOne({ _id: session._id }, { $set: { last_seen_at: now, idle_expires_at: idleExpires } });
    const wallet = await wallets.findOne({ _id: session.wallet_id }, { projection: { address: 1 } });
    if (!wallet) return null;
    return { wallet_id: wallet._id, address: wallet.address, idle_expires_at: idleExpires, absolute_expires_at: session.absolute_expires_at };
  }
  return Object.freeze({
    challenge,
    async verify({ address, nonce, signature }) {
      const addressBytes = base58Decode(address);
      if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{20,}$/.test(nonce)) throw new Error("invalid_siws_nonce");
      const now = new Date();
      const challengeRow = await nonces.findOne({ nonce_hash: sha(nonce), consumed_at: null, expires_at: { $gt: now } });
      if (!challengeRow || (challengeRow.expected_address && challengeRow.expected_address !== address)) throw new Error("siws_challenge_expired");
      const message = formatSiwsMessage({ domain: challengeRow.domain, address, uri: challengeRow.uri, chainId: challengeRow.chain_id, nonce, issuedAt: challengeRow.issued_at.toISOString(), expirationTime: challengeRow.expires_at.toISOString() });
      if (!verifySolanaSignature({ address, message, signature })) throw new Error("siws_signature_invalid");
      const token = randomBytes(32).toString("base64url");
      const consumed = await nonces.findOneAndUpdate({ _id: challengeRow._id, consumed_at: null, expires_at: { $gt: new Date() } }, { $set: { consumed_at: new Date() } }, { returnDocument: "after" });
      if (!consumed) throw new Error("siws_challenge_expired");
      const wallet = await wallets.findOneAndUpdate({ address }, { $set: { last_authenticated_at: new Date() }, $setOnInsert: { first_seen_at: new Date() } }, { upsert: true, returnDocument: "after" });
      const issued = new Date(); const absolute = new Date(issued.getTime() + ABSOLUTE_MS); const idle = new Date(issued.getTime() + IDLE_MS);
      await sessions.insertOne({ _id: sha(token), wallet_id: wallet._id, created_at: issued, last_seen_at: issued, idle_expires_at: idle, absolute_expires_at: absolute });
      return Object.freeze({ token, wallet: { id: wallet._id, address: wallet.address }, issued_at: issued.toISOString(), expires_at: absolute.toISOString(), public_key_bytes: addressBytes.length });
    },
    async logout(req) { const token = cookie(req, COOKIE); if (token) await sessions.deleteOne({ _id: sha(token) }); },
    authenticate,
    setCookie,
    clearCookie(res) { res.clearCookie(COOKIE, { path: "/", sameSite: "strict", secure: secureCookies() }); },
  });
}

export function requireWallet(siws) {
  return async (req, res, next) => {
    try { const session = await siws.authenticate(req); if (!session) { res.status(401).json({ error: "wallet_unauthorized" }); return; } req.wallet = session; next(); }
    catch { res.status(401).json({ error: "wallet_unauthorized" }); }
  };
}

export const siwsInternals = Object.freeze({ base58Decode, cookie, sha, timingSafeEqual });
