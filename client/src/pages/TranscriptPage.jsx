import { Link, useParams } from 'react-router';
import TranscriptView from '../components/generator/TranscriptView.jsx';
import { loadHistory } from '../lib/history.js';
import { useTitle } from '../hooks/useTitle.js';

/** Opens one saved transcript from this browser's history. */
export default function TranscriptPage() {
  const { id } = useParams();
  useTitle('Saved transcript');
  const entry = loadHistory().find((e) => e.id === id);
  return (
    <>
      <section className="page-head">
        <div className="container">
          <h1>Saved transcript</h1>
          <p><Link to="/dashboard">← Back to the dashboard</Link></p>
        </div>
      </section>
      <div className="container desk">
        {entry ? (
          <TranscriptView transcript={{ ...entry, source: 'history', fresh: false }} />
        ) : (
          <section className="panel panel--warn" aria-labelledby="nf-title">
            <h2 id="nf-title" className="panel__title">That transcript is not saved in this browser</h2>
            <p>It may have been deleted, or it was saved in a different browser or profile.</p>
            <div className="panel__actions"><Link className="btn btn--small" to="/generator">Generate a transcript</Link></div>
          </section>
        )}
      </div>
    </>
  );
}
