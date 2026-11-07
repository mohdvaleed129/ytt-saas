import { Link } from 'react-router';
import { APP_NAME } from '../../config.js';
import Wordmark from './Wordmark.jsx';

export default function SiteFooter() {
  return (
    <footer className="site-footer on-ink">
      <div className="container site-footer__grid">
        <div className="site-footer__brand">
          <span className="wordmark"><Wordmark /></span>
          <p>Paste a YouTube link, get a timestamped transcript.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="site-footer__links">
            <li><Link to="/generator">Generator</Link></li>
            <li><Link to="/dashboard">Dashboard</Link></li>
            <li><Link to={{ pathname: '/', hash: '#faq' }}>FAQ</Link></li>
          </ul>
        </nav>
        <p className="site-footer__legal">
          {APP_NAME} is not affiliated with or endorsed by YouTube or Google. Transcripts may be protected by copyright:
          only use text you have the right to use. Captions come from the video; they can contain mistakes.
        </p>
      </div>
    </footer>
  );
}
