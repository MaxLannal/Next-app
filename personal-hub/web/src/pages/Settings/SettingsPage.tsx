export function SettingsPage() {
  return (
    <div className="container page">
      <h1>Settings</h1>
      <p className="page__lead">Phone access, sleep, GitHub and permissions.</p>
      <p className="page__lead">
        Now playing control is experimental. The hub posts the keyboard’s media keys; it needs Hub allowed under Privacy &amp;
        Security → Accessibility. Track details come from MediaRemote and may not work on macOS 26 — the controls then show
        on their own.
      </p>
    </div>
  );
}
