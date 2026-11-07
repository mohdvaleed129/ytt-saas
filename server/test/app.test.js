import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { validate } from '../src/middleware/validate.js';
import { MockProvider } from '../src/providers/transcription/mock/mock-provider.js';
import { makeConfig, capturedLogger, fakeDatabase, listen, fakeToken, FAKE_PASSWORD } from '../test-support/fakes.js';

const servers = [];
afterEach(async () => { while (servers.length) await servers.pop().close(); });

async function boot({ config = {}, db = fakeDatabase(), routes, level = 'debug' } = {}) {
  const cap = capturedLogger(level);
  const app = createApp({ config: makeConfig(config), logger: cap.logger, database: db, provider: new MockProvider(), routes });
  const srv = await listen(app);
  servers.push(srv);
  return { ...srv, cap, db };
}
const get = (srv, path, init) => fetch(srv.url + path, init);
const post = (srv, path, body, headers = {}) =>
  fetch(srv.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('GET /healthz is a cheap liveness answer', async () => {
  const s = await boot();
  const r = await get(s, '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const b = await r.json();
  assert.equal(b.status, 'ok');
  assert.equal(typeof b.uptimeSec, 'number');
  assert.equal(s.db.pings, 0, 'liveness must not touch the database');
  await s.close();
});

test('GET /readyz reflects database health and never leaks error text', async () => {
  const s = await boot();
  const ok = await get(s, '/readyz');
  assert.equal(ok.status, 200);
  const b = await ok.json();
  assert.equal(b.status, 'ready');
  assert.equal(b.checks.database.status, 'ok');
  assert.deepEqual(b.checks.transcriptionProvider, { status: 'ok', name: 'mock' });
  assert.equal(b.requestId, ok.headers.get('x-request-id'));

  s.db.ok = false;
  const down = await get(s, '/readyz');
  assert.equal(down.status, 503);
  const d = await down.json();
  assert.equal(d.status, 'not_ready');
  assert.deepEqual(d.checks.database, { status: 'fail' });
  await s.close();
});

test('request IDs: generated, echoed when safe, replaced when not', async () => {
  const s = await boot();
  const generated = (await get(s, '/healthz')).headers.get('x-request-id');
  assert.match(generated, /^[0-9a-f-]{36}$/);
  const echoed = await get(s, '/healthz', { headers: { 'x-request-id': 'client-req-12345' } });
  assert.equal(echoed.headers.get('x-request-id'), 'client-req-12345');
  for (const bad of ['short', 'has spaces in it here', 'x'.repeat(65), '<script>alert(1)</script>']) {
    const r = await get(s, '/healthz', { headers: { 'x-request-id': bad } });
    assert.notEqual(r.headers.get('x-request-id'), bad);
    assert.match(r.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  }
  await s.close();
});

test('security headers are set and the framework is not advertised', async () => {
  const s = await boot();
  const r = await get(s, '/healthz');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.ok(r.headers.get('content-security-policy'));
  assert.ok(r.headers.get('strict-transport-security'));
  await s.close();
});

test('unknown routes return the error envelope with the request ID', async () => {
  const s = await boot();
  const r = await get(s, '/nope');
  assert.equal(r.status, 404);
  const b = await r.json();
  assert.equal(b.error.code, 'NOT_FOUND');
  assert.equal(b.error.requestId, r.headers.get('x-request-id'));
  assert.equal(r.headers.get('cache-control'), 'no-store');
  await s.close();
});

test('malformed JSON gives 400 INVALID_JSON and does not echo the body', async () => {
  const s = await boot({ routes: (app) => app.post('/t', (req, res) => res.json({})) });
  const r = await post(s, '/t', `{"password":"${FAKE_PASSWORD}", oops`);
  assert.equal(r.status, 400);
  const text = await r.text();
  assert.equal(JSON.parse(text).error.code, 'INVALID_JSON');
  assert.ok(!text.includes(FAKE_PASSWORD));
  await s.close();
});

test('oversized bodies are rejected with 413 before reaching a handler', async () => {
  let reached = false;
  const s = await boot({ config: { bodyLimitKb: 1 }, routes: (app) => app.post('/t', (req, res) => { reached = true; res.json({}); }) });
  const r = await post(s, '/t', { blob: 'x'.repeat(5000) });
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(reached, false);
  await s.close();
});

test('unexpected errors become a generic 500 and never leak message or stack', async () => {
  const secret = fakeToken();
  const s = await boot({
    routes: (app) => {
      app.get('/sync-boom', () => { throw new Error(`db said ${secret}`); });
      app.get('/async-boom', async () => { throw new Error(`async ${secret}`); });
    },
  });
  for (const path of ['/sync-boom', '/async-boom']) {
    const r = await get(s, path);
    assert.equal(r.status, 500);
    const text = await r.text();
    const b = JSON.parse(text);
    assert.equal(b.error.code, 'INTERNAL_ERROR');
    assert.equal(b.error.message, 'Something went wrong on our side.');
    assert.ok(!text.includes(secret) && !text.includes('at '), 'leaked internals');
    assert.equal(b.error.requestId, r.headers.get('x-request-id'));
  }
  const logs = s.cap.text();
  assert.ok(!logs.includes(secret), 'secret reached the logs');
  assert.ok(s.cap.objects().some((o) => o.level === 'error' && o.msg === 'unhandled error' && o.requestId));
  await s.close();
});

test('CORS: only listed origins get headers; preflight works; no Origin means no CORS headers', async () => {
  const s = await boot({ config: { cors: { origins: ['https://app.example.com'] } } });
  const ok = await get(s, '/healthz', { headers: { origin: 'https://app.example.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  assert.match(ok.headers.get('vary'), /Origin/);
  const evil = await get(s, '/healthz', { headers: { origin: 'https://evil.example.com' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const none = await get(s, '/healthz');
  assert.equal(none.headers.get('access-control-allow-origin'), null);
  const pre = await get(s, '/anything', { method: 'OPTIONS', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.match(pre.headers.get('access-control-allow-headers'), /idempotency-key/i);
  const preEvil = await get(s, '/anything', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' } });
  assert.equal(preEvil.headers.get('access-control-allow-origin'), null);
  await s.close();
});

test('rate limiting returns 429 in the envelope with Retry-After; health checks are exempt', async () => {
  const s = await boot({ config: { rateLimit: { windowMs: 60000, max: 3 } }, routes: (app) => app.get('/limited', (req, res) => res.json({ ok: true })) });
  for (let i = 0; i < 3; i++) assert.equal((await get(s, '/limited')).status, 200);
  const blocked = await get(s, '/limited');
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  for (let i = 0; i < 10; i++) assert.equal((await get(s, '/healthz')).status, 200);
  await s.close();
});

test('validation: parsed values on req.valid, details without echoing input', async () => {
  const body = z.object({ url: z.url(), count: z.coerce.number().int().min(1).default(1) }).strict();
  const query = z.object({ lang: z.enum(['en', 'es']).optional() });
  const params = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) });
  const s = await boot({
    routes: (app) => app.post('/v/:id', validate({ body, query, params }), (req, res) => res.json(req.valid)),
  });
  const ok = await post(s, '/v/abcdefghijk?lang=es', { url: 'https://example.com/x', count: '3' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { body: { url: 'https://example.com/x', count: 3 }, query: { lang: 'es' }, params: { id: 'abcdefghijk' } });

  const leak = `not-a-url-${FAKE_PASSWORD}`;
  const bad = await post(s, '/v/short?lang=fr', { url: leak, extra: 1 });
  assert.equal(bad.status, 400);
  const text = await bad.text();
  const e = JSON.parse(text).error;
  assert.equal(e.code, 'VALIDATION_ERROR');
  const where = e.details.map((d) => `${d.location}:${d.path}`).sort();
  assert.ok(where.includes('body:url') && where.includes('query:lang') && where.includes('params:id'), where.join());
  assert.ok(e.details.every((d) => d.code && d.message));
  assert.ok(!text.includes(FAKE_PASSWORD), 'submitted value echoed back');
  await s.close();
});

test('logs: path only (no query string), no bodies, health checks at debug level', async () => {
  const s = await boot({ level: 'info', routes: (app) => app.post('/t', (req, res) => res.json({ ok: 1 })) });
  await post(s, '/t?token=querysecret123', { password: FAKE_PASSWORD });
  await get(s, '/healthz');
  const text = s.cap.text();
  assert.ok(!text.includes('querysecret123'));
  assert.ok(!text.includes(FAKE_PASSWORD));
  const objs = s.cap.objects();
  const line = objs.find((o) => o.path === '/t');
  assert.deepEqual([line.method, line.status, line.msg], ['POST', 200, 'request']);
  assert.equal(typeof line.durationMs, 'number');
  assert.equal(line.requestId.length > 0, true);
  assert.ok(!objs.some((o) => o.path === '/healthz'), 'health checks should not log at info');
  await s.close();
});
test('POST /api/transcriptions returns a normalized native transcript', async () => {
  const { transcriptionRouter } = await import('../src/modules/transcription/transcription-router.js');
  const s = await boot({
    routes: (app) => app.use('/api/transcriptions', transcriptionRouter({ provider: new MockProvider() })),
  });

  const r = await post(s, '/api/transcriptions', {
    url: 'https://www.youtube.com/watch?v=mockNative1',
    lang: 'es',
  });

  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.data.videoId, 'mockNative1');
  assert.equal(b.data.status, 'completed');
  assert.equal(b.data.transcript.lang, 'es');
  assert.ok(b.data.transcript.segments.length > 0);
  await s.close();
});

test('POST /api/transcriptions rejects invalid YouTube URLs', async () => {
  const { transcriptionRouter } = await import('../src/modules/transcription/transcription-router.js');
  const s = await boot({
    routes: (app) => app.use('/api/transcriptions', transcriptionRouter({ provider: new MockProvider() })),
  });

  const r = await post(s, '/api/transcriptions', {
    url: 'https://example.com/video',
  });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'VALIDATION_ERROR');
  await s.close();
});

test('POST /api/transcriptions returns 422 when captions are unavailable', async () => {
  const { transcriptionRouter } = await import('../src/modules/transcription/transcription-router.js');
  const s = await boot({
    routes: (app) => app.use('/api/transcriptions', transcriptionRouter({ provider: new MockProvider() })),
  });

  const r = await post(s, '/api/transcriptions', {
    url: 'https://www.youtube.com/watch?v=mockNoCaps1',
  });

  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, 'TRANSCRIPT_UNAVAILABLE');
  await s.close();
});

test('POST /api/transcriptions rejects malformed request bodies', async () => {
  const { transcriptionRouter } = await import('../src/modules/transcription/transcription-router.js');
  const s = await boot({
    routes: (app) => app.use('/api/transcriptions', transcriptionRouter({ provider: new MockProvider() })),
  });

  const r = await post(s, '/api/transcriptions', {
    url: 'not-a-url',
  });

  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'VALIDATION_ERROR');
  await s.close();
});