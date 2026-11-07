import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Info } from 'lucide-react';

export function LoadingPanel({ startedAt, onCancel }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt]);
  return (
    <section className="panel" aria-labelledby="loading-title" role="status">
      <h2 id="loading-title" className="panel__title">Asking for the captions…</h2>
      <div className="progress-feed" aria-hidden="true" />
      <p>Waiting for the server{seconds > 0 ? ` · ${seconds} s` : ''}. Most answers arrive within a few seconds.</p>
      <div className="panel__actions"><button type="button" className="btn btn--quiet btn--small" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}

export function ErrorPanel({ error, onRetry, onDismiss }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const Icon = error.tone === 'info' ? Info : CircleAlert;
  return (
    <section className={`panel panel--${error.tone}`} aria-labelledby="error-title" role="alert">
      <h2 id="error-title" className="panel__title" ref={ref} tabIndex={-1}><Icon aria-hidden="true" className="panel__icon" /> {error.title}</h2>
      <p>{error.message}</p>
      {error.hint && <p className="panel__hint">{error.hint}</p>}
      {error.requestId && <p className="mono">Request ID: {error.requestId}</p>}
      <div className="panel__actions">
        {error.retryable && onRetry && <button type="button" className="btn btn--small" onClick={onRetry}>Try again</button>}
        <button type="button" className="btn btn--small btn--quiet" onClick={onDismiss}>Dismiss</button>
      </div>
    </section>
  );
}

export function EmptyPanel() {
  return (
    <section className="panel panel--empty" aria-labelledby="empty-title">
      <h2 id="empty-title" className="panel__title">No transcript yet</h2>
      <p>Paste a YouTube link above and choose a language, or leave it on Auto. The transcript prints here, with a time on every line.</p>
      <ul className="empty-list">
        <li><span className="stamp stamp--ok">Works</span> Videos and Shorts that already have captions.</li>
        <li><span className="stamp stamp--no">Not yet</span> Videos without captions: AI transcription is not available.</li>
      </ul>
    </section>
  );
}
