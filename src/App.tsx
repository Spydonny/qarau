import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./api/session";
import { Footer, Nav } from "./components/Nav";
import { Authenticate } from "./pages/Authenticate";
import { Discovery } from "./pages/Discovery";
import { Signals } from "./pages/Signals";
import { SignalDetail } from "./pages/SignalDetail";
import { Data } from "./pages/Data";
import { Runs } from "./pages/Runs";
import qarauLockup from "./assets/qarau/primary-lockup-on-dark.png";

/** Route changes should land at the top of the new page. */
function ScrollToTop() {
  const { pathname } = useLocation();
  // Block body on purpose: a concise arrow would hand scrollTo's return
  // value to React as a cleanup function, which it then tries to call.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const { state } = useSession();

  if (state.status === "checking") {
    return (
      <div className="boot">
        <div className="boot-inner">
          <img
            className="boot-brand"
            src={qarauLockup}
            width={447}
            height={71}
            alt="Qarau"
          />
          <p className="meta">Verifying session</p>
        </div>
      </div>
    );
  }

  // Unauthenticated visitors see one screen and nothing else. This is the
  // convenience layer only — the API rejects them regardless of what renders.
  if (state.status === "anonymous") {
    return (
      <>
        <ScrollToTop />
        <Routes>
          <Route path="*" element={<Authenticate />} />
        </Routes>
      </>
    );
  }

  return (
    <>
      <ScrollToTop />
      <Nav />
      <main>
        <Routes>
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/signals/:id" element={<SignalDetail />} />
          <Route path="/data" element={<Data />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="*" element={<Navigate to="/discovery" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
