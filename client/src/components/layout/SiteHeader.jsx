import { Link, NavLink } from 'react-router';
import { APP_NAME } from '../../config.js';
import Wordmark from './Wordmark.jsx';

export default function SiteHeader() {
  return (
    <header className="site-header on-ink">
      <div className="container site-header__inner">
        <Link to="/" className="wordmark" aria-label={`${APP_NAME}, home`}>
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="site-nav">
          <Link to={{ pathname: '/', hash: '#how' }} className="site-nav__link site-nav__link--secondary">How it works</Link>
          <Link to={{ pathname: '/', hash: '#faq' }} className="site-nav__link site-nav__link--secondary">FAQ</Link>
          <NavLink to="/dashboard" className="site-nav__link">Dashboard</NavLink>
          <NavLink to="/generator" className="site-nav__link site-nav__link--cta">Generator</NavLink>
        </nav>
      </div>
    </header>
  );
}
