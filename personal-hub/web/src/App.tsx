import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { LoginGate } from './components/LoginGate.tsx';
import { Nav } from './components/Nav.tsx';
import { NavTimer } from './components/NavTimer.tsx';
import { Dashboard } from './pages/Dashboard/Dashboard.tsx';
import { DatabasePage } from './pages/Database/DatabasePage.tsx';
import { EssaysPage } from './pages/Essays/EssaysPage.tsx';
import { EssayEditor } from './pages/Essays/editor/EssayEditor.tsx';
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
      <Nav timerSlot={<NavTimer />} />
      <main id="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/essays" element={<EssaysPage />} />
          <Route path="/essays/:id" element={<EssayEditor />} />
          <Route path="/database" element={<DatabasePage />} />
          <Route path="/database/session/:id" element={<DatabasePage />} />
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
