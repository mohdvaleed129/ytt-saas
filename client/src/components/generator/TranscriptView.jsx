import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Search, X } from 'lucide-react';
import SegmentList from './SegmentList.jsx';
import { buildSrt, buildTxt, exportFilename, findMatches, formatTimestamp, totalDurationMs } from '../../lib/transcript-format.js';
import { copyText, downloadTextFile } from '../../lib/download.js';
import { languageName } from '../../lib/languages.js';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Shows a transcript and everything you can do with it. Remount it (key) for a different transcript.
 * @param {{transcript: object, onSwitchLang?: (code: string) => void, switching?: boolean, focusOnMount?: boolean}} props
 */
export default function TranscriptView({ transcript, onSwitchLang, switching = false, focusOnMount = false }) {
  const { videoId, lang, requestedLang, availableLangs = [], segments, source } = transcript;
  const isSample = source === 'sample';
  const [query, setQuery] = useState('');
  const [timestamps, setTimestamps] = useState(true);
  const [trimOverlaps, setTrimOverlaps] = useState(true);
  const [soundLabels, setSoundLabels] = useState(true);
  const [copy, setCopy] = useState('idle'); // idle | copied | failed
  const headingRef = useRef(null);

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const rows = useMemo(() => {
    const all = segments.map((segment, index) => ({ segment, index }));
    return query.trim() ? all.filter(({ segment }) => findMatches(segment.text, query).length > 0) : all;
  }, [segments, query]);

  const matchCount = useMemo(
    () => (query.trim() ? rows.reduce((n, { segment }) => n + findMatches(segment.text, query).length, 0) : 0),
    [rows, query],
  );

  const opts = { timestamps, includeSoundLabels: soundLabels };
  const duration = formatTimestamp(totalDurationMs(segments));

  async function onCopy() {
    const ok = await copyText(buildTxt(segments, opts));
    setCopy(ok ? 'copied' : 'failed');
    setTimeout(() => setCopy('idle'), 2500);
  }
  const onTxt = () => downloadTextFile(exportFilename({ videoId, lang, ext: 'txt' }), buildTxt(segments, opts), 'text/plain');
  const onSrt = () => downloadTextFile(exportFilename({ videoId, lang, ext: 'srt' }), buildSrt(segments, { trimOverlaps, includeSoundLabels: soundLabels }), 'application/x-subrip');

  const mismatch = requestedLang && lang && requestedLang !== lang;
  const otherLangs = availableLangs.filter((l) => l !== lang);

  return (
    <article className="ticket transcript" aria-labelledby="transcript-heading">
      <div className="ticket__band">
        <span>{isSample ? 'Synthetic sample' : source === 'history' ? 'Saved in this browser' : 'Native captions'}</span>
        <span>{languageName(lang)}{lang ? ` · ${lang}` : ''} · {segments.length} lines · {duration}</span>
      </div>
      <div className="ticket__body transcript__body">
        <div className="transcript__head">
          <h2 id="transcript-heading" className="transcript__title" ref={headingRef} tabIndex={-1}>
            {isSample ? 'Sample transcript' : 'Your transcript'}
          </h2>
          {isSample ? (
            <p className="stamp stamp--info">Demo data, not a real video</p>
          ) : (
            <a className="transcript__yt" href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`} target="_blank" rel="noopener noreferrer">
              Open on YouTube <ExternalLink aria-hidden="true" />
            </a>
          )}
        </div>

        {source === 'history' && transcript.createdAt && (
          <p className="transcript__note" role="status">Saved copy from {dateFmt.format(new Date(transcript.createdAt))}. No new request was made.</p>
        )}
        {mismatch && (
          <p className="transcript__note transcript__note--warn" role="status">
            You asked for {languageName(requestedLang)}; the video returned {languageName(lang)} captions.
          </p>
        )}
        {!isSample && transcript.savedLocally === false && (
          <p className="transcript__note transcript__note--warn" role="status">
            This transcript could not be saved in your browser (storage is full or blocked). Download it now if you need it.
          </p>
        )}

        {otherLangs.length > 0 && onSwitchLang && (
          <div className="transcript__langs">
            <span className="field__label">Other languages</span>
            <ul>
              {otherLangs.map((l) => (
                <li key={l}>
                  <button type="button" className="chip" disabled={switching} onClick={() => onSwitchLang(l)} lang={l}>{languageName(l)}</button>
                </li>
              ))}
            </ul>
            {!isSample && <span className="field__hint">Each language is a separate request.</span>}
          </div>
        )}

        <div className="transcript__toolbar">
          <div className="field transcript__search">
            <label className="field__label" htmlFor="transcript-search">Search this transcript</label>
            <div className="search-box">
              <Search aria-hidden="true" />
              <input id="transcript-search" className="field__control" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a word or phrase" autoComplete="off" />
              {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X aria-hidden="true" /></button>}
            </div>
          </div>
          <div className="transcript__actions">
            <button type="button" className="btn btn--small" onClick={onCopy}>
              {copy === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copy === 'copied' ? 'Copied' : 'Copy text'}
            </button>
            <button type="button" className="btn btn--small btn--quiet" onClick={onTxt}><Download aria-hidden="true" /> TXT</button>
            <button type="button" className="btn btn--small btn--quiet" onClick={onSrt}><Download aria-hidden="true" /> SRT</button>
          </div>
        </div>
        <p className="field__hint transcript__count" role="status" aria-live="polite">
          {query.trim() ? (matchCount ? `${matchCount} match${matchCount === 1 ? '' : 'es'} in ${rows.length} line${rows.length === 1 ? '' : 's'}` : 'No matches') : ''}
          <span className="visually-hidden">{copy === 'copied' ? 'Transcript copied to clipboard' : copy === 'failed' ? 'Copy failed' : ''}</span>
        </p>
        {copy === 'failed' && <p className="field__error">Copy was blocked by the browser. Use the TXT download instead.</p>}

        <details className="transcript__options">
          <summary>Export options</summary>
          <div className="transcript__options-body">
            <label className="check"><input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} /><span>Timestamps in TXT and copy</span></label>
            <label className="check"><input type="checkbox" checked={trimOverlaps} onChange={(e) => setTrimOverlaps(e.target.checked)} /><span>Trim overlapping subtitle times in SRT <em>(recommended)</em></span></label>
            <label className="check"><input type="checkbox" checked={soundLabels} onChange={(e) => setSoundLabels(e.target.checked)} /><span>Keep sound labels like [Music]</span></label>
          </div>
        </details>

        {rows.length > 0 ? (
          <SegmentList rows={rows} query={query} videoId={videoId} linkable={!isSample} lang={lang} animate={Boolean(transcript.fresh) && !query} />
        ) : (
          <p className="panel panel--info">{segments.length ? 'No line matches your search.' : 'This transcript has no text.'}</p>
        )}
      </div>
    </article>
  );
}
