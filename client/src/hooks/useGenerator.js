// The generator's state machine: idle -> loading -> success | error. One request at a time; a new request cancels the old one.
import { useCallback, useRef, useState } from 'react';
import { createTranscription } from '../api/transcriptions.js';
import { ApiError } from '../api/client.js';
import { describeError } from '../lib/errors.js';
import { parseYouTubeUrl } from '../lib/youtube.js';
import { findEntry, loadHistory, newEntry, saveEntry } from '../lib/history.js';
import { sampleTranscript } from '../data/sample-transcript.js';

export function useGenerator() {
  const [state, setState] = useState({ status: 'idle' });
  const abortRef = useRef(null);

  /** @param {{url: string, lang?: string, force?: boolean}} req */
  const run = useCallback(async ({ url, lang = '', force = false }) => {
    const parsed = parseYouTubeUrl(url);
    if (!parsed.ok) {
      setState({ status: 'error', error: describeError(new ApiError({ kind: 'http', status: 400, message: parsed.message })) });
      return;
    }

    // A saved copy in this browser answers the same request without spending a provider call.
    if (!force) {
      const saved = findEntry(parsed.videoId, lang);
      if (saved) {
        setState({ status: 'success', transcript: { ...saved, source: 'history', fresh: false }, request: { url, lang } });
        return;
      }
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading', startedAt: Date.now(), request: { url, lang } });

    try {
      const result = await createTranscription({ url: parsed.canonicalUrl, lang: lang || undefined, signal: controller.signal });
      const entry = newEntry({
        videoId: result.videoId ?? parsed.videoId, url: parsed.canonicalUrl, lang: result.lang, requestedLang: lang,
        availableLangs: result.availableLangs, segments: result.segments,
      });
      const saved = saveEntry(entry);
      setState({
        status: 'success', request: { url, lang },
        transcript: { ...entry, source: 'api', fresh: true, savedLocally: saved.ok },
      });
    } catch (err) {
      if (controller.signal.aborted && err?.kind === 'aborted') return; // cancelled by the user or replaced by a newer request
      if (!(err instanceof ApiError)) {
        setState({ status: 'error', request: { url, lang }, error: describeError(new ApiError({ kind: 'http', message: 'Unexpected error in the browser.' })) });
        return;
      }
      setState({ status: 'error', request: { url, lang }, error: describeError(err) });
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => (s.status === 'loading' ? { status: 'idle' } : s));
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  const showSample = useCallback((lang = 'en') => {
    abortRef.current?.abort();
    setState({ status: 'success', transcript: { ...sampleTranscript(lang), fresh: false }, request: null });
  }, []);

  const openSaved = useCallback((entry) => {
    abortRef.current?.abort();
    setState({ status: 'success', transcript: { ...entry, source: 'history', fresh: false }, request: null });
  }, []);

  return { state, run, cancel, reset, showSample, openSaved, history: loadHistory };
}
