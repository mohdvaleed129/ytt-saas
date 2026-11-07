import { useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useApiStatus } from '../hooks/useApiStatus.js';
import { useTitle } from '../hooks/useTitle.js';
import { clearHistory, deleteEntry, loadHistory } from '../lib/history.js';
import { formatTimestamp, totalDurationMs } from '../lib/transcript-format.js';
import { languageName } from '../lib/languages.js';
import { API_URL, HISTORY_LIMIT } from '../config.js';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const API_TEXT = {
  checking: ['Checking…', 'info', 'Asking the backend for its readiness.'],
  ready: ['Ready', 'ok', 'The backend answered and reports that its database and provider are ready.'],
  not_ready: ['Not ready', 'no', 'The backend is running but reports it is not ready (for example the database is unavailable).'],
  unreachable: ['Unreachable', 'no', 'No answer from the backend. It may not be running, or this site is not allowed by its CORS settings.'],
  unconfigured: ['Not configured', 'no', 'VITE_API_URL is not set, so this site does not know where the backend is.'],
};

function ConfirmDelete({ onConfirm, label }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" className="btn btn--small btn--quiet" onClick={() => setAsking(true)} aria-label={`Delete ${label}`}><Trash2 aria-hidden="true" /> Delete</button>;
  }
  return (
    <span className="confirm" role="group" aria-label={`Confirm deleting ${label}`}>
      <button type="button" className="btn btn--small" onClick={onConfirm}>Yes, delete</button>
      <button type="button" className="btn btn--small btn--quiet" onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
}

export default function DashboardPage() {
  useTitle('Dashboard');
  const [entries, setEntries] = useState(() => loadHistory());
  const [confirmClear, setConfirmClear] = useState(false);
  const { status, check } = useApiStatus();
  const [apiLabel, apiTone, apiNote] = API_TEXT[status.state] ?? API_TEXT.unreachable;
  const last = entries[0];

  return (
    <>
      <section className="page-head" aria-labelledby="dash-title">
        <div className="container">
          <h1 id="dash-title">Dashboard</h1>
          <p>What is on this device, and what the backend says about itself.</p>
        </div>
      </section>

      <div className="container dash">
        <nav className="dash__nav" aria-label="Dashboard sections">
          <a href="#overview">Overview</a><a href="#recent">Recent transcripts</a><a href="#usage">Usage</a><a href="#account">Account</a>
        </nav>

        <div className="dash__main">
          <section id="overview" aria-labelledby="ov-title">
            <h2 id="ov-title" className="visually-hidden">Overview</h2>
            <div className="stats">
              <div className="ticket stat"><div className="ticket__band"><span>Saved here</span></div><div className="ticket__body"><p className="stat__value">{entries.length}</p><p className="field__hint">of {HISTORY_LIMIT} kept in this browser</p></div></div>
              <div className="ticket stat"><div className="ticket__band"><span>Last generated</span></div><div className="ticket__body"><p className="stat__value stat__value--small">{last ? dateFmt.format(new Date(last.createdAt)) : '—'}</p><p className="field__hint">{last ? `Video ${last.videoId}` : 'Nothing yet'}</p></div></div>
              <div className="ticket stat">
                <div className="ticket__band"><span>Backend</span><span className={`stamp stamp--${apiTone === 'info' ? 'info' : apiTone}`}>{apiLabel}</span></div>
                <div className="ticket__body">
                  <p>{apiNote}</p>
                  <p className="field__hint mono">{API_URL || 'VITE_API_URL not set'}</p>
                  <button type="button" className="btn btn--small btn--quiet" onClick={check}><RefreshCw aria-hidden="true" /> Check again</button>
                </div>
              </div>
            </div>
          </section>

          <section id="recent" aria-labelledby="rec-title" className="dash__section">
            <div className="dash__section-head">
              <h2 id="rec-title">Recent transcripts</h2>
              {entries.length > 0 && (
                confirmClear ? (
                  <span className="confirm" role="group" aria-label="Confirm clearing all">
                    <button type="button" className="btn btn--small" onClick={() => { setEntries(clearHistory().entries); setConfirmClear(false); }}>Yes, clear all</button>
                    <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirmClear(false)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirmClear(true)}>Clear all</button>
                )
              )}
            </div>
            <p className="field__hint">Stored only in this browser. Not synced, not backed up. Clearing your browser data removes them.</p>
            {entries.length === 0 ? (
              <div className="panel panel--empty">
                <p className="panel__title">Nothing saved yet</p>
                <p>Transcripts you generate appear here automatically.</p>
                <div className="panel__actions"><Link className="btn btn--small" to="/generator">Generate a transcript</Link></div>
              </div>
            ) : (
              <table className="history">
                <caption className="visually-hidden">Transcripts saved in this browser, newest first</caption>
                <thead><tr><th scope="col">Video</th><th scope="col">Language</th><th scope="col">Lines</th><th scope="col">Length</th><th scope="col">Saved</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Video"><span className="mono">{e.videoId}</span></td>
                      <td data-label="Language">{languageName(e.lang)}</td>
                      <td data-label="Lines">{e.segments.length}</td>
                      <td data-label="Length">{formatTimestamp(totalDurationMs(e.segments))}</td>
                      <td data-label="Saved">{dateFmt.format(new Date(e.createdAt))}</td>
                      <td>
                        <div className="history__actions">
                        <Link className="btn btn--small" to={`/transcript/${e.id}`} aria-label={`Open transcript for video ${e.videoId}`}>Open</Link>
                        <ConfirmDelete label={`transcript for video ${e.videoId}`} onConfirm={() => setEntries(deleteEntry(e.id).entries)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section id="usage" aria-labelledby="use-title" className="dash__section">
            <h2 id="use-title">Usage</h2>
            <div className="panel panel--info">
              <p className="panel__title">Usage tracking is not available yet</p>
              <p>Limits and usage meters arrive together with accounts. Nothing is being counted on a server for you today.</p>
            </div>
          </section>

          <section id="account" aria-labelledby="acc-title" className="dash__section">
            <h2 id="acc-title">Account</h2>
            <div className="panel panel--info">
              <p className="panel__title">There are no accounts yet</p>
              <p>You are not signed in because sign-in does not exist in this version. Your saved list lives only in this browser.</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
