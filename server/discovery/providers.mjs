import { requestExternalText, validateExternalUrl } from "../lib/url-policy.mjs";
import { SOURCE_CATALOG } from "../providers/real-data.mjs";

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

const providers = [new PublicCatalogDiscoveryProvider(), new ConfiguredWebSearchDiscoveryProvider()];

export function discoveryProviderOptions() {
  return providers.map((provider) => ({ id: provider.id, configured: provider.configured }));
}

export async function discoverCandidates(input = {}) {
  const provider = providers.find((item) => item.id === (input.provider || "PUBLIC_CATALOG"));
  if (!provider) throw new Error("unknown_discovery_provider");
  if (!provider.configured) throw new Error("web_search_configuration_required");
  return provider.discover(input);
}
