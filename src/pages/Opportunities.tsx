import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { v1 } from "../api/client";
import { PublicNav } from "../components/PublicNav";

export type AccessRound = { state: string; opens_at: string; closes_at: string; minimum_bid_lamports: number; max_winners: number; bid_count: number; winners_count: number; clearing_price_lamports: number | null; settlement_rule: string };
export type Opportunity = { package_id: string; title: string; description: string; evidence_band?: string; validation_summary?: Record<string, unknown>; access_form?: string; coverage?: { start?: string; end?: string }; update_frequency?: string; commitment_address: string; access_round_address: string; access_round_id: string; access_round: AccessRound };

function roundLabel(item: Opportunity) {
  if (!item.access_round) return "Access round pending";
  return `${item.access_round.state.toUpperCase()} · minimum ${item.access_round.minimum_bid_lamports.toLocaleString("en-US")} lamports · Top ${item.access_round.max_winners}`;
}

export function Opportunities() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; v1.opportunities().then((data) => { if (active) setItems(data.packages as unknown as Opportunity[]); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  const selected = useMemo(() => id ? items?.find((item) => item.package_id === id) : null, [id, items]);
  const auctionOnly = pathname === "/auctions";
  const discover = pathname === "/discover";
  const heading = discover ? "Trace evidence before it becomes a signal." : auctionOnly ? "Compete for limited research access." : "Research opportunities with verifiable evidence.";
  return <div className="public-research"><PublicNav /><main className="shell market-main">
    <section className="market-hero"><p className="meta">{discover ? "Public evidence discovery" : auctionOnly ? "Transparent Top-N access rounds" : "Public research catalog"}</p><h1 className="display-sm">{heading}</h1><p className="body market-lead">Every item begins with screened source metadata, passes deterministic quantitative validation, and is anchored to Devnet before an access round opens. Public pages show evidence and terms—not private source rows.</p></section>
    {selected ? <section className="market-state"><div><p className="meta">RESEARCH / {selected.package_id.slice(-8).toUpperCase()}</p><h2 className="h2">{selected.title}</h2><p className="body-sm">{selected.description}</p></div><div><p className="meta">Evidence / {selected.evidence_band ?? "unrated"}</p><p className="body-sm">Coverage {selected.coverage?.start ?? "—"} to {selected.coverage?.end ?? "—"}. Update frequency {selected.update_frequency ?? "—"}. Deliverable form: {selected.access_form === "derived_only" ? "derived research only" : "normalized data and derived research"}.</p><p className="meta">Commitment / {selected.commitment_address}</p><p className="meta">Access round / {roundLabel(selected)}</p><div className="source-actions" style={{ marginTop: 18 }}><Link className="btn btn-primary" to="/my-access">Enter access round</Link><Link className="btn btn-secondary" to="/opportunities">Back to research</Link></div></div></section> : null}
    {!selected && <section className="market-state" aria-labelledby="research-title"><div><p className="meta">Research status</p><h2 id="research-title" className="h2">{items === null ? "Loading evidence" : items.length ? `${items.length} validated opportunit${items.length === 1 ? "y" : "ies"}` : "No public opportunities yet"}</h2></div><p className="body-sm">{failed ? "Public research is temporarily unavailable." : "Only license-reviewed, quantitatively validated, commitment-backed work appears here."}</p></section>}
    {!selected && items?.map((item) => <article key={item.package_id} className="market-state"><div><p className="meta">EVIDENCE / {(item.evidence_band ?? "unrated").toUpperCase()}</p><h2 className="h2">{item.title}</h2><p className="body-sm">{item.description}</p></div><div><p className="meta">{roundLabel(item)}</p><p className="body-sm">{item.access_form === "derived_only" ? "License permits derived research delivery only." : "License permits normalized and derived delivery."}</p><div className="source-actions" style={{ marginTop: 18 }}><Link className="btn btn-primary" to={`/opportunities/${item.package_id}`}>View research</Link><Link className="btn btn-secondary" to="/my-access">View access round</Link></div></div></article>)}
    <section className="market-trust" aria-label="Research guarantees"><div><p className="meta">01 / Screen</p><p>Ten metadata gates reject weak sources before ingestion.</p></div><div><p className="meta">02 / Validate</p><p>Deterministic tests produce evidence; AI explains but never changes scores.</p></div><div><p className="meta">03 / Allocate</p><p>Top-N pay-as-bid rounds settle on-chain before access exists.</p></div></section>
  </main></div>;
}
