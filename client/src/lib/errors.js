// Turns an ApiError into honest, specific UI copy. Nothing here guesses: each case names what happened.

/**
 * @returns {{tone: 'info'|'warn'|'error', title: string, message: string, hint?: string, requestId?: string|null,
 *            code?: string|null, retryable: boolean}}
 */
export function describeError(err, { origin = typeof window === 'undefined' ? '' : window.location.origin } = {}) {
  const base = { requestId: err?.requestId ?? null, code: err?.code ?? null };

  switch (err?.kind) {
    case 'config':
      return { ...base, tone: 'error', retryable: false, title: 'The API address is not set',
        message: 'This site does not know where the backend is.',
        hint: 'Create client/.env from client/.env.example, set VITE_API_URL (for example http://localhost:8080), then restart npm run dev.' };
    case 'network':
      return { ...base, tone: 'error', retryable: true, title: 'Cannot reach the server',
        message: 'The request never got an answer.',
        hint: `Check that the backend is running and that its CORS_ORIGINS includes ${origin || 'this site'}. A refused connection and a CORS block look the same in a browser.` };
    case 'timeout':
      return { ...base, tone: 'warn', retryable: true, title: 'The server took too long',
        message: 'No answer arrived within the time limit. Your request may still have been processed.',
        hint: 'Try again in a moment.' };
    case 'shape':
      return { ...base, tone: 'error', retryable: false, title: 'Unexpected response from the server',
        message: 'The server answered, but not in the format this site understands.',
        hint: `${err.message} ${Array.isArray(err.details?.receivedKeys) && err.details.receivedKeys.length ? `Received fields: ${err.details.receivedKeys.join(', ')}.` : ''}`.trim() };
    default:
      break;
  }

  const status = err?.status;
  const code = err?.code;
  if (status === 422 || code === 'TRANSCRIPT_UNAVAILABLE') {
    return { ...base, tone: 'info', retryable: false, title: 'No captions available for this video',
      message: 'This video has no captions that can be retrieved, so there is nothing to show.',
      hint: 'AI transcription for videos without captions is not available yet.' };
  }
  if (status === 404 && /route/i.test(err?.message ?? '')) {
    return { ...base, tone: 'error', retryable: false, title: 'The API route was not found',
      message: 'The backend is running but has no POST /api/transcriptions route at this address.',
      hint: 'Check VITE_API_URL points at the API (not at the website) and that the transcription route is mounted.' };
  }
  if (status === 404) {
    return { ...base, tone: 'warn', retryable: false, title: 'Video not found',
      message: 'The video does not exist, or it is private, deleted or restricted.', hint: err?.message };
  }
  if (status === 400) {
    return { ...base, tone: 'warn', retryable: false, title: 'The request was not accepted',
      message: err?.message || 'The link or language was not valid.' };
  }
  if (status === 429) {
    const wait = err?.retryAfterSec ? ` Try again in about ${err.retryAfterSec} seconds.` : ' Please wait a moment and try again.';
    return { ...base, tone: 'warn', retryable: true, title: 'Too many requests', message: `You are sending requests too quickly.${wait}` };
  }
  if (status && status >= 500) {
    return { ...base, tone: 'error', retryable: true, title: 'The server had a problem',
      message: 'Something went wrong on the server side. This is not caused by your link.',
      hint: base.requestId ? `If it keeps happening, report this request ID: ${base.requestId}` : undefined };
  }
  return { ...base, tone: 'error', retryable: true, title: 'Something went wrong', message: err?.message || 'The request failed.' };
}
