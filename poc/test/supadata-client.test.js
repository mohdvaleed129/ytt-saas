// IMPORTANT: these tests run our client against a LOCAL HTTP stub that imitates the response
// shapes in Supadata's public documentation (docs.supadata.ai/get-transcript, /errors).
// They verify OUR request building, parsing, error mapping and cost gate.
// They are NOT evidence of how the real Supadata API behaves; src/poc.js does that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSupadataClient, SupadataError } from '../src/supadata-client.js';

const KEY = 'sd_test_SECRET_KEY';

async function withStub(handler, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: new URL(req.url, 'http://x'), headers: req.headers });
    handler(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    await fn(baseUrl, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const client = (baseUrl, extra = {}) =>
  createSupadataClient({ apiKey: KEY, baseUrl, sleep: () => new Promise((r) => setTimeout(r, 2)), ...extra });

const SEGMENTS = [
  { text: 'Hello', offset: 0, duration: 1200, lang: 'en' },
  { text: 'world', offset: 1200, duration: 900, lang: 'en' },
];

test('native 200: builds the documented request and parses segments + billing header', async () => {
  await withStub((req, res) => json(res, 200,
    { content: SEGMENTS, lang: 'en', availableLangs: ['en', 'es'] }, { 'x-billable-requests': '1' }),
  async (baseUrl, requests) => {
    const r = await client(baseUrl).getTranscript({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', lang: 'en' });
    assert.equal(r.kind, 'transcript');
    assert.equal(r.lang, 'en');
    assert.deepEqual(r.availableLangs, ['en', 'es']);
    assert.equal(r.content.length, 2);
    assert.equal(r.billableCredits, 1);
    const q = requests[0].url;
    assert.equal(q.pathname, '/v1/transcript');
    assert.equal(q.searchParams.get('url'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(q.searchParams.get('mode'), 'native');
    assert.equal(q.searchParams.get('lang'), 'en');
    assert.equal(q.searchParams.has('text'), false);
    assert.equal(requests[0].headers['x-api-key'], KEY);
  });
});

test('empty content array is a successful "no speech" transcript, not an error', async () => {
  await withStub((req, res) => json(res, 200, { content: [], lang: 'en', availableLangs: [] }),
    async (baseUrl) => {
      const r = await client(baseUrl).getTranscript({ url: 'u' });
      assert.equal(r.kind, 'transcript');
      assert.equal(r.content.length, 0);
    });
});

test('HTTP 206 maps to "unavailable" and keeps the billed credit visible', async () => {
  await withStub((req, res) => json(res, 206, { error: 'transcript-unavailable', message: 'No transcript' },
    { 'x-billable-requests': '1' }),
  async (baseUrl) => {
    const r = await client(baseUrl).getTranscript({ url: 'u' });
    assert.equal(r.kind, 'unavailable');
    assert.equal(r.billableCredits, 1);
    assert.equal(r.message, 'No transcript');
  });
});

test('HTTP 202 returns a job; polling handles queued -> active -> completed (top-level shape)', async () => {
  let polls = 0;
  await withStub((req, res) => {
    if (req.url.startsWith('/v1/transcript/job-1')) {
      polls++;
      if (polls === 1) return json(res, 200, { status: 'queued' });
      if (polls === 2) return json(res, 200, { status: 'active' });
      return json(res, 200, { status: 'completed', content: SEGMENTS, lang: 'en', availableLangs: ['en'] });
    }
    return json(res, 202, { jobId: 'job-1' }, { 'x-billable-requests': '4' });
  }, async (baseUrl) => {
    const c = client(baseUrl, { allowGenerate: true });
    const first = await c.getTranscript({ url: 'u', mode: 'generate' });
    assert.deepEqual([first.kind, first.jobId, first.billableCredits], ['job', 'job-1', 4]);
    const seen = [];
    const done = await c.waitForJob(first.jobId, { intervalMs: 1, onPoll: (s) => seen.push(s) });
    assert.equal(done.status, 'completed');
    assert.equal(done.shape, 'top-level');
    assert.equal(done.content.length, 2);
    assert.deepEqual(seen, ['queued', 'active', 'completed']);
  });
});

test('completed job with the SDK-documented nested `result` shape is also accepted and reported', async () => {
  await withStub((req, res) => json(res, 200,
    { status: 'completed', result: { content: SEGMENTS, lang: 'hi', availableLangs: ['hi'] } }),
  async (baseUrl) => {
    const job = await client(baseUrl).getJob('j');
    assert.equal(job.shape, 'nested-result');
    assert.equal(job.lang, 'hi');
  });
});

test('failed job surfaces its error', async () => {
  await withStub((req, res) => json(res, 200, { status: 'failed', error: { error: 'internal-error' } }),
    async (baseUrl) => {
      const done = await client(baseUrl).waitForJob('j', { intervalMs: 1 });
      assert.equal(done.status, 'failed');
      assert.deepEqual(done.error, { error: 'internal-error' });
    });
});

test('expired/unknown job (404) throws not-found', async () => {
  await withStub((req, res) => json(res, 404, { error: 'not-found', message: 'Job not found' }),
    async (baseUrl) => {
      await assert.rejects(client(baseUrl).waitForJob('gone', { intervalMs: 1 }),
        (e) => e instanceof SupadataError && e.code === 'not-found' && e.httpStatus === 404);
    });
});

test('waitForJob gives up with JOB_TIMEOUT when the job never finishes', async () => {
  await withStub((req, res) => json(res, 200, { status: 'active' }), async (baseUrl) => {
    await assert.rejects(client(baseUrl).waitForJob('slow', { intervalMs: 5, timeoutMs: 30 }),
      (e) => e.code === 'JOB_TIMEOUT');
  });
});

test('waitForJob tolerates transient poll failures but not persistent ones', async () => {
  let n = 0;
  await withStub((req, res) => {
    n++;
    if (n <= 2) return json(res, 500, { error: 'internal-error' });
    return json(res, 200, { status: 'completed', content: SEGMENTS, lang: 'en' });
  }, async (baseUrl) => {
    const done = await client(baseUrl).waitForJob('flaky', { intervalMs: 1 });
    assert.equal(done.status, 'completed');
  });
  await withStub((req, res) => json(res, 500, { error: 'internal-error' }), async (baseUrl) => {
    await assert.rejects(client(baseUrl).waitForJob('dead', { intervalMs: 1 }), (e) => e.code === 'internal-error');
  });
});

test('error statuses map to documented error codes', async () => {
  const cases = [
    [400, { error: 'invalid-request', message: 'bad' }, 'invalid-request'],
    [401, { error: 'unauthorized', message: 'bad key' }, 'unauthorized'],
    [402, { error: 'upgrade-required', message: 'plan' }, 'upgrade-required'],
    [403, { error: 'forbidden', message: 'restricted' }, 'forbidden'],
    [404, { error: 'not-found', message: 'missing' }, 'not-found'],
    [502, { error: 'upstream-error', message: 'upstream' }, 'upstream-error'],
  ];
  for (const [status, body, code] of cases) {
    await withStub((req, res) => json(res, status, body), async (baseUrl) => {
      await assert.rejects(client(baseUrl).getTranscript({ url: 'u' }),
        (e) => e.code === code && e.httpStatus === status);
    });
  }
});

test('429 exposes retry-after; non-JSON error bodies still map by status', async () => {
  await withStub((req, res) => json(res, 429, { error: 'limit-exceeded' }, { 'retry-after': '7' }),
    async (baseUrl) => {
      await assert.rejects(client(baseUrl).getTranscript({ url: 'u' }),
        (e) => e.code === 'limit-exceeded' && e.retryAfterSec === 7);
    });
  await withStub((req, res) => { res.writeHead(500, { 'content-type': 'text/html' }); res.end('<html>oops</html>'); },
    async (baseUrl) => {
      await assert.rejects(client(baseUrl).getTranscript({ url: 'u' }),
        (e) => e.code === 'internal-error' && e.httpStatus === 500);
    });
});

test('malformed 200/202 bodies are reported, not trusted', async () => {
  await withStub((req, res) => json(res, 200, { lang: 'en' }), async (baseUrl) => {
    await assert.rejects(client(baseUrl).getTranscript({ url: 'u' }), (e) => e.code === 'UNEXPECTED_RESPONSE');
  });
  await withStub((req, res) => json(res, 202, {}), async (baseUrl) => {
    await assert.rejects(client(baseUrl, { allowGenerate: true }).getTranscript({ url: 'u', mode: 'auto' }),
      (e) => e.code === 'UNEXPECTED_RESPONSE');
  });
});

test('COST GATE: auto/generate are refused before any request when allowGenerate is false', async () => {
  await withStub((req, res) => json(res, 200, { content: [] }), async (baseUrl, requests) => {
    const c = client(baseUrl);
    for (const mode of ['auto', 'generate']) {
      await assert.rejects(c.getTranscript({ url: 'u', mode }), (e) => e.code === 'AI_GENERATION_DISABLED');
    }
    await assert.rejects(c.getTranscript({ url: 'u', mode: 'bogus' }), (e) => e.code === 'INVALID_MODE');
    assert.equal(requests.length, 0, 'no HTTP request may be made when the gate refuses');
  });
});

test('COST GATE: allowGenerate true sends the requested AI mode', async () => {
  await withStub((req, res) => json(res, 200, { content: SEGMENTS, lang: 'en' }), async (baseUrl, requests) => {
    await client(baseUrl, { allowGenerate: true }).getTranscript({ url: 'u', mode: 'generate' });
    assert.equal(requests[0].url.searchParams.get('mode'), 'generate');
  });
});

test('timeout aborts the request and says it may still be billed', async () => {
  await withStub(() => { /* never respond */ }, async (baseUrl) => {
    await assert.rejects(client(baseUrl, { timeoutMs: 40 }).getTranscript({ url: 'u' }),
      (e) => e.code === 'TIMEOUT' && /billed/.test(e.message));
  });
});

test('unreachable host yields NETWORK_ERROR', async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  await assert.rejects(client(`http://127.0.0.1:${port}/v1`).getTranscript({ url: 'u' }),
    (e) => e.code === 'NETWORK_ERROR');
});

test('the API key never appears in error messages', async () => {
  await withStub((req, res) => json(res, 401, { error: 'unauthorized', message: 'Invalid API key' }),
    async (baseUrl) => {
      try {
        await client(baseUrl).getTranscript({ url: 'u' });
        assert.fail('expected rejection');
      } catch (e) {
        assert.ok(!JSON.stringify({ m: e.message, d: e.details, c: e.code }).includes(KEY));
      }
    });
  assert.throws(() => createSupadataClient({ apiKey: '  ' }), /required/);
});
