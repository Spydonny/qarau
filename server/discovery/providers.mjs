import { requestExternalText, validateExternalUrl } from "../lib/url-policy.mjs";
import { SOURCE_CATALOG } from "../providers/real-data.mjs";

const SEARCH_TERMS = Object.freeze({
  general: ["weather", "energy", "traffic"],
  logistics: ["freight", "traffic", "port"],
  energy: ["energy", "electricity", "production"],
  weather: ["weather", "precipitation", "temperature"],
  crypto: ["digital asset", "financial market", "internet traffic"],
});

function discoveryQueries(group = "general") {
  const normalized = String(group).toLowerCase().replace(/[^a-z]+/g, "");
  return SEARCH_TERMS[normalized] ?? SEARCH_TERMS.general;
}

function sourceType({ format = "", url = "", description = "" }) {
  const text = `${format} ${url} ${description}`.toLowerCase();
  if (/\b(csv|tsv)\b|\.csv(?:$|\?)/.test(text)) return "csv";
  if (/\b(json|api|geojson)\b|\.json(?:$|\?)/.test(text)) return "json_api";
  if (/\b(html|table|web page)\b/.test(text)) return "html";
  return "download";
}

function expectedFields(description = "") {
  const text = String(description).toLowerCase();
  const values = [];
  if (/traffic|throughput|volume|count|passenger|freight/.test(text)) values.push("count_or_volume");
  if (/temperature|precipitation|weather|wind/.test(text)) values.push("weather_measurement");
  if (/price|market|economic|production|demand|energy/.test(text)) values.push("numeric_measurement");
  return ["timestamp", ...values.length ? values : ["numeric_measurement"]];
}

function socrataFrequency(item) {
  return String(item?.classification?.domain_metadata?.find((entry) => /frequency/i.test(String(entry?.key)))?.value || "UNSPECIFIED").slice(0, 120);
}

export class PublicCatalogDiscoveryProvider {
  id = "PUBLIC_CATALOG";
  configured = true;

  async discover({ keys = [] } = {}) {
    const selected = Array.isArray(keys) && keys.length ? SOURCE_CATALOG.filter((entry) => keys.includes(entry.key)) : SOURCE_CATALOG;
    return selected.map((entry) => ({
      url: entry.documentationUrl,
      name: entry.name,
      provider: entry.provider,
      category: entry.category,
      region: entry.region,
      catalogKey: entry.key,
      discoveryProvider: entry.provider,
      sourceType: "PUBLIC_API",
      description: entry.description,
      documentationUrl: entry.documentationUrl,
      temporalResolution: entry.provider === "WORLD_BANK" ? "ANNUAL" : "DAILY",
      spatialResolution: entry.provider === "WORLD_BANK" ? "NATIONAL" : entry.provider === "USGS" ? "MONITORING_STATION" : "POINT_COORDINATE",
      updateFrequency: entry.provider === "WORLD_BANK" ? "ANNUAL" : "DAILY",
      latency: entry.provider === "WORLD_BANK" ? "APPROX_1Y" : entry.provider === "OPEN_METEO" ? "5D" : "1D",
      historicalDepth: entry.provider === "WORLD_BANK" ? 30 : 3,
      accessType: "API",
      pricingType: "FREE",
      licenseSummary: "Provider terms apply",
      dataFormats: ["JSON"],
      apiAvailable: true,
      historicalDataAvailable: true,
    }));
  }
}

export class ConfiguredWebSearchDiscoveryProvider {
  id = "WEB_SEARCH";

  get configured() { return Boolean(process.env.WEB_SEARCH_ENDPOINT_TEMPLATE); }

  async discover({ query } = {}) {
    const term = String(query || "").trim().slice(0, 160);
    const template = process.env.WEB_SEARCH_ENDPOINT_TEMPLATE;
    if (!term || !template || !template.includes("{query}")) throw new Error("web_search_configuration_required");
    const endpoint = validateExternalUrl(template.replace("{query}", encodeURIComponent(term)));
    const response = await requestExternalText(endpoint, {
      maxBytes: 512_000,
      timeoutMs: 12_000,
      headers: process.env.WEB_SEARCH_API_KEY ? { Authorization: `Bearer ${process.env.WEB_SEARCH_API_KEY}`, Accept: "application/json" } : { Accept: "application/json" },
    });
    let payload;
    try { payload = JSON.parse(response.text); } catch { throw new Error("invalid_web_search_response"); }
    const results = Array.isArray(payload) ? payload : payload.results ?? payload.items ?? payload.web?.results;
    if (!Array.isArray(results)) throw new Error("invalid_web_search_response");
    return results.slice(0, 20).flatMap((item) => {
      const url = item?.url ?? item?.link;
      if (typeof url !== "string") return [];
      return [{ url, name: String(item.title || "Discovered source").slice(0, 120), provider: new URL(validateExternalUrl(url)).hostname, category: "Other", region: "Global", discoveryProvider: this.id, sourceType: "WEB", description: String(item.description || item.snippet || "Search-discovered public data source").slice(0, 500) }];
    });
  }
}

/**
 * Real, keyless discovery over data.gov's public catalogue.  It is deliberately
 * separate from the seed catalogue: queries are generated from a research
 * theme and results are current catalogue entries, not a frozen list of URLs.
 */
export class AutomatedCatalogSearchDiscoveryProvider {
  id = "AUTOMATED_WEB";
  configured = true;

