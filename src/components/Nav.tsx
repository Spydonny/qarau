import { NavLink, Link } from "react-router-dom";
import { useSession } from "../api/session";
import qarauMonogram from "../assets/qarau/monogram-on-dark.png";
import qarauLockup from "../assets/qarau/primary-lockup-on-dark.png";
import qarauWordmark from "../assets/qarau/wordmark-on-dark.png";

const LINKS = [
  { to: "/discovery", label: "Discovery" },
  { to: "/signals", label: "Signals" },
  { to: "/data", label: "Data" },
  { to: "/runs", label: "Runs" },
];

export function Nav() {
  const { state, signOut } = useSession();
  const ownerId = state.status === "owner" ? state.session.owner.id : "—";

  return (
    <header className="nav">
      <div className="shell nav-inner">
        <Link
          to="/discovery"
          className="nav-mark"
          aria-label="Qarau / Internal home"
        >
          <img
            className="nav-brand nav-brand-lockup"
            src={qarauLockup}
            width={447}
            height={71}
            alt=""
          />
          <img
            className="nav-brand nav-brand-mark"
            src={qarauMonogram}
            width={167}
            height={174}
            alt=""
          />
          <span className="nav-mark-env">/ Internal</span>
        </Link>

        <nav className="nav-links">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-session">
          <span className="meta nav-owner">
            <span className="nav-owner-dot" aria-hidden="true" />
            Owner / {ownerId}
          </span>
          <button className="nav-signout meta" onClick={signOut}>
            End session
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <div className="footer-brand">
          <img
            className="footer-brand-wordmark"
            src={qarauWordmark}
            width={335}
            height={69}
            alt="Qarau"
          />
          <p className="meta muted">
            / Internal · Private research system · Simulated data
          </p>
        </div>
        <p className="meta muted">Visibility / internal</p>
      </div>
    </footer>
  );
}
