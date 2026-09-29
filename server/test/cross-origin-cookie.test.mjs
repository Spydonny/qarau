import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { hashPassword, initOwner, registerAuthRoutes } from "../auth.mjs";

test("owner session cookie works for the configured HTTPS front end", async () => {
  const original = { ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN, COOKIE_SECURE: process.env.COOKIE_SECURE, OWNER_PASSWORD_HASH: process.env.OWNER_PASSWORD_HASH };
  const password = "cookie-policy-test";
  process.env.ALLOWED_ORIGIN = "https://frontend.example";
  process.env.COOKIE_SECURE = "true";
  process.env.OWNER_PASSWORD_HASH = await hashPassword(password);
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  await initOwner();
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /SameSite=None/);
    assert.match(response.headers.get("set-cookie"), /Secure/);
  } finally {
    server.close();
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
