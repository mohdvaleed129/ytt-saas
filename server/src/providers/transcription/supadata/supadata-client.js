// Supadata HTTP client. No API key is ever included in errors or logs.

const DEFAULT_BASE_URL = 'https://api.supadata.ai/v1';
const MODES = new Set(['native', 'auto', 'generate']);
const JOB_STATUSES = new Set(['queued', 'active', 'completed', 'failed']);

export class SupadataError extends Error {
  constructor({ code, message, httpStatus = null, retryAfterSec = null }) {
    super(message);
    this.name = 'SupadataError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterSec = retryAfterSec;
  }
}

function errorCode(status) {
  const codes = {
    400: 'invalid-request',
    401: 'unauthorized',
    402: 'upgrade-required',
    403: 'forbidden',
    404: 'not-found',
    429: 'limit-exceeded',
    502: 'upstream-error',
  };
  return codes[status] ?? (status >= 500 ? 'internal-error' : 'unknown-error');
}

export function createSupadataClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 30000,
  allowGenerate = false,
  fetchImpl = fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('SUPADATA_API_KEY is required.');
  }

  const base = new URL(baseUrl);
  if (!['https:', 'http:'].includes(base.protocol)) {
    throw new Error('Invalid Supadata base URL.');
  }

  async function request(path, query = {}) {
    const url = new URL(`${base.toString().replace(/\/$/, '')}${path}`);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      const raw = await response.text();
      let body = null;

      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        // Invalid JSON is handled by response validation below.
      }

      const credits = Number.parseInt(
        response.headers.get('x-billable-requests') ?? '',
        10
      );

      return {
        status: response.status,
        headers: response.headers,
        body,
        billableCredits: Number.isFinite(credits) ? credits : null,
      };
    } catch (error) {
      if (error instanceof SupadataError) throw error;

      if (error?.name === 'AbortError') {
        throw new SupadataError({
          code: 'TIMEOUT',
          message: 'Supadata request timed out. It may still have been billed.',
        });
      }

      // Never expose raw network errors; they may contain sensitive request details.
      throw new SupadataError({
        code: 'NETWORK_ERROR',
        message: 'Could not connect to the transcription provider.',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function providerError(response) {
    const retry = Number.parseInt(
      response.headers.get('retry-after') ?? '',
      10
    );

    return new SupadataError({
      code: typeof response.body?.error === 'string'
        ? response.body.error
        : errorCode(response.status),
      message: 'The transcription provider could not complete the request.',
      httpStatus: response.status,
      retryAfterSec: Number.isFinite(retry) ? retry : null,
    });
  }

  async function getTranscript({ url, lang, mode = 'native' }) {
    if (!MODES.has(mode)) {
      throw new SupadataError({
        code: 'INVALID_MODE',
        message: 'Unsupported transcription mode.',
      });
    }

    if (mode !== 'native' && !allowGenerate) {
      throw new SupadataError({
        code: 'AI_GENERATION_DISABLED',
        message: 'AI transcription is disabled.',
      });
    }

    const response = await request('/transcript', { url, lang, mode });
    const body = response.body;

    if (response.status === 200) {
      if (!Array.isArray(body?.content)) {
        throw new SupadataError({
          code: 'UNEXPECTED_RESPONSE',
          message: 'Provider returned an invalid transcript response.',
          httpStatus: 200,
        });
      }

      return {
        kind: 'transcript',
        lang: body.lang ?? null,
        availableLangs: Array.isArray(body.availableLangs)
          ? body.availableLangs
          : [],
        content: body.content,
        billableCredits: response.billableCredits,
      };
    }

    if (response.status === 202) {
      if (typeof body?.jobId !== 'string' || !body.jobId) {
        throw new SupadataError({
          code: 'UNEXPECTED_RESPONSE',
          message: 'Provider returned an invalid job response.',
          httpStatus: 202,
        });
      }

      return {
        kind: 'job',
        jobId: body.jobId,
        billableCredits: response.billableCredits,
      };
    }

    if (response.status === 206) {
      return {
        kind: 'unavailable',
        billableCredits: response.billableCredits,
      };
    }

    throw providerError(response);
  }

  async function getJob(jobId) {
    if (typeof jobId !== 'string' || !jobId.trim()) {
      throw new SupadataError({
        code: 'INVALID_JOB_ID',
        message: 'A valid job ID is required.',
      });
    }

    const response = await request(
      `/transcript/${encodeURIComponent(jobId)}`
    );

    if (response.status !== 200) throw providerError(response);

    const body = response.body;
    const status = body?.status;

    if (!JOB_STATUSES.has(status)) {
      throw new SupadataError({
        code: 'UNEXPECTED_RESPONSE',
        message: 'Provider returned an unknown job status.',
        httpStatus: 200,
      });
    }

    if (status === 'failed') {
      return {
        status: 'failed',
        error: { code: 'PROVIDER_ERROR', retryable: false },
      };
    }

    if (status !== 'completed') return { status };

    const payload = body.result && typeof body.result === 'object'
      ? body.result
      : body;

    if (!Array.isArray(payload.content)) {
      throw new SupadataError({
        code: 'UNEXPECTED_RESPONSE',
        message: 'Completed job has an invalid transcript.',
        httpStatus: 200,
      });
    }

    return {
      status: 'completed',
      lang: payload.lang ?? null,
      availableLangs: Array.isArray(payload.availableLangs)
        ? payload.availableLangs
        : [],
      content: payload.content,
    };
  }

  return Object.freeze({ getTranscript, getJob });
}
