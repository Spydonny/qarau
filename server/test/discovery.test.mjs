import assert from "node:assert/strict";
import test from "node:test";
import { AutomatedCatalogSearchDiscoveryProvider, discoverCandidates, discoveryProviderOptions } from "../discovery/providers.mjs";

test("public catalog discovery is bounded, real, and provider-neutral", async () => {
  const candidates = await discoverCandidates({ provider: "PUBLIC_CATALOG" });
  assert.ok(candidates.length >= 8 && candidates.length <= 20);
  assert.ok(candidates.every((candidate) => candidate.url.startsWith("https://") && candidate.historicalDataAvailable));
  assert.ok(new Set(candidates.map((candidate) => candidate.category)).size >= 8);
});

test("unconfigured web search fails closed", async () => {
  const option = discoveryProviderOptions().find((provider) => provider.id === "WEB_SEARCH");
  if (!option.configured) await assert.rejects(() => discoverCandidates({ provider: "WEB_SEARCH", query: "traffic data" }), /configuration_required/);
});

test("automated discovery generates catalogue queries rather than returning seed URLs", async () => {
  const seen = [];
  const provider = new AutomatedCatalogSearchDiscoveryProvider({ requestText: async (url) => {
    seen.push(String(url));
    return { text: JSON.stringify({ results: [{ dcat: { title: "Live Port Data", description: "Daily freight throughput", publisher: { name: "Fixture authority" }, distribution: [{ title: "Download", downloadURL: "https://data.example.test/live.csv", mediaType: "text/csv" }] } }] }) };
  } });
  const candidates = await provider.discover({ queryGroup: "logistics", limit: 4 });
  assert.ok(seen.length >= 2);
  assert.equal(candidates[0].url, "https://data.example.test/live.csv");
  assert.equal(candidates[0].sourceType, "csv");
  assert.deepEqual(candidates[0].expectedFields, ["timestamp", "count_or_volume"]);
});

test("automated discovery falls back to a live catalog protocol when Data.gov is rate limited", async () => {
  const provider = new AutomatedCatalogSearchDiscoveryProvider({ requestText: async (url) => {
    if (String(url).includes("api.gsa.gov")) { const error = new Error("external_rate_limited"); error.retryAfterSeconds = 60; throw error; }
    return { text: JSON.stringify({ results: [{ metadata: { domain: "data.example.test" }, classification: { domain_category: "Weather", domain_metadata: [{ key: "Refresh-Frequency", value: "Hourly" }] }, resource: { id: "abcd-1234", name: "Road weather", description: "Station temperature readings", updatedAt: "2026-01-01", columns_field_name: ["datetime", "temperature"] } }] }) };
  } });
  const candidates = await provider.discover({ queryGroup: "weather", limit: 1 });
  assert.equal(candidates[0].url, "https://data.example.test/resource/abcd-1234.json?$limit=10000");
  assert.equal(candidates[0].sourceType, "json_api");
  assert.deepEqual(candidates[0].expectedFields, ["datetime", "temperature"]);
});
