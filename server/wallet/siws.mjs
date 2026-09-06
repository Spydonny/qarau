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

/** Database-backed SIWS challenge, verification, session and logout service. */
export function createSiwsService({ pool, domain, uri, chainId = "solana:devnet" }) {
  if (!pool || !domain || !uri) throw new Error("siws_configuration_required");
  async function challenge({ address = null } = {}) {
    if (address !== null) base58Decode(address);
    const nonce = randomBytes(24).toString("base64url");
    const issuedAt = new Date(); const expiresAt = new Date(issuedAt.getTime() + NONCE_MS);
    await pool.query("INSERT INTO wallet_nonces (nonce_hash, expected_address, domain, uri, chain_id, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [sha(nonce), address, domain, uri, chainId, issuedAt, expiresAt]);
    return Object.freeze({ nonce, domain, uri, chain_id: chainId, issued_at: issuedAt.toISOString(), expiration_time: expiresAt.toISOString() });
  }
  async function authenticate(req) {
    const token = cookie(req, COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
    const result = await pool.query(
      `UPDATE wallet_sessions AS session
       SET last_seen_at = now(), idle_expires_at = LEAST(session.absolute_expires_at, now() + interval '2 hours')
       FROM user_wallets AS wallet
       WHERE session.token_hash = $1 AND session.wallet_id = wallet.id AND session.idle_expires_at > now() AND session.absolute_expires_at > now()
       RETURNING wallet.id AS wallet_id, wallet.address, session.idle_expires_at, session.absolute_expires_at`,
      [sha(token)],
    );
    return result.rows[0] ?? null;
  }
  return Object.freeze({
    challenge,
    async verify({ address, nonce, signature }) {
      const addressBytes = base58Decode(address);
      if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{20,}$/.test(nonce)) throw new Error("invalid_siws_nonce");
      const nonceRow = await pool.query("SELECT * FROM wallet_nonces WHERE nonce_hash = $1 AND consumed_at IS NULL AND expires_at > now()", [sha(nonce)]);
      const challengeRow = nonceRow.rows[0];
      if (!challengeRow || challengeRow.expected_address && challengeRow.expected_address !== address) throw new Error("siws_challenge_expired");
      const message = formatSiwsMessage({ domain: challengeRow.domain, address, uri: challengeRow.uri, chainId: challengeRow.chain_id, nonce, issuedAt: new Date(challengeRow.issued_at).toISOString(), expirationTime: new Date(challengeRow.expires_at).toISOString() });
      if (!verifySolanaSignature({ address, message, signature })) throw new Error("siws_signature_invalid");
      const token = randomBytes(32).toString("base64url");
      const transaction = await pool.connect();
      try {
        await transaction.query("BEGIN");
        const consumed = await transaction.query("UPDATE wallet_nonces SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id", [challengeRow.id]);
        if (!consumed.rowCount) throw new Error("siws_challenge_expired");
        const wallet = await transaction.query("INSERT INTO user_wallets (address, last_authenticated_at) VALUES ($1, now()) ON CONFLICT (address) DO UPDATE SET last_authenticated_at = now() RETURNING id, address", [address]);
        const now = new Date(); const absolute = new Date(now.getTime() + ABSOLUTE_MS); const idle = new Date(now.getTime() + IDLE_MS);
        await transaction.query("INSERT INTO wallet_sessions (token_hash, wallet_id, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4)", [sha(token), wallet.rows[0].id, idle, absolute]);
        await transaction.query("COMMIT");
        return Object.freeze({ token, wallet: wallet.rows[0], issued_at: now.toISOString(), expires_at: absolute.toISOString(), public_key_bytes: addressBytes.length });
      } catch (error) { await transaction.query("ROLLBACK"); throw error; } finally { transaction.release(); }
    },
    async logout(req) { const token = cookie(req, COOKIE); if (token) await pool.query("DELETE FROM wallet_sessions WHERE token_hash = $1", [sha(token)]); },
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