  constructor({ requestText = requestExternalText } = {}) { this.requestText = requestText; }

  async discover({ queryGroup = "general", limit = 18 } = {}) {
    const maximum = Math.max(1, Math.min(30, Number(limit) || 18));
    const queries = discoveryQueries(queryGroup);
    const perQuery = Math.max(1, Math.ceil(maximum / queries.length));
    const candidates = [];
    const seen = new Set();
    for (const query of queries) {
      const beforeQuery = candidates.length;
      const endpoint = new URL("https://api.gsa.gov/technology/datagov/v4/search");
      endpoint.searchParams.set("q", query);
      endpoint.searchParams.set("per_page", String(perQuery));
      try {
        const response = await this.requestText(validateExternalUrl(endpoint), { maxBytes: 1_500_000, timeoutMs: 15_000, headers: { Accept: "application/json", "X-Api-Key": process.env.DATA_GOV_API_KEY || "DEMO_KEY" } });
        let payload;
        try { payload = JSON.parse(response.text); } catch { throw new Error("invalid_automated_discovery_response"); }
        const packages = payload?.results;
        if (!Array.isArray(packages)) throw new Error("invalid_automated_discovery_response");
        for (const item of packages) {
          const dataset = item?.dcat;
          for (const resource of dataset?.distribution ?? []) {
        const url = resource?.downloadURL ?? resource?.accessURL ?? resource?.describedBy;
        if (typeof url !== "string" || seen.has(url) || candidates.length >= maximum || candidates.length - beforeQuery >= perQuery) continue;
        let safe;
        try { safe = String(validateExternalUrl(url)); } catch { continue; }
        seen.add(safe);
        const description = String(resource.description || dataset.description || dataset.title || "Publicly catalogued dataset").replace(/\s+/g, " ").trim().slice(0, 500);
        candidates.push({
          url: safe,
          name: String(resource.title || dataset.title || "Discovered data source").slice(0, 160),
          provider: new URL(safe).hostname,
          category: "Other",
          region: String(dataset?.publisher?.name || "Unspecified").slice(0, 120),
          discoveryProvider: this.id,
          sourceType: sourceType({ format: resource.format || resource.mediaType, url: safe, description }),
          description,
          expectedFields: expectedFields(description),
          temporalCoverage: { source_metadata: String(dataset?.temporal || dataset?.issued || "unknown").slice(0, 160) },
          updateFrequency: String(dataset?.accrualPeriodicity || "UNSPECIFIED").slice(0, 120),
          discoveredQuery: query,
        });
      }
      }
      } catch (error) {
        if (error?.message !== "external_rate_limited") throw error;
      }
      if (candidates.length >= maximum || candidates.length - beforeQuery >= perQuery) continue;
      const socrata = new URL("https://api.us.socrata.com/api/catalog/v1");
      socrata.searchParams.set("q", query);
      socrata.searchParams.set("limit", String(perQuery));
      const fallback = await this.requestText(validateExternalUrl(socrata), { maxBytes: 1_500_000, timeoutMs: 15_000, headers: { Accept: "application/json" } });
      let fallbackPayload;
      try { fallbackPayload = JSON.parse(fallback.text); } catch { throw new Error("invalid_socrata_discovery_response"); }
      if (!Array.isArray(fallbackPayload?.results)) throw new Error("invalid_socrata_discovery_response");
      for (const item of fallbackPayload.results) {
        const resource = item?.resource;
        const domain = item?.metadata?.domain;
        if (!resource?.id || typeof domain !== "string" || candidates.length >= maximum || candidates.length - beforeQuery >= perQuery) continue;
        let safe;
        try { safe = String(validateExternalUrl(`https://${domain}/resource/${resource.id}.json?$limit=10000`)); } catch { continue; }
        if (seen.has(safe)) continue;
        seen.add(safe);
        const description = String(resource.description || resource.name || "Public catalog dataset").replace(/\s+/g, " ").trim().slice(0, 500);
        const fields = Array.isArray(resource.columns_field_name) && resource.columns_field_name.length ? resource.columns_field_name.map(String).slice(0, 80) : expectedFields(description);
        candidates.push({
          url: safe,
          name: String(resource.name || "Socrata data source").slice(0, 160),
          provider: domain,
          category: String(item?.classification?.domain_category || "Other").slice(0, 120),
          region: String(resource.attribution || "Unspecified").slice(0, 120),
          discoveryProvider: "SOCRATA_CATALOG",
          sourceType: "json_api",
          description,
          expectedFields: fields,
          temporalCoverage: { source_metadata: String(resource.updatedAt || resource.createdAt || "unknown").slice(0, 160) },
          updateFrequency: socrataFrequency(item),
          discoveredQuery: query,
        });
      }
    }
    return candidates;
  }
}

const providers = [new PublicCatalogDiscoveryProvider(), new AutomatedCatalogSearchDiscoveryProvider(), new ConfiguredWebSearchDiscoveryProvider()];

export function discoveryProviderOptions() {
  return providers.map((provider) => ({ id: provider.id, configured: provider.configured }));
}

export async function discoverCandidates(input = {}) {
  const provider = providers.find((item) => item.id === (input.provider || "AUTOMATED_WEB"));
  if (!provider) throw new Error("unknown_discovery_provider");
  if (!provider.configured) throw new Error("web_search_configuration_required");
  return provider.discover(input);
}
