import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { QarauFilters, QarauOptions, QarauSource } from "../api/types";
import { SysMeta } from "../components/primitives";

const EMPTY_OPTIONS: QarauOptions = { categories: [], industries: [], geographies: [], sourceTypes: [], temporalResolutions: [], updateFrequencies: [], pricingTypes: [], targets: [], providers: [], discoveryProviders: [], scoreWeights: {}, analyzer: { provider: "local", configured: true, externalEnabled: false } };

function SelectFilter({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="filter-field"><span className="meta">{label}</span><select className="source-input" value={value || ""} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function Data() {
  const [sources, setSources] = useState<QarauSource[]>([]);
  const [options, setOptions] = useState<QarauOptions>(EMPTY_OPTIONS);
  const [filters, setFilters] = useState<QarauFilters>({ sort: "candidate", page: "1", pageSize: "20" });
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [mode, setMode] = useState<"WEB" | "API">("WEB");
  const [manual, setManual] = useState({ url: "", name: "", category: "Other", region: "Global", sensitivityMode: "PUBLIC_SOURCE" });
  const [busy, setBusy] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [discovery, setDiscovery] = useState({ provider: "PUBLIC_CATALOG", query: "" });

  const load = useCallback(async (next = filters) => {
    const response = await api.sources(next);
    setSources(response.sources); setPagination(response.pagination);
  }, [filters]);

  useEffect(() => { api.qarauOptions().then(setOptions).catch(() => setSourceError("Registry options could not be loaded.")); }, []);
  useEffect(() => {
    api.sources(filters)
      .then((response) => { setSources(response.sources); setPagination(response.pagination); })
      .catch(() => setSourceError("Source registry could not be loaded."));
  }, [filters]);

  const updateFilter = (key: keyof QarauFilters, value: string) => setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? value : "1" }));
  const submitSource = async () => {
    try {
      setBusy("Adding"); setSourceError("");
      await api.manualSource({ ...manual, sourceType: mode });
      setManual({ url: "", name: "", category: "Other", region: "Global", sensitivityMode: "PUBLIC_SOURCE" });
      await load();
    } catch (error) { setSourceError(error instanceof Error ? error.message : "Source could not be added."); }
    finally { setBusy(""); }
  };
  const discover = async () => {
    try { setBusy("Discovering"); setSourceError(""); await api.discoverSources(discovery); await load(); }
    catch (error) { setSourceError(error instanceof Error ? error.message : "Discovery failed."); }
    finally { setBusy(""); }
  };

  const connected = sources.filter((source) => source.dataset).length;
  return (
    <div className="shell page">
      <div className="data-head">
        <div><h1 className="h1">Data universe</h1><p className="body" style={{ marginTop: 16 }}>Authenticated real-world sources, immutable snapshots, and private quantitative evidence.</p></div>
        <SysMeta rows={[["REGISTERED", String(pagination.total)], ["CONNECTED", String(connected)], ["VISIBILITY", "INTERNAL"]]} />
      </div>

      <section className="register source-panel">
        <div className="register-head"><div><p className="meta">Bounded source discovery</p><p className="body-sm" style={{ marginTop: 10 }}>Public catalog adapters cover weather, water, energy, logistics, pollution, agriculture, mobility, retail, and commodity infrastructure. Configured web search adds at most 20 URLs per job and never crawls recursively.</p></div><div className="source-actions"><select className="source-input" value={discovery.provider} onChange={(event) => setDiscovery({ ...discovery, provider: event.target.value })} aria-label="Discovery provider">{options.discoveryProviders.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.configured}>{provider.id}{provider.configured ? "" : " · not configured"}</option>)}</select>{discovery.provider === "WEB_SEARCH" && <input className="source-input" value={discovery.query} onChange={(event) => setDiscovery({ ...discovery, query: event.target.value })} placeholder="Physical data search" aria-label="Discovery query" />}<button className="btn btn-primary" onClick={discover} disabled={Boolean(busy) || (discovery.provider === "WEB_SEARCH" && !discovery.query.trim())}>{busy === "Discovering" ? "Discovering" : "Discover sources"}</button></div></div>
        <div className="provider-strip">{options.providers.map((provider) => <span className="provider-item" key={provider.key}><strong>{provider.name}</strong><span className="meta">{provider.provider} · {provider.region}</span></span>)}</div>
      </section>

      <hr className="rule" />
      <section className="register source-panel">
        <div className="register-head"><p className="meta">Manual source</p><div className="source-actions"><button className={`opt ${mode === "WEB" ? "is-active" : ""}`} onClick={() => setMode("WEB")}>URL</button><button className={`opt ${mode === "API" ? "is-active" : ""}`} onClick={() => setMode("API")}>JSON API</button></div></div>
        <div className="manual-source-grid">
          <input className="source-input" value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} placeholder={mode === "API" ? "https://api.example/data" : "https://public-data.example/catalog"} aria-label="Public source URL" />
          <input className="source-input" value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} placeholder="Source name" aria-label="Source name" />
          <input className="source-input" value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value })} placeholder="Category" aria-label="Category" />
          <input className="source-input" value={manual.region} onChange={(event) => setManual({ ...manual, region: event.target.value })} placeholder="Broad region" aria-label="Broad region" />
          <select className="source-input" value={manual.sensitivityMode} onChange={(event) => setManual({ ...manual, sensitivityMode: event.target.value })} aria-label="Source sensitivity"><option value="PUBLIC_SOURCE">Public source</option><option value="PRIVATE_SOURCE">Private source</option><option value="HIGHLY_SENSITIVE_SOURCE">Highly sensitive</option></select>
          <button className="btn btn-secondary" onClick={submitSource} disabled={!manual.url || Boolean(busy)}>{busy === "Adding" ? "Adding" : "Add source"}</button>
        </div>
        {sourceError && <p className="meta gate-error" style={{ marginTop: 14 }}>{sourceError}</p>}
      </section>

      <hr className="rule" />
      <section className="register">
        <div className="register-head"><p className="meta">Private source registry</p><input className="source-input registry-search" value={filters.q || ""} onChange={(event) => updateFilter("q", event.target.value)} placeholder="Search sources" aria-label="Search sources" /></div>
        <div className="filter-grid">
          <SelectFilter label="Category" value={filters.category} options={options.categories} onChange={(value) => updateFilter("category", value)} />
          <SelectFilter label="Industry" value={filters.industry} options={options.industries} onChange={(value) => updateFilter("industry", value)} />
          <SelectFilter label="Geography" value={filters.geography} options={options.geographies} onChange={(value) => updateFilter("geography", value)} />
          <SelectFilter label="Source type" value={filters.sourceType} options={options.sourceTypes} onChange={(value) => updateFilter("sourceType", value)} />
          <SelectFilter label="Resolution" value={filters.temporalResolution} options={options.temporalResolutions} onChange={(value) => updateFilter("temporalResolution", value)} />
          <SelectFilter label="Update" value={filters.updateFrequency} options={options.updateFrequencies} onChange={(value) => updateFilter("updateFrequency", value)} />
          <SelectFilter label="Pricing" value={filters.pricingType} options={options.pricingTypes} onChange={(value) => updateFilter("pricingType", value)} />
          <SelectFilter label="API" value={filters.apiAvailable} options={["true", "false"]} onChange={(value) => updateFilter("apiAvailable", value)} />
          <SelectFilter label="Numerical history" value={filters.historicalDataAvailable} options={["true", "false"]} onChange={(value) => updateFilter("historicalDataAvailable", value)} />
          <SelectFilter label="Tested" value={filters.tested} options={["true", "false"]} onChange={(value) => updateFilter("tested", value)} />
          <SelectFilter label="Committed" value={filters.committed} options={["true", "false"]} onChange={(value) => updateFilter("committed", value)} />
          <SelectFilter label="Sort" value={filters.sort} options={["candidate", "quality", "economicRelevance", "novelty", "testability"]} onChange={(value) => updateFilter("sort", value)} />
        </div>
        <details className="advanced-filters"><summary className="btn-ghost">Score and history thresholds</summary><div className="filter-grid">{[["minHistoricalDepth", "Min history (years)"], ["minQuality", "Min quality"], ["minEconomicRelevance", "Min relevance"], ["minNovelty", "Min novelty"], ["minTestability", "Min testability"], ["minCandidate", "Min candidate"]].map(([key, label]) => <label className="filter-field" key={key}><span className="meta">{label}</span><input className="source-input" type="number" min="0" max={key === "minHistoricalDepth" ? 100 : 100} value={filters[key as keyof QarauFilters] || ""} onChange={(event) => updateFilter(key as keyof QarauFilters, event.target.value)} /></label>)}</div></details>

        <div className="source-list">
          {sources.map((source) => <Link to={`/sources/${source.id}`} className="source-row" key={source.id}><span><span className="mono">SRC / {source.publicId.slice(-8)}</span><strong>{source.name}</strong></span><span className="meta">{source.provider} · {source.category} · {source.region}</span><span className="mono">Score {source.scores.candidate}</span><span className="meta">{source.dataset ? `${source.dataset.rows} REAL ROWS` : source.status}</span></Link>)}
          {!sources.length && <p className="body-sm empty-registry">No sources match the current filters.</p>}
        </div>
        <div className="pagination"><button className="btn btn-secondary" disabled={pagination.page <= 1} onClick={() => updateFilter("page", String(pagination.page - 1))}>Previous</button><span className="mono">Page {pagination.page} / {pagination.pages}</span><button className="btn btn-secondary" disabled={pagination.page >= pagination.pages} onClick={() => updateFilter("page", String(pagination.page + 1))}>Next</button></div>
      </section>
    </div>
  );
}
