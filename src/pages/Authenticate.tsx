import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../api/useSession";
import { ApiError } from "../api/client";
import qarauLockup from "../assets/qarau/primary-lockup-on-dark.png";

/**
 * Explicit admin entry. Public visitors enter through the research catalog and
 * never encounter this owner-only authentication surface.
 */
export function Authenticate() {
  const { authenticate } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await authenticate(password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Locked for 15 minutes.");
      } else {
        // The server does not say which part was wrong, and neither does this.
        setError("Not authorized.");
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-brand">
          <img
            className="gate-brand-logo"
            src={qarauLockup}
            width={447}
            height={71}
            alt="Qarau"
          />
        </div>

        <h1 className="display-sm gate-title">QARAU Research Console</h1>

        <p className="gate-sub">Private workspace for sources, analysis, and publication.</p>

        <form className="gate-form" onSubmit={submit}>
          <label className="meta" htmlFor="owner-key">
            Owner only / secure access
          </label>
          <div className="gate-field">
            <input
              id="owner-key"
              className="gate-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Owner credential"
              disabled={busy}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !password}>
              {busy ? "Verifying" : "Authenticate"} <span className="arrow">→</span>
            </button>
          </div>
          {error && (
            <p className="gate-error meta" role="alert">
              {error}
            </p>
          )}
        </form>
        <Link className="btn-ghost" to="/opportunities">
          Return to public research <span className="arrow">→</span>
        </Link>
      </div>
    </div>
  );
}
