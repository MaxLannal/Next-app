import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';

type NavProps = {
  /** The running-timer pill, shown on every page while a session is active. */
  timerSlot?: ReactNode;
};

export function Nav({ timerSlot }: NavProps) {
  const solid = useSolidNav();
  return (
    <header className={solid ? 'nav is-solid' : 'nav'}>
      <div className="container nav__in">
        <Link className="wordmark" to="/" aria-label="Hub, dashboard">
          <span className="wordmark__dot" aria-hidden="true" />
          Hub
        </Link>
        <nav className="nav__links" aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/essays">Essays</NavLink>
          <NavLink to="/database">Database</NavLink>
        </nav>
        <div className="nav__end">
          {timerSlot}
          <NavLink className="nav__link" to="/settings">
            Settings
          </NavLink>
        </div>
      </div>
    </header>
  );
}

/**
 * Clear over a page's hero photograph (`[data-hero]`), slate glass once the
 * page scrolls past it, or reaches its end when it is too short to pass it.
 * Pages without a hero get the slate nav from the start.
 */
function useSolidNav(): boolean {
  const { pathname } = useLocation();
  const [solid, setSolid] = useState(true);

  useLayoutEffect(() => {
    const update = () => {
      const hero = document.querySelector<HTMLElement>('[data-hero]');
      const y = window.scrollY;
      const atEnd = y > 0 && y + window.innerHeight >= document.documentElement.scrollHeight - 1;
      setSolid(!hero || y > hero.offsetHeight - 120 || atEnd);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  return solid;
}
