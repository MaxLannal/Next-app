import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { LoginGate } from './components/LoginGate.tsx';
import { Nav } from './components/Nav.tsx';
import { Dashboard } from './pages/Dashboard/Dashboard.tsx';
import { DatabasePage, SessionPage } from './pages/Database/DatabasePage.tsx';
import { EssaysPage } from './pages/Essays/EssaysPage.tsx';
import { SettingsPage } from './pages/Settings/SettingsPage.tsx';

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/essays" element={<EssaysPage />} />
          <Route path="/essays/:id" element={<EssaysPage />} />
          <Route path="/database" element={<DatabasePage />} />
          <Route path="/database/session/:id" element={<SessionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <LoginGate />
    </>
  );
}

function NotFound() {
  return (
    <div className="container page">
      <h1>Nothing at this address</h1>
      <p className="page__lead">
        <Link to="/">Back to the dashboard</Link>
      </p>
    </div>
  );
}
