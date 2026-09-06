const GATE_NAMES = Object.freeze([
  "availability",
  "freshness",
  "history",
  "granularity",
  "coverage",
  "stability",
  "cost",
  "licensing",
  "uniqueness",
  "quant_usability",
]);

function gate(status, evidence) {
  return Object.freeze({ status, evidence: String(evidence ?? "").slice(0, 240) });
}

function known(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^(unknown|unspecified|n\/a|null)$/i.test(text);
}

/** Cheap metadata-only gate. It rejects weak candidates before network ingestion. */
export function screenCandidate(candidate, { unique = true } = {}) {
  const url = new URL(candidate.url);
  const fields = Array.isArray(candidate.expectedFields) ? candidate.expectedFields.map(String) : [];
  const temporal = candidate.temporalCoverage && typeof candidate.temporalCoverage === "object"
    ? Object.values(candidate.temporalCoverage).join(" ")
    : candidate.temporalCoverage;
  const free = !known(candidate.pricingType) || /^free$/i.test(String(candidate.pricingType));
  const license = String(candidate.licenseSummary ?? "");
  const gates = {
    availability: gate(url.protocol === "https:" && known(candidate.sourceType) ? "pass" : "fail", `${url.protocol} ${candidate.sourceType ?? "unknown type"}`),
    freshness: gate(known(candidate.updateFrequency) ? "pass" : "fail", candidate.updateFrequency ?? "frequency missing"),
    history: gate(Number(candidate.historicalDepth ?? 0) >= 1 || known(temporal) ? "pass" : "fail", candidate.historicalDepth ?? temporal ?? "history missing"),
    granularity: gate(fields.length >= 2 || known(candidate.temporalResolution) ? "pass" : "fail", fields.length ? `${fields.length} expected fields` : candidate.temporalResolution ?? "granularity missing"),
    coverage: gate(known(candidate.region) ? "pass" : "fail", candidate.region ?? "coverage missing"),
    stability: gate(known(candidate.discoveryProvider) && known(candidate.provider) ? "pass" : "fail", candidate.discoveryProvider ?? candidate.provider ?? "provider missing"),
    cost: gate(free ? "pass" : "fail", candidate.pricingType ?? "public catalog; price not asserted"),
    licensing: gate(/open|public domain|cc[- ]?by|government/i.test(license) ? "pass" : "warn", license || "owner review required"),
    uniqueness: gate(unique ? "pass" : "fail", unique ? "canonical URL is new" : "canonical URL already known"),
    quant_usability: gate(fields.some((field) => !/^timestamp|date|time$/i.test(field)) || candidate.historicalDataAvailable === true ? "pass" : "fail", fields.join(", ") || "numeric history not evidenced"),
  };
  const score = GATE_NAMES.filter((name) => gates[name].status === "pass").length;
  const rejectionReasons = GATE_NAMES.filter((name) => gates[name].status === "fail");
  return Object.freeze({ gates, score, passed: score >= 8 && gates.availability.status === "pass" && gates.cost.status === "pass", rejectionReasons });
}

export const screeningGateNames = GATE_NAMES;
