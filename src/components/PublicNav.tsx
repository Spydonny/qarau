import { Link, NavLink } from "react-router-dom";
import qarauLockup from "../assets/qarau/primary-lockup-on-dark.png";

const links = [
  { to: "/discover", label: "Discover" },
  { to: "/opportunities", label: "Opportunities" },
  { to: "/auctions", label: "Auctions" },
  { to: "/my-access", label: "My Access" },
];

export function PublicNav() {
  return <header className="market-nav"><div className="shell market-nav-inner">
    <Link to="/opportunities" className="market-brand" aria-label="Qarau public research"><img src={qarauLockup} width={447} height={71} alt="Qarau" /><span className="meta">/ Public Research</span></Link>
    <nav className="public-links" aria-label="Public navigation">{links.map((link) => <NavLink key={link.to} to={link.to} className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}>{link.label}</NavLink>)}</nav>
    <span className="meta market-network"><span className="nav-owner-dot" aria-hidden="true" /> Devnet</span>
  </div></header>;
}
