// Thin, dependency-free client for the Supadata transcript API.
// Contract source: https://docs.supadata.ai/get-transcript (verified Nov 2026).
//
// Cost control lives here, at the lowest level: any mode that can trigger AI
// generation ('auto' falls back to it, 'generate' always uses it) is refused
// unless the caller explicitly constructed the client with allowGenerate: true.

const DEFAULT_BASE_URL = 'https://api.supadata.ai/v1';
const MODES = new Set(['native', 'auto', 'generate']);
const JOB_STATUSES = new Set(['queued', 'active', 'completed', 'failed']);
const TRANSIENT_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'internal-error', 'upstream-error']);

export class SupadataError extends Error {
  constructor({ code, message, httpStatus = null, details = null, retryAfterSec = null }) {
    super(message);
    this.name = 'SupadataError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.retryAfterSec = retryAfterSec;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function codeFromStatus(status) {
  switch (status) {
    case 400: return 'invalid-request';
    case 401: return 'unauthorized';
    case 402: return 'upgrade-required';
    case 403: return 'forbidden';
    case 404: return 'not-found';
    case 429: return 'limit-exceeded';
    case 502: return 'upstream-error';
    default: return status >= 500 ? 'internal-error' : 'unknown-error';
  }
}

function toError(res) {
  const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
  return new SupadataError({
    code: typeof res.body?.error === 'string' ? res.body.error : codeFromStatus(res.status),
    message: res.body?.message ?? `Supadata responded with HTTP ${res.status}.`,
    httpStatus: res.status,
    details: res.body?.details ?? null,
    retryAfterSec: Number.isFinite(retryAfter) ? retryAfter : null,
  });
}

export function createSupadataClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 120_000,
  allowGenerate = false,
  fetchImpl = fetch,
  sleep = defaultSleep,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('SUPADATA_API_KEY is required.');
  }

  async function request(path, query = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: controller.signal,
      });
      const raw = await res.text();
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* non-JSON body */ }
      const billable = Number.parseInt(res.headers.get('x-billable-requests') ?? '', 10);
      return {
        status: res.status,
        headers: res.headers,
        body,
        billableCredits: Number.isFinite(billable) ? billable : null,
      };
    } catch (err) {
      if (err instanceof SupadataError) throw err;
      if (err?.name === 'AbortError') {
        throw new SupadataError({
          code: 'TIMEOUT',
          message: `No complete response within ${timeoutMs} ms. The request may still have been billed.`,
        });
      }
      throw new SupadataError({
        code: 'NETWORK_ERROR',
        message: `Could not reach Supadata (${err?.cause?.code ?? err?.message ?? 'unknown'}).`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @returns {Promise<
   *   {kind:'transcript', lang:string|null, availableLangs:string[], content:object[], billableCredits:number|null, httpStatus:number, bodyKeys:string[]} |
   *   {kind:'job', jobId:string, billableCredits:number|null, httpStatus:number} |
   *   {kind:'unavailable', billableCredits:number|null, httpStatus:number, message:string|null}>}
   */
  async function getTranscript({ url, lang, mode = 'native' }) {
    if (!MODES.has(mode)) {
      throw new SupadataError({ code: 'INVALID_MODE', message: `Unknown mode "${mode}".` });
    }
    if (mode !== 'native' && !allowGenerate) {
      throw new SupadataError({
        code: 'AI_GENERATION_DISABLED',
        message: `Mode "${mode}" can trigger paid AI transcription and is disabled for this client.`,
      });
    }
    const res = await request('/transcript', { url, lang, mode });

    if (res.status === 200) {
      if (!Array.isArray(res.body?.content)) {
        throw new SupadataError({
          code: 'UNEXPECTED_RESPONSE',
          message: 'HTTP 200 without a content array.',
          httpStatus: 200,
        });
      }
      return {
        kind: 'transcript',
        lang: res.body.lang ?? null,
        availableLangs: Array.isArray(res.body.availableLangs) ? res.body.availableLangs : [],
        content: res.body.content,
        billableCredits: res.billableCredits,
        httpStatus: 200,
        bodyKeys: Object.keys(res.body),
      };
    }
    if (res.status === 202) {
      if (typeof res.body?.jobId !== 'string' || !res.body.jobId) {
        throw new SupadataError({
          code: 'UNEXPECTED_RESPONSE',
          message: 'HTTP 202 without a jobId.',
          httpStatus: 202,
        });
      }
      return { kind: 'job', jobId: res.body.jobId, billableCredits: res.billableCredits, httpStatus: 202 };
    }
    if (res.status === 206) {
      return {
        kind: 'unavailable',
        billableCredits: res.billableCredits,
        httpStatus: 206,
        message: res.body?.message ?? null,
      };
    }
    throw toError(res);
  }

  async function getJob(jobId) {
    if (typeof jobId !== 'string' || !jobId) {
      throw new SupadataError({ code: 'INVALID_JOB_ID', message: 'A job ID is required.' });
    }
    const res = await request(`/transcript/${encodeURIComponent(jobId)}`);
    if (res.status !== 200) throw toError(res);

    const status = res.body?.status;
    if (!JOB_STATUSES.has(status)) {
      throw new SupadataError({
        code: 'UNEXPECTED_RESPONSE',
        message: `Unknown job status "${status}".`,
        httpStatus: 200,
      });
    }
    if (status === 'failed') return { status, error: res.body.error ?? null };
    if (status !== 'completed') return { status };

    // The REST docs show result fields at the top level; the Node SDK docs mention `.result`.
    // Accept both and report which one was observed so the PoC can settle it with real data.
    const nested = res.body.result && typeof res.body.result === 'object';
    const payload = nested ? res.body.result : res.body;
    if (!Array.isArray(payload.content)) {
      throw new SupadataError({
        code: 'UNEXPECTED_RESPONSE',
        message: 'Completed job without a content array.',
        httpStatus: 200,
      });
    }
    return {
      status,
      lang: payload.lang ?? null,
      availableLangs: Array.isArray(payload.availableLangs) ? payload.availableLangs : [],
      content: payload.content,
      shape: nested ? 'nested-result' : 'top-level',
    };
  }

  /** Polls a job (status checks are free per docs). Server keeps working if we time out. */
  async function waitForJob(jobId, { intervalMs = 1000, timeoutMs: maxWaitMs = 300_000, onPoll } = {}) {
    const startedAt = Date.now();
    let polls = 0;
    let transientFailures = 0;
    for (;;) {
      let job;
      try {
        job = await getJob(jobId);
        transientFailures = 0;
      } catch (err) {
        if (!(err instanceof SupadataError) || !TRANSIENT_CODES.has(err.code) || ++transientFailures > 3) {
          throw err;
        }
        job = { status: 'active' };
      }
      polls++;
      onPoll?.(job.status, polls);
      if (job.status === 'completed' || job.status === 'failed') {
        return { ...job, polls, elapsedMs: Date.now() - startedAt };
      }
      if (Date.now() - startedAt + intervalMs > maxWaitMs) {
        throw new SupadataError({
          code: 'JOB_TIMEOUT',
          message: `Job ${jobId} not finished after ${maxWaitMs} ms (it may still complete server-side).`,
        });
      }
      await sleep(intervalMs);
    }
  }

  return { getTranscript, getJob, waitForJob };
}
