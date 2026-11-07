// GET /readyz: real readiness (database reachable, provider configured). No fake status is ever shown.
import { apiFetch, ApiError } from './client.js';

/** @returns {Promise<{state: 'ready'|'not_ready'|'unreachable'|'unconfigured', checks?: object}>} */
export async function getApiStatus({ signal, fetchImpl, baseUrl } = {}) {
  try {
    const { body } = await apiFetch('/readyz', { signal, fetchImpl, baseUrl, timeoutMs: 8000 });
    return { state: body?.status === 'ready' ? 'ready' : 'not_ready', checks: body?.checks };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.kind === 'config') return { state: 'unconfigured' };
    if (err.kind === 'http' && err.status === 503) return { state: 'not_ready' };
    if (err.kind === 'aborted') throw err;
    return { state: 'unreachable' };
  }
}
