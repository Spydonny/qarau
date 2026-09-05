import assert from "node:assert/strict";
import test from "node:test";
import { discoverCandidates, discoveryProviderOptions } from "../discovery/providers.mjs";

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
