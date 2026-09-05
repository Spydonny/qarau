import { Link } from "react-router-dom";
import qarauLockup from "../assets/qarau/primary-lockup-on-dark.png";

/** Public shell: it never reads or implies an owner session. */
export function Marketplace() {
  return (
    <div className="marketplace">
      <header className="market-nav">
        <div className="shell market-nav-inner">
          <Link to="/marketplace" className="market-brand" aria-label="Qarau marketplace">
            <img src={qarauLockup} width={447} height={71} alt="Qarau" />
            <span className="meta">/ Marketplace</span>
          </Link>
          <span className="meta market-network"><span className="nav-owner-dot" aria-hidden="true" /> Devnet preview</span>
        </div>
      </header>

      <main className="shell market-main">
        <section className="market-hero">
          <p className="meta">Public catalog / access by wallet</p>
          <h1 className="display-sm">Research artifacts with verifiable provenance.</h1>
          <p className="body market-lead">Published dataset packages will show their immutable hashes, validation summary, sale terms, and access windows here. Connecting an owner account is never required to browse this catalog.</p>
        </section>

        <section className="market-state" aria-labelledby="catalog-title">
          <div><p className="meta">Catalog status</p><h2 id="catalog-title" className="h2">No public packages yet</h2></div>
          <p className="body-sm">Packages appear only after a sealed dataset version, completed validation, immutable access policy, and Devnet commitment. Private source artifacts and research details are never displayed here.</p>
        </section>

        <section className="market-trust" aria-label="Marketplace guarantees">
          <div><p className="meta">01 / Provenance</p><p>Committed hashes point to exact stored artifact bytes.</p></div>
          <div><p className="meta">02 / Payment</p><p>Buyer wallets sign purchases; the service does not hold buyer keys.</p></div>
          <div><p className="meta">03 / Delivery</p><p>Access is granted only after the matching on-chain state is finalized.</p></div>
        </section>
      </main>
    </div>
  );
}
