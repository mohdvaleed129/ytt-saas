import { Link } from 'react-router';
import { useTitle } from '../hooks/useTitle.js';

export default function NotFoundPage() {
  useTitle('Page not found');
  return (
    <section className="page-head">
      <div className="container">
        <h1>Page not found</h1>
        <p>There is nothing at this address.</p>
        <p className="page-head__actions"><Link className="btn btn--small" to="/">Back to the start</Link></p>
      </div>
    </section>
  );
}
