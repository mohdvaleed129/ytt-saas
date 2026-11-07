// Small fetch wrapper for the backend. Every failure becomes an ApiError with a `kind`, so the UI can
// explain what actually happened instead of showing a generic "something went wrong".
import { API_URL, REQUEST_TIMEOUT_MS } from '../config.js';

export class ApiError extends Error {
  /**
   * @param {{kind: 'config'|'network'|'timeout'|'aborted'|'http'|'shape', message?: string, status?: number|null,
   *          code?: string|null, requestId?: string|null, retryAfterSec?: number|null, details?: unknown}} p
   */
  constructor({ kind, message = '', status = null, code = null, requestId = null, retryAfterSec = null, details = null }) {
    super(message || kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSec = retryAfterSec;
    this.details = details;
  }
}

/** Aborts when either the caller's signal fires or the timeout elapses; reports which one it was. */
function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    done: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); },
  };
}

/**
 * @param {string} path e.g. '/api/transcriptions'
 * @param {{method?: string, body?: unknown, signal?: AbortSignal, timeoutMs?: number, baseUrl?: string, fetchImpl?: typeof fetch}} [opts]
 */
export async function apiFetch(path, { method = 'GET', body, signal, timeoutMs = REQUEST_TIMEOUT_MS, baseUrl = API_URL, fetchImpl = fetch } = {}) {
  if (!baseUrl) {
    throw new ApiError({ kind: 'config', message: 'VITE_API_URL is not set.' });
  }
  const t = withTimeout(signal, timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: t.signal,
    });
  } catch (err) {
    t.done();
    if (t.didTimeOut()) throw new ApiError({ kind: 'timeout', message: 'The server did not answer in time.' });
    if (err?.name === 'AbortError') throw new ApiError({ kind: 'aborted', message: 'Cancelled.' });
    // Browsers report a refused connection, DNS failure and a CORS block identically.
    throw new ApiError({ kind: 'network', message: 'The server could not be reached.' });
  }

  let json;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  } finally {
    t.done();
  }

  if (!res.ok) {
    const env = json?.error;
    const retry = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
    throw new ApiError({
      kind: 'http',
      status: res.status,
      code: typeof env?.code === 'string' ? env.code : null,
      message: typeof env?.message === 'string' ? env.message : `The server answered with HTTP ${res.status}.`,
      requestId: env?.requestId ?? res.headers.get('x-request-id'),
      retryAfterSec: Number.isFinite(retry) ? retry : null,
      details: env?.details ?? null,
    });
  }
  return { status: res.status, body: json, requestId: res.headers.get('x-request-id') };
}
