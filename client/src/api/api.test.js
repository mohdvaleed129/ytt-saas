import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, ApiError } from './client.js';
import { normalizeTranscriptionResponse, createTranscription } from './transcriptions.js';
import { getApiStatus } from './health.js';
import { describeError } from '../lib/errors.js';

const BASE = 'http://api.test';
const reply = (status, body, headers = {}) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const rejectsApi = (p, kind, extra = {}) => assert.rejects(p, (e) => e instanceof ApiError && e.kind === kind && Object.entries(extra).every(([k, v]) => e[k] === v));

test('apiFetch refuses to run without a configured API address', async () => {
  await rejectsApi(apiFetch('/x', { baseUrl: '' }), 'config');
});

test('apiFetch sends JSON and returns the parsed body', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return reply(200, { ok: true }, { 'x-request-id': 'req-123456' })(); };
  const r = await apiFetch('/api/transcriptions', { method: 'POST', body: { url: 'u' }, baseUrl: BASE, fetchImpl });
  assert.equal(seen.url, `${BASE}/api/transcriptions`);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['content-type'], 'application/json');
  assert.equal(seen.init.body, JSON.stringify({ url: 'u' }));
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.requestId, 'req-123456');
});

test('HTTP errors are parsed from the backend envelope, including request ID and Retry-After', async () => {
  const body = { error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: 'rid-1234567' } };
  await rejectsApi(apiFetch('/x', { baseUrl: BASE, fetchImpl: reply(429, body, { 'retry-after': '7' }) }), 'http',
    { status: 429, code: 'RATE_LIMITED', requestId: 'rid-1234567', retryAfterSec: 7 });
  await rejectsApi(apiFetch('/x', { baseUrl: BASE, fetchImpl: async () => new Response('<html>', { status: 502 }) }), 'http', { status: 502, code: null });
});

test('network failures, timeouts and cancellation are told apart', async () => {
  await rejectsApi(apiFetch('/x', { baseUrl: BASE, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), 'network');
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
  await rejectsApi(apiFetch('/x', { baseUrl: BASE, fetchImpl: hang, timeoutMs: 30 }), 'timeout');
  const ac = new AbortController();
  const p = apiFetch('/x', { baseUrl: BASE, fetchImpl: hang, signal: ac.signal, timeoutMs: 5000 });
  ac.abort();
  await rejectsApi(p, 'aborted');
});

const SEGS = [{ startMs: 0, endMs: 2000, text: 'a' }, { startMs: 2000, durationMs: 1500, text: 'b' }];

test('normalize accepts the flat and the nested response shapes', () => {
  const flat = normalizeTranscriptionResponse({ videoId: 'dQw4w9WgXcQ', lang: 'en', availableLangs: ['en', 'es'], segments: SEGS });
  assert.deepEqual([flat.videoId, flat.lang, flat.availableLangs], ['dQw4w9WgXcQ', 'en', ['en', 'es']]);
  assert.deepEqual(flat.segments[1], { startMs: 2000, endMs: 3500, text: 'b' });
  const nested = normalizeTranscriptionResponse({ transcript: { lang: 'hi', segments: SEGS } }, { submittedUrl: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.deepEqual([nested.videoId, nested.lang, nested.availableLangs], ['dQw4w9WgXcQ', 'hi', []]);
});

test('normalize rejects unexpected shapes loudly and names fields, never values', () => {
  const secret = 'do-not-echo-this-value';
  for (const bad of [null, 'text', {}, { segments: 'nope' }, { segments: [{ text: 'x' }] }, { segments: [{ startMs: -1, endMs: 1, text: 'x' }] }, { content: [{ offset: 0, text: secret }] }]) {
    try { normalizeTranscriptionResponse(bad); assert.fail('expected a shape error'); }
    catch (e) {
      assert.ok(e instanceof ApiError && e.kind === 'shape');
      assert.ok(!JSON.stringify([e.message, e.details]).includes(secret));
    }
  }
});

test('createTranscription posts url and optional lang and returns normalized data', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return reply(200, { segments: SEGS, lang: 'en' })(); };
  await createTranscription({ url: 'https://youtu.be/dQw4w9WgXcQ', baseUrl: BASE, fetchImpl });
  await createTranscription({ url: 'https://youtu.be/dQw4w9WgXcQ', lang: 'es', baseUrl: BASE, fetchImpl });
  assert.deepEqual(bodies, [{ url: 'https://youtu.be/dQw4w9WgXcQ' }, { url: 'https://youtu.be/dQw4w9WgXcQ', lang: 'es' }]);
});

test('getApiStatus reports ready, not_ready, unreachable and unconfigured', async () => {
  assert.deepEqual((await getApiStatus({ baseUrl: BASE, fetchImpl: reply(200, { status: 'ready', checks: { database: { status: 'ok' } } }) })).state, 'ready');
  assert.equal((await getApiStatus({ baseUrl: BASE, fetchImpl: reply(503, { status: 'not_ready' }) })).state, 'not_ready');
  assert.equal((await getApiStatus({ baseUrl: BASE, fetchImpl: async () => { throw new TypeError('x'); } })).state, 'unreachable');
  assert.equal((await getApiStatus({ baseUrl: '' })).state, 'unconfigured');
});

test('describeError gives specific, honest copy for each failure', () => {
  const e = (p) => describeError(new ApiError(p), { origin: 'http://localhost:5173' });
  assert.match(e({ kind: 'config' }).hint, /VITE_API_URL/);
  assert.match(e({ kind: 'network' }).hint, /CORS_ORIGINS includes http:\/\/localhost:5173/);
  assert.equal(e({ kind: 'timeout' }).retryable, true);
  const unavailable = e({ kind: 'http', status: 422, code: 'TRANSCRIPT_UNAVAILABLE', message: 'x' });
  assert.equal(unavailable.tone, 'info');
  assert.match(unavailable.hint, /AI transcription .* not available yet/);
  assert.match(e({ kind: 'http', status: 404, message: 'Route not found.' }).title, /route was not found/i);
  assert.equal(e({ kind: 'http', status: 404, message: 'No such video' }).title, 'Video not found');
  assert.match(e({ kind: 'http', status: 429, retryAfterSec: 9 }).message, /9 seconds/);
  const five = e({ kind: 'http', status: 500, requestId: 'rid-abc12345' });
  assert.match(five.hint, /rid-abc12345/);
  assert.match(e({ kind: 'shape', message: 'No segments.', details: { receivedKeys: ['a', 'b'] } }).hint, /Received fields: a, b/);
});
