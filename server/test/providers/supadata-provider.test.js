import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupadataProvider } from '../../src/providers/transcription/supadata/supadata-provider.js';
import { ProviderError } from '../../src/providers/transcription/provider-contract.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

function fakeClient(result) {
  return {
    async getTranscript() {
      return result;
    },
    async getJob() {
      return result;
    },
  };
}

test('provider satisfies the transcription contract', () => {
  const provider = new SupadataProvider({
    client: fakeClient({ kind: 'unavailable', billableCredits: null }),
  });

  assert.equal(provider.name, 'supadata');
  assert.equal(provider.isConfigured(), true);
});

test('native transcript is normalized into milliseconds', async () => {
  const provider = new SupadataProvider({
    client: fakeClient({
      kind: 'transcript',
      lang: 'en',
      availableLangs: ['en', 'es'],
      billableCredits: 1,
      content: [
        { text: 'Hello', offset: 0, duration: 1200 },
        { text: 'world', offset: 1200, duration: 900 },
      ],
    }),
  });

  const result = await provider.fetchNative({ videoId: VIDEO_ID });

  assert.equal(result.status, 'completed');
  assert.equal(result.providerCredits, 1);
  assert.deepEqual(result.transcript, {
    lang: 'en',
    availableLangs: ['en', 'es'],
    segments: [
      { startMs: 0, endMs: 1200, text: 'Hello' },
      { startMs: 1200, endMs: 2100, text: 'world' },
    ],
  });
});

test('empty and invalid segments are safely discarded', async () => {
  const provider = new SupadataProvider({
    client: fakeClient({
      kind: 'transcript',
      lang: 'en',
      availableLangs: ['en'],
      billableCredits: null,
      content: [
        { text: '  Hello   world ', offset: 0, duration: 1000 },
        { text: ' ', offset: 1000, duration: 500 },
        { text: 'bad', offset: -1, duration: 500 },
        { text: 'bad', offset: 2000, duration: 0 },
      ],
    }),
  });

  const result = await provider.fetchNative({ videoId: VIDEO_ID });

  assert.deepEqual(result.transcript.segments, [
    { startMs: 0, endMs: 1000, text: 'Hello world' },
  ]);
});

test('missing captions return unavailable and preserve unknown cost', async () => {
  const provider = new SupadataProvider({
    client: fakeClient({
      kind: 'unavailable',
      billableCredits: null,
    }),
  });

  assert.deepEqual(await provider.fetchNative({ videoId: VIDEO_ID }), {
    status: 'unavailable',
    providerCredits: null,
  });
});

test('invalid video IDs are rejected before provider calls', async () => {
  let calls = 0;
  const provider = new SupadataProvider({
    client: {
      async getTranscript() {
        calls++;
      },
    },
  });

  await assert.rejects(
    provider.fetchNative({ videoId: 'invalid' }),
    (error) => error instanceof ProviderError && error.code === 'INVALID_VIDEO_ID',
  );

  assert.equal(calls, 0);
});

test('AI submission remains disabled', async () => {
  const provider = new SupadataProvider({
    client: fakeClient({}),
  });

  await assert.rejects(
    provider.submitAi({ videoId: VIDEO_ID }),
    (error) => error.code === 'AI_GENERATION_DISABLED',
  );
});

test('provider errors are mapped without exposing raw messages', async () => {
  const provider = new SupadataProvider({
    client: {
      async getTranscript() {
        const error = new Error('secret-key-must-not-appear');
        error.code = 'unauthorized';
        throw error;
      },
    },
  });

  await assert.rejects(
    provider.fetchNative({ videoId: VIDEO_ID }),
    (error) => error.code === 'PROVIDER_ERROR'
      && !error.message.includes('secret-key-must-not-appear'),
  );
});

test('completed async jobs are normalized', async () => {
  const provider = new SupadataProvider({
    client: fakeClient({
      status: 'completed',
      lang: 'hi',
      availableLangs: ['hi'],
      content: [{ text: 'Namaste', offset: 0, duration: 800 }],
    }),
  });

  const result = await provider.pollJob('job-1');

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.transcript.segments, [
    { startMs: 0, endMs: 800, text: 'Namaste' },
  ]);
});