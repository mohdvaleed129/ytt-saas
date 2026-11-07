import { useNavigate } from 'react-router';
import LinkForm from '../generator/LinkForm.jsx';
import { sampleTranscript } from '../../data/sample-transcript.js';
import { formatTimestamp } from '../../lib/transcript-format.js';

const PREVIEW = sampleTranscript('en').segments.slice(0, 4);

export default function Hero() {
  const navigate = useNavigate();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container">
        <div className="ticket ticket--perf hero__ticket">
          <div className="hero__main">
            <div className="ticket__band"><span>Transcript ticket</span><span>Video → text</span></div>
            <div className="ticket__body hero__body">
              <h1 id="hero-title">Paste a YouTube link. Get the transcript.</h1>
              <p className="hero__lead">
                Every line comes with the time it starts. Search it, copy it, or download it as TXT or an SRT subtitle file.
              </p>
              <LinkForm variant="hero" onSubmit={(v) => navigate('/generator', { state: { start: v } })} />
            </div>
          </div>
          <aside className="ticket__stub hero__stub" aria-label="Example of the printout">
            <p className="hero__stub-label">Sample printout</p>
            <ol className="hero__stub-lines" aria-hidden="true">
              {PREVIEW.map((s) => (
                <li key={s.startMs}><span className="mono">{formatTimestamp(s.startMs)}</span><span>{s.text}</span></li>
              ))}
            </ol>
            <p className="hero__stub-fine">Synthetic text, not from a real video.</p>
          </aside>
        </div>
        <p className="hero__note">
          Works on videos that already have captions. AI transcription for videos without captions is not available yet.
        </p>
      </div>
    </section>
  );
}
