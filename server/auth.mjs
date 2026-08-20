import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/* ============================================================
   OWNER AUTHENTICATION

   Single-owner, closed system. There is no registration route,
   no password reset, and no second account. Everything the
   research side exposes sits behind requireOwner().

   Scope, stated plainly: sessions live in memory, so a restart
   signs the owner out and this runs as a single instance. That
   is adequate for one operator and is the piece to replace
   first if this ever runs anywhere real.
   ============================================================ */

const COOKIE = "sid";
const KEYLEN = 64;

/** Sessions expire on both counts, whichever comes first. */
const IDLE_MS = 1000 * 60 * 60 * 2; // 2 hours untouched
const ABSOLUTE_MS = 1000 * 60 * 60 * 12; // 12 hours total

/** Login throttling, per client address. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 1000 * 60 * 15;

const sessions = new Map();
const attempts = new Map();

let ownerId = process.env.OWNER_ID ?? "01";
let credential = null;
/** Set only when the server had to invent a password at boot. */
let generatedPassword = null;

/** `scrypt` digest as salt:hash, both hex. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(":");
  if (!saltHex || !hashHex) return false;

  let expected;
  try {
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), KEYLEN);
  // Constant-time: a length-dependent early return would leak the digest size.
  return timingSafeEqual(derived, expected);
}

/**
 * Reads the owner credential from the environment. If none is configured the
 * server mints a random one and prints it once, so an unconfigured install is
 * never reachable with a default password that is sitting in the repository.
 */
export async function initOwner() {
  const configured = process.env.OWNER_PASSWORD_HASH;
  if (configured) {
    credential = configured;
    return { generated: false, ownerId };
  }

  generatedPassword = randomBytes(12).toString("base64url");
  credential = await hashPassword(generatedPassword);
  return { generated: true, ownerId, password: generatedPassword };
}

function clientKey(req) {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function throttle(req) {
  const key = clientKey(req);
  const rec = attempts.get(key);
  if (!rec) return { locked: false };
  if (rec.until && rec.until > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((rec.until - Date.now()) / 1000) };
  }
  if (rec.until && rec.until <= Date.now()) attempts.delete(key);
  return { locked: false };
}

function recordFailure(req) {
  const key = clientKey(req);
  const rec = attempts.get(key) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.until = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  attempts.set(key, rec);
}

function clearFailures(req) {
  attempts.delete(clientKey(req));
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, // never readable from page scripts
    sameSite: "strict", // no cross-site submission carries it
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ABSOLUTE_MS,
  });
}

function createSession() {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  sessions.set(token, { ownerId, createdAt: now, lastSeen: now });
  return token;
}

function readSession(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  const now = Date.now();
  if (now - session.lastSeen > IDLE_MS || now - session.createdAt > ABSOLUTE_MS) {
    sessions.delete(token);
    return null;
  }

  session.lastSeen = now;
  return { token, session };
}

/**
 * Gate for every research route. Responds 401 and nothing else — an
 * unauthenticated caller learns only that the endpoint exists.
 */
export function requireOwner(req, res, next) {
  const found = readSession(req);
  if (!found) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.owner = { id: found.session.ownerId };
  next();
}

export function registerAuthRoutes(app) {
  app.post("/api/auth/login", async (req, res) => {
    const locked = throttle(req);
    if (locked.locked) {
      res.status(429).json({ error: "too_many_attempts", retryAfter: locked.retryAfter });
      return;
    }

    const password = req.body?.password;
    if (typeof password !== "string" || password.length === 0 || password.length > 512) {
      recordFailure(req);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const ok = await verifyPassword(password, credential);
    if (!ok) {
      recordFailure(req);
      // Deliberately identical to every other failure: no hint about which
      // part was wrong, and no indication of whether an owner is configured.
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    clearFailures(req);
    setSessionCookie(res, createSession());
    res.json({ owner: { id: ownerId }, environment: "private" });
  });

  app.post("/api/auth/logout", (req, res) => {
    const found = readSession(req);
    if (found) sessions.delete(found.token);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/session", (req, res) => {
    const found = readSession(req);
    if (!found) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({
      owner: { id: found.session.ownerId },
      environment: "private",
      issuedAt: new Date(found.session.createdAt).toISOString(),
    });
  });
}

export function authBanner() {
  if (!generatedPassword) return null;
  return generatedPassword;
}
