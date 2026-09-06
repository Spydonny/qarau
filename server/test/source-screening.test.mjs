import assert from "node:assert/strict";
import test from "node:test";
import { screenCandidate, screeningGateNames } from "../discovery/screening.mjs";

test("cheap source screening evaluates all ten constitutional gates", () => {
  const result = screenCandidate({
    url: "https://data.example.org/observations.json",
    sourceType: "json_api",
    updateFrequency: "DAILY",
    historicalDepth: 3,
    temporalResolution: "DAILY",
    region: "Chicago",
    provider: "City of Chicago",
    discoveryProvider: "PUBLIC_CATALOG",
    pricingType: "FREE",
    licenseSummary: "Public domain government data",
    expectedFields: ["timestamp", "temperature"],
    historicalDataAvailable: true,
  });
  assert.deepEqual(Object.keys(result.gates), [...screeningGateNames]);
  assert.equal(result.score, 10);
  assert.equal(result.passed, true);
});

test("weak or duplicate candidates are rejected before ingestion", () => {
  const result = screenCandidate({
    url: "http://example.org/page",
    sourceType: "html",
    updateFrequency: "UNSPECIFIED",
    region: "Unspecified",
    provider: "unknown",
    discoveryProvider: "WEB_SEARCH",
    expectedFields: ["timestamp"],
  }, { unique: false });
  assert.equal(result.passed, false);
  assert.ok(result.rejectionReasons.includes("availability"));
  assert.ok(result.rejectionReasons.includes("uniqueness"));
  assert.ok(result.rejectionReasons.includes("quant_usability"));
});
