import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDuration, getVideoMeta } from '../src/youtube-meta.js';

test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('PT3M2S'), 182);
  assert.equal(parseIsoDuration('PT1H'), 3600);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('P1DT1H'), 90000);
  assert.equal(parseIsoDuration('P0D'), 0);
  assert.equal(parseIsoDuration('garbage'), null);
  assert.equal(parseIsoDuration(undefined), null);
});

// Fixtures follow the documented videos.list response shape. This tests our parsing only.
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

test('getVideoMeta maps a videos.list item and sends the key as a header, not in the URL', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), headers: init.headers };
    return okResponse({ items: [{
      snippet: { title: 'T', channelTitle: 'C', liveBroadcastContent: 'none', defaultAudioLanguage: 'hi',
        thumbnails: { default: { url: 'd' }, high: { url: 'h' } } },
      contentDetails: { duration: 'PT1M30S' },
    }] });
  };
  const meta = await getVideoMeta({ videoId: 'dQw4w9WgXcQ', apiKey: 'SECRET', fetchImpl });
  assert.equal(meta.found, true);
  assert.equal(meta.durationSec, 90);
  assert.equal(meta.isLiveOrUpcoming, false);
  assert.equal(meta.thumbnailUrl, 'h');
  assert.equal(meta.defaultAudioLanguage, 'hi');
  assert.ok(!seen.url.includes('SECRET'));
  assert.equal(seen.headers['x-goog-api-key'], 'SECRET');
});

test('getVideoMeta flags live streams, handles empty items and API errors', async () => {
  const live = await getVideoMeta({ videoId: 'x', apiKey: 'k', fetchImpl: async () =>
    okResponse({ items: [{ snippet: { liveBroadcastContent: 'live' }, contentDetails: { duration: 'P0D' } }] }) });
  assert.equal(live.isLiveOrUpcoming, true);

  const none = await getVideoMeta({ videoId: 'x', apiKey: 'k', fetchImpl: async () => okResponse({ items: [] }) });
  assert.deepEqual(none, { found: false });

  await assert.rejects(
    getVideoMeta({ videoId: 'x', apiKey: 'k', fetchImpl: async () =>
      ({ ok: false, status: 403, json: async () => ({ error: { message: 'quotaExceeded' } }) }) }),
    /403.*quotaExceeded/);
  await assert.rejects(getVideoMeta({ videoId: 'x', apiKey: '' }), /required/);
});
