import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import SiteHeader from './SiteHeader.jsx';
import SiteFooter from './SiteFooter.jsx';

/** Scrolls to the #hash target after navigation, or to the top for a new page. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function AppShell() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter />
      <ScrollManager />
    </>
  );
}
