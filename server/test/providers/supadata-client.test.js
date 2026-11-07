import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createSupadataClient,
  SupadataError,
} from '../../src/providers/transcription/supadata/supadata-client.js';

const API_KEY = 'sd_test_SECRET_KEY';

async function withStub(handler, callback) {
  const requests = [];

  const server = http.createServer((req, res) => {
    requests.push({ url: new URL(req.url, 'http://localhost'), headers: req.headers });
    handler(req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  try {
    await callback(baseUrl, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function client(baseUrl, options = {}) {
  return createSupadataClient({
    apiKey: API_KEY,
    baseUrl,
    ...options,
  });
}

const CONTENT = [
  { text: 'Hello', offset: 0, duration: 1200 },
  { text: 'World', offset: 1200, duration: 900 },
];

test('native transcript request and billing credits', async () => {
  await withStub((req, res) => {
    json(res, 200, {
      content: CONTENT,
      lang: 'en',
      availableLangs: ['en', 'es'],
    }, { 'x-billable-requests': '1' });
  }, async (baseUrl, requests) => {
    const result = await client(baseUrl).getTranscript({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      lang: 'en',
    });

    assert.equal(result.kind, 'transcript');
    assert.equal(result.billableCredits, 1);
    assert.equal(result.content.length, 2);
    assert.equal(requests[0].headers['x-api-key'], API_KEY);
    assert.equal(requests[0].url.searchParams.get('mode'), 'native');
    assert.equal(requests[0].url.searchParams.get('lang'), 'en');
  });
});

test('HTTP 206 means transcript unavailable', async () => {
  await withStub((req, res) => {
    json(res, 206, { message: 'No captions' }, {
      'x-billable-requests': '1',
    });
  }, async (baseUrl) => {
    const result = await client(baseUrl).getTranscript({ url: 'u' });

    assert.equal(result.kind, 'unavailable');
    assert.equal(result.billableCredits, 1);
  });
});

test('AI generation is blocked before making an HTTP request', async () => {
  await withStub((req, res) => json(res, 200, { content: [] }),
    async (baseUrl, requests) => {
      const c = client(baseUrl);

      await assert.rejects(
        c.getTranscript({ url: 'u', mode: 'generate' }),
        (e) => e.code === 'AI_GENERATION_DISABLED',
      );

      await assert.rejects(
        c.getTranscript({ url: 'u', mode: 'auto' }),
        (e) => e.code === 'AI_GENERATION_DISABLED',
      );

      assert.equal(requests.length, 0);
    });
});

test('async job submission and completed job polling', async () => {
  let polls = 0;

  await withStub((req, res) => {
    if (req.url.includes('/transcript/job-1')) {
      polls++;

      if (polls === 1) return json(res, 200, { status: 'queued' });

      return json(res, 200, {
        status: 'completed',
        content: CONTENT,
        lang: 'en',
        availableLangs: ['en'],
      });
    }

    json(res, 202, { jobId: 'job-1' }, {
      'x-billable-requests': '4',
    });
  }, async (baseUrl) => {
    const c = client(baseUrl, { allowGenerate: true });

    const submitted = await c.getTranscript({
      url: 'u',
      mode: 'generate',
    });

    assert.equal(submitted.kind, 'job');
    assert.equal(submitted.jobId, 'job-1');
    assert.equal(submitted.billableCredits, 4);

    assert.equal((await c.getJob('job-1')).status, 'queued');

    const completed = await c.getJob('job-1');

    assert.equal(completed.status, 'completed');
    assert.equal(completed.content.length, 2);
  });
});

test('HTTP errors are mapped safely', async () => {
  await withStub((req, res) => {
    json(res, 401, {
      error: 'unauthorized',
      message: 'Invalid API key',
    });
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl).getTranscript({ url: 'u' }),
      (e) => e instanceof SupadataError
        && e.code === 'unauthorized'
        && !e.message.includes(API_KEY),
    );
  });
});

test('429 response preserves retry-after', async () => {
  await withStub((req, res) => {
    json(res, 429, { error: 'limit-exceeded' }, {
      'retry-after': '7',
    });
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl).getTranscript({ url: 'u' }),
      (e) => e.code === 'limit-exceeded'
        && e.retryAfterSec === 7,
    );
  });
});

test('invalid API key configuration is rejected', () => {
  assert.throws(
    () => createSupadataClient({ apiKey: ' ' }),
    /SUPADATA_API_KEY is required/,
  );
});

test('malformed transcript response is rejected', async () => {
  await withStub((req, res) => {
    json(res, 200, { lang: 'en' });
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl).getTranscript({ url: 'u' }),
      (e) => e.code === 'UNEXPECTED_RESPONSE',
    );
  });
});