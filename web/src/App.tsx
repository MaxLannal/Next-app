import { lazy, Suspense, useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { ChatSidebar } from './components/chat/ChatSidebar.tsx';
import { LoginGate } from './components/LoginGate.tsx';
import { Nav } from './components/Nav.tsx';
import { NavTimer } from './components/NavTimer.tsx';
import { Dashboard } from './pages/Dashboard/Dashboard.tsx';
import { DatabasePage, SessionPage } from './pages/Database/DatabasePage.tsx';
import { EssaysPage } from './pages/Essays/EssaysPage.tsx';
import { EssayEditor } from './pages/Essays/editor/EssayEditor.tsx';
import { SettingsPage } from './pages/Settings/SettingsPage.tsx';
import { SkillsPage } from './pages/Skills/SkillsPage.tsx';

// The globe brings Mapbox with it, so its page loads only when it is opened.
const TracesPage = lazy(() => import('./pages/Traces/TracesPage.tsx'));

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
          <Route path="/database/session/:id" element={<SessionPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route
            path="/traces"
            element={
              <Suspense fallback={<div className="traces" />}>
                <TracesPage />
              </Suspense>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <ChatSidebar />
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
