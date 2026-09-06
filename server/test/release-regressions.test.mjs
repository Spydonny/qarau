import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const rootFile = (path) => new URL(`../../${path}`, import.meta.url);

test("runtime filesystem contains frozen contracts", async () => {
  const contract = JSON.parse(await readFile(rootFile("contracts/api-v1.json"), "utf8"));
  assert.equal(contract.schema_version, 1);
  assert.deepEqual(contract.schemas.AnalysisRun.pagination, { default_limit: 20, maximum_limit: 100, offset: "non_negative_integer" });
});

test("document shell satisfies the self-only CSP", async () => {
  const html = await readFile(rootFile("dist/index.html"), "utf8");
  assert.equal(html.includes("fonts.googleapis.com"), false);
  assert.equal(html.includes("fonts.gstatic.com"), false);
  assert.equal(/<style(?:\s|>)/i.test(html), false);
});

test("CSP allows React layout styles without allowing inline scripts", async () => {
  const server = await readFile(rootFile("server/index.mjs"), "utf8");
  assert.match(server, /style-src 'self' 'unsafe-inline'/);
  assert.equal(server.includes("script-src 'self' 'unsafe-inline'"), false);
});

test("Devnet publication can resume after a failed attempt", async () => {
  const api = await readFile(rootFile("server/api/v1.mjs"), "utf8");
  const chain = await readFile(rootFile("server/jobs/handlers/chain-publish.mjs"), "utf8");
  assert.match(api, /publication_failed/);
  assert.match(api, /status IN \('queued', 'running', 'retry_wait'\)/);
  assert.match(chain, /\["sealed", "commit_pending", "publication_failed", "committed"\]/);
  assert.match(chain, /status IN \('sealed', 'commit_pending', 'publication_failed'\)/);
});

test("signer address command reads the configured persistent publisher key", async () => {
  const script = await readFile(rootFile("server/signer/show-address.mjs"), "utf8");
  assert.match(script, /SOLANA_PUBLISHER_KEY_PATH/);
  assert.match(script, /publisherSigner\(process\.env\.SOLANA_PUBLISHER_KEY_PATH\)/);
});

test("authenticated navigation exposes only the durable V1 pipeline", async () => {
  try {
    const app = await readFile(rootFile("src/App.tsx"), "utf8");
    const nav = await readFile(rootFile("src/components/Nav.tsx"), "utf8");
    const authenticate = await readFile(rootFile("src/pages/Authenticate.tsx"), "utf8");
    for (const legacyPage of ["Discovery", "Signals", "SignalDetail", "Data", "Runs", "SourceDetail"]) {
      assert.equal(app.includes(`./pages/${legacyPage}`), false);
    }
    for (const legacyTarget of ["/discovery", "/signals", "/data", "/runs"]) {
      assert.equal(nav.includes(`to: "${legacyTarget}"`), false);
    }
    assert.match(app, /path="\/" element={<Navigate to="\/opportunities" replace \/>}/);
    assert.match(app, /pathname === "\/admin" \|\| pathname\.startsWith\("\/admin\/"\)/);
    assert.match(app, /path="\/admin\/pipeline" element={<Pipeline \/>}/);
    assert.match(nav, /to: "\/admin\/pipeline"/);
    assert.match(authenticate, /QARAU Research Console/);
    assert.match(authenticate, /Owner only/);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const assets = await readdir(rootFile("dist/assets"));
    const scripts = await Promise.all(assets.filter((name) => name.endsWith(".js")).map((name) => readFile(rootFile(`dist/assets/${name}`), "utf8")));
    const bundle = scripts.join("\n");
    assert.ok(bundle.includes("Durable pipeline"));
    assert.ok(bundle.includes("/api/v1/analysis-runs/"));
    assert.ok(bundle.includes("Package sealing writes immutable policy"));
  }
});

test("owner session checks are scoped to the admin namespace", async () => {
  const session = await readFile(rootFile("src/api/session.tsx"), "utf8");
  const main = await readFile(rootFile("src/main.tsx"), "utf8");
  assert.match(session, /useLocation/);
  assert.match(session, /pathname === "\/admin" \|\| pathname\.startsWith\("\/admin\/"\)/);
  assert.match(session, /if \(!isAdminRoute\)/);
  assert.match(main, /<BrowserRouter>\s*<SessionProvider>/s);
});

test("integration-test database guard rejects production-shaped names", async () => {
  const { testDatabaseUrl } = await import("./database-url.mjs");
  assert.equal(testDatabaseUrl({}), undefined);
  assert.equal(testDatabaseUrl({ TEST_DATABASE_URL: "postgresql://owner:secret@localhost:5432/qarau_test" }), "postgresql://owner:secret@localhost:5432/qarau_test");
  assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: "postgresql://owner:secret@localhost:5432/qarau" }), /Refusing to run/);
});
