import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./api/useSession";
import { Footer, Nav } from "./components/Nav";
import { Authenticate } from "./pages/Authenticate";
import { Opportunities } from "./pages/Opportunities";
import { Pipeline, PipelineAnalysis, PipelineSource } from "./pages/Pipeline";
import { MyAccessPage } from "./pages/MyAccess";
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
  const { pathname } = useLocation();
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  // Public visitors never pass through the owner gate. Old internal URLs are
  // retained only as redirects into the explicitly named admin namespace.
  if (!isAdminRoute) {
    return (
      <>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Navigate to="/opportunities" replace />} />
          <Route path="/discover" element={<Opportunities />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/opportunities/:id" element={<Opportunities />} />
          <Route path="/auctions" element={<Opportunities />} />
          <Route path="/my-access" element={<MyAccessPage />} />
          <Route path="/pipeline/*" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/discovery" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/signals/*" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/data" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/sources/*" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/runs" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="*" element={<Navigate to="/opportunities" replace />} />
        </Routes>
      </>
    );
  }

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
          <Route path="/admin/*" element={<Authenticate />} />
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
          <Route path="/admin" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/admin/pipeline" element={<Pipeline />} />
          <Route path="/admin/pipeline/sources/:id" element={<PipelineSource />} />
          <Route path="/admin/pipeline/analysis/:id" element={<PipelineAnalysis />} />
          <Route path="/admin/*" element={<Navigate to="/admin/pipeline" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
