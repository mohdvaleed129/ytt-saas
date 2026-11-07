import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider, MOCK_VIDEOS } from '../src/providers/transcription/mock/mock-provider.js';
import { ProviderError, assertTranscriptProvider } from '../src/providers/transcription/provider-contract.js';
import { createTranscriptionProvider } from '../src/providers/transcription/registry.js';
import { makeConfig } from '../test-support/fakes.js';

const rejectsProvider = (p, code) => assert.rejects(p, (e) => e instanceof ProviderError && e.code === code);

test('mock satisfies the provider contract and the contract check rejects incomplete providers', () => {
  assert.doesNotThrow(() => assertTranscriptProvider(new MockProvider()));
  assert.throws(() => assertTranscriptProvider({ name: 'x', fetchNative() {} }), /missing: .*isConfigured.*submitAi.*pollJob/);
  assert.throws(() => assertTranscriptProvider(null), TypeError);
});

test('the mock never touches the network', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network call attempted'); });
  const p = new MockProvider();
  await p.fetchNative({ videoId: 'mockNative1' });
  await p.submitAi({ videoId: 'mockAiVideo' });
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('native success returns a normalized transcript and a 1 credit cost', async () => {
  const r = await new MockProvider().fetchNative({ videoId: 'mockNative1' });
  assert.equal(r.status, 'completed');
  assert.equal(r.providerCredits, 1);
  assert.equal(r.transcript.lang, 'en');
  assert.deepEqual(r.transcript.availableLangs, ['en', 'es']);
  for (const s of r.transcript.segments) {
    assert.deepEqual(Object.keys(s).sort(), ['endMs', 'startMs', 'text']);
    assert.ok(s.endMs > s.startMs && s.text);
  }
});

test('language selection: requested track, or fallback to the default when unavailable', async () => {
  const p = new MockProvider();
  assert.equal((await p.fetchNative({ videoId: 'mockNative1', lang: 'es' })).transcript.lang, 'es');
  assert.equal((await p.fetchNative({ videoId: 'mockNative1', lang: 'hi' })).transcript.lang, 'en');
});

test('videos without captions are "unavailable" with an UNKNOWN (null) cost, not zero', async () => {
  const r = await new MockProvider().fetchNative({ videoId: 'mockNoCaps1' });
  assert.deepEqual(r, { status: 'unavailable', providerCredits: null });
});

test('provider failures are ProviderError with a code and retry hints', async () => {
  const p = new MockProvider();
  await rejectsProvider(p.fetchNative({ videoId: 'doesNotExist' }), 'VIDEO_NOT_FOUND');
  await assert.rejects(p.fetchNative({ videoId: 'mockRateLim' }), (e) => e.code === 'PROVIDER_RATE_LIMITED' && e.retryable === true && e.retryAfterSec === 2);
  await rejectsProvider(p.submitAi({ videoId: 'mockNative1' }), 'PROVIDER_ERROR');
});

test('AI is asynchronous: cost at submission, then queued, processing, completed', async () => {
  const p = new MockProvider();
  const sub = await p.submitAi({ videoId: 'mockAiVideo' });
  assert.equal(sub.status, 'processing');
  assert.equal(sub.providerCredits, 22, '602 s = 11 started minutes x 2 credits (matches the PoC observation)');
  assert.deepEqual((await p.pollJob(sub.providerJobId)).status, 'queued');
  assert.deepEqual((await p.pollJob(sub.providerJobId)).status, 'processing');
  const done = await p.pollJob(sub.providerJobId);
  assert.equal(done.status, 'completed');
  assert.equal(done.transcript.lang, 'hi');
  assert.ok(done.transcript.segments.length > 0);
});

test('AI failure path and unknown jobs', async () => {
  const p = new MockProvider();
  const { providerJobId } = await p.submitAi({ videoId: 'mockFailJob' });
  await p.pollJob(providerJobId); await p.pollJob(providerJobId);
  assert.deepEqual(await p.pollJob(providerJobId), { status: 'failed', error: { code: 'PROVIDER_ERROR', retryable: false } });
  await rejectsProvider(p.pollJob('mock-job-999'), 'JOB_NOT_FOUND');
});

test('results are copies: mutating one cannot corrupt the fixtures', async () => {
  const p = new MockProvider();
  const a = await p.fetchNative({ videoId: 'mockNative1' });
  a.transcript.segments[0].text = 'MUTATED';
  const b = await p.fetchNative({ videoId: 'mockNative1' });
  assert.notEqual(b.transcript.segments[0].text, 'MUTATED');
  assert.ok(Object.isFrozen(MOCK_VIDEOS));
});

test('every call is recorded so tests can prove no unnecessary billable call happened', async () => {
  const p = new MockProvider();
  await p.fetchNative({ videoId: 'mockNative1', lang: 'es' });
  assert.deepEqual(p.calls, [{ op: 'fetchNative', videoId: 'mockNative1', lang: 'es' }]);
});

test('registry builds the provider named in the config', () => {
  assert.equal(createTranscriptionProvider(makeConfig()).name, 'mock');

  const supadataConfig = {
    ...makeConfig(),
    transcriptionProvider: 'supadata',
    supadata: {
      apiKey: 'test_supadata_key_1234567890123456',
      baseUrl: 'https://api.supadata.ai/v1',
      timeoutMs: 30000,
      allowGenerate: false,
    },
  };

  const provider = createTranscriptionProvider(supadataConfig);

  assert.equal(provider.name, 'supadata');
  assert.equal(provider.isConfigured(), true);

  assert.throws(
    () => createTranscriptionProvider({ transcriptionProvider: 'nope' }),
    /Unknown transcription provider/,
  );
});