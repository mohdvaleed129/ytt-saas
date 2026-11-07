import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl, youtubeTimeUrl } from './youtube.js';

const ID = 'dQw4w9WgXcQ';

test('accepts watch, youtu.be, embed, live and no-scheme links', () => {
  for (const input of [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s&list=PL1`, `http://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`, `www.youtube.com/watch?v=${ID}`, `  https://youtu.be/${ID}?si=x  `,
    `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}`,
  ]) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.videoId, ID);
    assert.equal(r.canonicalUrl, `https://www.youtube.com/watch?v=${ID}`);
  }
});

test('recognizes Shorts', () => {
  const r = parseYouTubeUrl(`https://www.youtube.com/shorts/${ID}?feature=share`);
  assert.deepEqual([r.ok, r.kind, r.videoId], [true, 'short', ID]);
});

test('rejects other sites, look-alike hosts, credentials, ports and non-http schemes', () => {
  for (const input of [
    `https://example.com/watch?v=${ID}`, `https://youtube.com.evil.example/watch?v=${ID}`, `https://evilyoutube.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8080/watch?v=${ID}`, `ftp://youtube.com/watch?v=${ID}`, 'javascript:alert(1)',
  ]) {
    assert.equal(parseYouTubeUrl(input).ok, false, input);
  }
  assert.equal(parseYouTubeUrl(`https://example.com/x`).code, 'NOT_YOUTUBE');
});

test('rejects bad IDs, channels, playlists and empty input with a clear code', () => {
  assert.equal(parseYouTubeUrl('').code, 'EMPTY');
  assert.equal(parseYouTubeUrl(null).code, 'EMPTY');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/watch?v=short').code, 'INVALID_VIDEO_ID');
  assert.equal(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}extra`).code, 'INVALID_VIDEO_ID');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1').code, 'UNSUPPORTED_URL');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/@channel').code, 'UNSUPPORTED_URL');
  assert.equal(parseYouTubeUrl('not a link').ok, false);
  assert.equal(parseYouTubeUrl(`https://www.youtube.com/watch?v=${'a'.repeat(3000)}`).ok, false);
});

test('youtubeTimeUrl builds a timestamped link', () => {
  assert.equal(youtubeTimeUrl(ID, 83_999), `https://www.youtube.com/watch?v=${ID}&t=83s`);
  assert.equal(youtubeTimeUrl(ID, -5), `https://www.youtube.com/watch?v=${ID}&t=0s`);
});
