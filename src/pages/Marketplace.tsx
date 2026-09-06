import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import qarauLockup from "../assets/qarau/primary-lockup-on-dark.png";

type PublicPackage = {
  package_id: string;
  title: string;
  description: string;
  alpha_score_summary?: { score?: number };
  max_seats: number;
  occupied_seats: number;
  price_lamports: number | null;
  commitment_address: string;
  sale_address: string;
};

/** Public shell: it never reads or implies an owner session. */
export function Marketplace() {
  const [packages, setPackages] = useState<PublicPackage[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const base = import.meta.env.VITE_API_BASE ?? "";
    fetch(`${base}/api/v1/marketplace`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalog_unavailable");
        const data = await response.json() as { packages?: PublicPackage[] };
        setPackages(data.packages ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return (
    <div className="marketplace">
      <header className="market-nav">
        <div className="shell market-nav-inner">
          <Link to="/marketplace" className="market-brand" aria-label="Qarau marketplace">
            <img src={qarauLockup} width={447} height={71} alt="Qarau" />
            <span className="meta">/ Marketplace</span>
          </Link>
          <div className="source-actions"><Link to="/marketplace/wallet" className="btn btn-secondary">Wallet access</Link><span className="meta market-network"><span className="nav-owner-dot" aria-hidden="true" /> Devnet preview</span></div>
        </div>
      </header>

      <main className="shell market-main">
        <section className="market-hero">
          <p className="meta">Public catalog / access by wallet</p>
          <h1 className="display-sm">Research artifacts with verifiable provenance.</h1>
          <p className="body market-lead">Published dataset packages will show their immutable hashes, validation summary, sale terms, and access windows here. Connecting an owner account is never required to browse this catalog.</p>
        </section>

        <section className="market-state" aria-labelledby="catalog-title">
          <div><p className="meta">Catalog status</p><h2 id="catalog-title" className="h2">{packages === null ? "Loading public packages" : packages.length ? `${packages.length} published package${packages.length === 1 ? "" : "s"}` : "No public packages yet"}</h2></div>
          <p className="body-sm">{failed ? "The public catalog is temporarily unavailable." : "Packages appear only after a sealed dataset version, completed validation, immutable access policy, and finalized Devnet commitment. Private source artifacts and research details are never displayed here."}</p>
        </section>

        {packages?.length ? <section className="market-state" aria-label="Published dataset packages">
          {packages.map((item) => <article key={item.package_id} className="market-package">
            <p className="meta">PACKAGE / {item.package_id.slice(-8).toUpperCase()}</p>
            <h2 className="h2">{item.title}</h2>
            <p className="body-sm">{item.description}</p>
            <p className="meta">{item.max_seats - item.occupied_seats} / {item.max_seats} seats remaining · {item.price_lamports?.toLocaleString("en-US") ?? "—"} lamports · Alpha score {item.alpha_score_summary?.score ?? "—"}</p>
            <p className="meta">Commitment / {item.commitment_address} · Sale / {item.sale_address}</p>
          </article>)}
        </section> : null}

        <section className="market-trust" aria-label="Marketplace guarantees">
          <div><p className="meta">01 / Provenance</p><p>Committed hashes point to exact stored artifact bytes.</p></div>
          <div><p className="meta">02 / Payment</p><p>Buyer wallets sign purchases; the service does not hold buyer keys.</p></div>
          <div><p className="meta">03 / Delivery</p><p>Access is granted only after the matching on-chain state is finalized.</p></div>
        </section>
      </main>
    </div>
  );
}
