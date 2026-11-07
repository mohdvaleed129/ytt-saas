import { useId, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, X } from 'lucide-react';
import { parseYouTubeUrl } from '../../lib/youtube.js';
import { LANGUAGES } from '../../lib/languages.js';

/**
 * The link + language form. Validates on submit (never while typing), then calls onSubmit({ url, lang }).
 * @param {{variant?: 'hero'|'desk', busy?: boolean, initialUrl?: string, initialLang?: string,
 *          onSubmit: (v: {url: string, lang: string}) => void, onCancel?: () => void, submitLabel?: string}} props
 */
export default function LinkForm({ variant = 'desk', busy = false, initialUrl = '', initialLang = '', onSubmit, onCancel, submitLabel = 'Print transcript' }) {
  const [url, setUrl] = useState(initialUrl);
  const [lang, setLang] = useState(initialLang);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const uid = useId();
  const urlId = `${uid}-url`;
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;

  function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const parsed = parseYouTubeUrl(url);
    if (!parsed.ok) {
      setError(parsed.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit({ url: url.trim(), lang });
  }

  return (
    <form className={`link-form link-form--${variant}`} onSubmit={handleSubmit} noValidate>
      <div className="field link-form__url">
        <label className="field__label" htmlFor={urlId}>YouTube link</label>
        <input
          ref={inputRef} id={urlId} className="field__control" type="url" inputMode="url" autoComplete="off" spellCheck="false"
          placeholder="https://www.youtube.com/watch?v=…" value={url} disabled={busy}
          onChange={(e) => { setUrl(e.target.value); if (error) setError(null); }}
          aria-invalid={error ? 'true' : 'false'} aria-describedby={error ? errId : hintId}
        />
      </div>
      <div className="link-form__msg">
        {error ? (
          <p id={errId} className="field__error" role="alert"><CircleAlert aria-hidden="true" /> {error}</p>
        ) : (
          <p id={hintId} className="field__hint">Videos, Shorts and youtu.be links all work.</p>
        )}
      </div>
      <div className="field link-form__lang">
        <label className="field__label" htmlFor={`${uid}-lang`}>Language</label>
        <select id={`${uid}-lang`} className="field__control" value={lang} disabled={busy} onChange={(e) => setLang(e.target.value)}>
          {LANGUAGES.map(([code, label]) => <option key={code || 'auto'} value={code}>{label}</option>)}
        </select>
      </div>
      <div className="link-form__action">
        {busy ? (
          <button type="button" className="btn btn--quiet" onClick={onCancel}><X aria-hidden="true" /> Cancel</button>
        ) : (
          <button type="submit" className="btn">{submitLabel} <ArrowRight aria-hidden="true" /></button>
        )}
      </div>
    </form>
  );
}
