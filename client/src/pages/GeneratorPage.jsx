import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import LinkForm from '../components/generator/LinkForm.jsx';
import TranscriptView from '../components/generator/TranscriptView.jsx';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '../components/generator/StatePanels.jsx';
import { useGenerator } from '../hooks/useGenerator.js';
import { useTitle } from '../hooks/useTitle.js';
import { ENABLE_SAMPLE } from '../config.js';

export default function GeneratorPage() {
  useTitle('Generate a transcript');
  const { state, run, cancel, reset, showSample } = useGenerator();
  const location = useLocation();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const start = location.state?.start ?? null;

  // The landing page hands over { url, lang } through router state. Run it exactly once: React StrictMode runs
  // effects twice in development, and a second run would send a second (billable) request.
  useEffect(() => {
    if (start && !startedRef.current) {
      startedRef.current = true;
      run(start);
      navigate('.', { replace: true, state: null });
    }
  }, [start, run, navigate]);

  const busy = state.status === 'loading';
  const transcript = state.status === 'success' ? state.transcript : null;

  return (
    <>
      <section className="page-head" aria-labelledby="gen-title">
        <div className="container">
          <h1 id="gen-title">Generate a transcript</h1>
          <p>Paste a YouTube link, pick a language, and print it.</p>
        </div>
      </section>

      <div className="container desk">
        <div className="ticket desk__form">
          <div className="ticket__band"><span>Transcript desk</span><span>Video → text</span></div>
          <div className="ticket__body">
            <LinkForm variant="desk" busy={busy} initialUrl={start?.url ?? ''} initialLang={start?.lang ?? ''} onSubmit={run} onCancel={cancel} />
            {ENABLE_SAMPLE && (
              <p className="desk__sample">
                No backend running?{' '}
                <button type="button" className="link-btn" onClick={() => showSample('en')}>Load the labelled sample transcript</button>
                <span className="field__hint"> (demo data, never a real result)</span>
              </p>
            )}
          </div>
        </div>

        <div className="desk__result" aria-live="polite">
          {state.status === 'idle' && <EmptyPanel />}
          {state.status === 'loading' && <LoadingPanel startedAt={state.startedAt} onCancel={cancel} />}
          {state.status === 'error' && (
            <ErrorPanel error={state.error} onDismiss={reset} onRetry={state.request ? () => run({ ...state.request, force: true }) : undefined} />
          )}
          {transcript && (
            <TranscriptView
              key={`${transcript.id}`} transcript={transcript} focusOnMount={transcript.fresh}
              onSwitchLang={transcript.source === 'sample' ? (l) => showSample(l) : (l) => run({ url: transcript.url, lang: l })}
              switching={busy}
            />
          )}
        </div>
      </div>
    </>
  );
}
