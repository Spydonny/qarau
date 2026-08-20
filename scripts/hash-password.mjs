/**
 * Generates an OWNER_PASSWORD_HASH for .env.
 *
 *   npm run auth:hash -- 'your-password'
 *
 * The password is never written to disk — only the scrypt digest is printed.
 */
import { hashPassword } from "../server/auth.mjs";

const password = process.argv[2];
if (!password) {
  console.error("usage: npm run auth:hash -- 'your-password'");
  process.exit(1);
}
if (password.length < 12) {
  console.error("refusing: use at least 12 characters for a single-owner system");
  process.exit(1);
}

console.log(`\nOWNER_PASSWORD_HASH=${await hashPassword(password)}\n`);
