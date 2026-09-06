import { createHash } from "node:crypto";
import { createRepositories } from "../../db/repositories/index.mjs";
import { discoverCandidates } from "../../discovery/providers.mjs";
import { encryptSourceUrl } from "../../security/source-url.mjs";

function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.searchParams.sort();
  return url.toString();
}

function digest(value) { return createHash("sha256").update(value).digest(); }

function intervalFor(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "DAILY") return "1 day";
  if (normalized === "WEEKLY") return "7 days";
  if (normalized === "MONTHLY") return "30 days";
  return null;
}

/** Persists live search candidates; uniqueness is enforced by canonical URL hash. */
export function createDiscoveryRunHandler({ pool, sourceUrlKey = process.env.SOURCE_URL_ENCRYPTION_KEY, discover = discoverCandidates }) {
  if (!pool || !sourceUrlKey) throw new Error("discovery_handler_dependencies_required");
  const repositories = createRepositories(pool);
  return async function runDiscovery(job) {
    const candidates = await discover({ provider: "AUTOMATED_WEB", queryGroup: job.payload.queryGroup });
    let created = 0;
    let deduplicated = 0;
    for (let rank = 0; rank < candidates.length; rank += 1) {
      const candidate = candidates[rank];
      const url = canonicalUrl(candidate.url);
      const urlHash = digest(url);
      let source = await repositories.sources.findByCanonicalHash(urlHash);
      if (!source) {
        try {
          source = await repositories.sources.create({
            canonical_url_ciphertext: encryptSourceUrl(url, sourceUrlKey),
            canonical_url_hash: urlHash,
            domain: new URL(url).hostname,
            title: candidate.name,
            description: candidate.description,
            source_type: candidate.sourceType,
            expected_fields: JSON.stringify(candidate.expectedFields ?? []),
            temporal_coverage: JSON.stringify(candidate.temporalCoverage ?? {}),
            expected_update_interval: intervalFor(candidate.updateFrequency),
            status: "candidate",
            reliability: JSON.stringify({ discovery_provider: candidate.discoveryProvider, discovery_query: candidate.discoveredQuery ?? job.payload.queryGroup }),
            discovered_at: new Date(),
          });
          created += 1;
        } catch (error) {
          if (error?.code !== "23505") throw error;
          source = await repositories.sources.findByCanonicalHash(urlHash);
          deduplicated += 1;
        }
      } else deduplicated += 1;
      await repositories.discoveries.create({
        source_id: source.id,
        provider: candidate.discoveryProvider ?? "AUTOMATED_WEB",
        query: candidate.discoveredQuery ?? job.payload.queryGroup,
        result_rank: rank + 1,
        result_url_hash: urlHash,
        provider_payload_hash: digest(JSON.stringify(candidate)),
      });
    }
    return Object.freeze({ queryGroup: job.payload.queryGroup, candidates: candidates.length, created, deduplicated });
  };
}
