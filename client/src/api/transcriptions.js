// POST /api/transcriptions. The ONE place that knows the response shape.
//
// Expected 200 body (either form is accepted):
//   { videoId?, lang?, availableLangs?, segments: [{ startMs, endMs, text }] }
//   { videoId?, transcript: { lang?, availableLangs?, segments: [...] } }
// A segment may carry durationMs instead of endMs. Anything else is rejected with a 'shape' error that
// names the keys it received (never their values), so a mismatch is visible and cheap to fix here.
import { apiFetch, ApiError } from './client.js';
import { parseYouTubeUrl } from '../lib/youtube.js';

const keysOf = (v) => (v && typeof v === 'object' ? Object.keys(v).slice(0, 12) : []);

function shapeError(reason, body) {
  return new ApiError({
    kind: 'shape',
    message: reason,
    details: { receivedKeys: keysOf(body) },
  });
}

/** @returns {{videoId: string|null, lang: string|null, availableLangs: string[], segments: {startMs:number,endMs:number,text:string}[]}} */
export function normalizeTranscriptionResponse(body, { submittedUrl } = {}) {
  if (!body || typeof body !== 'object') throw shapeError('The response was empty or not JSON.', body);
  const root = body?.data?.transcript && typeof body.data.transcript === 'object'
  ? body.data.transcript
  : body.transcript && typeof body.transcript === 'object'
    ? body.transcript
    : body;
  if (!Array.isArray(root.segments)) throw shapeError('The response has no segments array.', body);

  const segments = root.segments.map((s, i) => {
    const startMs = Number(s?.startMs);
    const endMs = s?.endMs !== undefined ? Number(s.endMs) : startMs + Number(s?.durationMs ?? 0);
    if (!s || typeof s.text !== 'string' || !Number.isFinite(startMs) || startMs < 0 || !Number.isFinite(endMs)) {
      throw shapeError(`Segment ${i} does not have text, startMs and endMs.`, s);
    }
    return { startMs, endMs, text: s.text };
  });

  const fromUrl = submittedUrl ? parseYouTubeUrl(submittedUrl) : null;
  return {
    videoId: body.videoId ?? root.videoId ?? (fromUrl?.ok ? fromUrl.videoId : null),
    lang: typeof root.lang === 'string' ? root.lang : null,
    availableLangs: Array.isArray(root.availableLangs) ? root.availableLangs.filter((l) => typeof l === 'string') : [],
    segments,
  };
}

/** @param {{url: string, lang?: string, signal?: AbortSignal, fetchImpl?: typeof fetch, baseUrl?: string}} p */
export async function createTranscription({ url, lang, signal, fetchImpl, baseUrl }) {
  const { body } = await apiFetch('/api/transcriptions', {
    method: 'POST',
    body: lang ? { url, lang } : { url },
    signal,
    fetchImpl,
    baseUrl,
  });
  return normalizeTranscriptionResponse(body, { submittedUrl: url });
}
