import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl } from '../src/youtube-url.js';

const ID = 'dQw4w9WgXcQ';

test('accepts standard watch URLs and variants', () => {
  const inputs = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `http://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `  https://www.youtube.com/watch?v=${ID}  `,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ];
  for (const input of inputs) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.videoId, ID, input);
    assert.equal(r.kind, 'video', input);
    assert.equal(r.canonicalUrl, `https://www.youtube.com/watch?v=${ID}`);
  }
});

test('recognizes Shorts', () => {
  for (const input of [
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://m.youtube.com/shorts/${ID}`,
  ]) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.kind, 'short');
    assert.equal(r.videoId, ID);
  }
});

test('accepts IDs containing - and _', () => {
  const r = parseYouTubeUrl('https://youtu.be/a-b_c-d_e-f');
  assert.equal(r.ok, true);
  assert.equal(r.videoId, 'a-b_c-d_e-f');
});

test('rejects non-YouTube and lookalike hosts', () => {
  for (const input of [
    `https://example.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evilyoutube.com/watch?v=${ID}`,
    `https://notyoutu.be/${ID}`,
    `https://www.youtube.com@evil.example/watch?v=${ID}`,
  ]) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, false, input);
    assert.ok(['NOT_YOUTUBE', 'INVALID_URL'].includes(r.code), `${input} -> ${r.code}`);
  }
});

test('rejects bad video IDs', () => {
  for (const input of [
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}extra`,
    'https://www.youtube.com/watch?v=bad!chars!!',
    'https://www.youtube.com/watch',
    'https://youtu.be/',
    'https://www.youtube.com/shorts/',
  ]) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.code, 'INVALID_VIDEO_ID', input);
  }
});

test('rejects playlists, channels and other non-video paths', () => {
  for (const input of [
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/',
  ]) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.code, 'UNSUPPORTED_URL', input);
  }
});

test('rejects garbage input safely', () => {
  for (const input of ['', '   ', 'not a url', null, undefined, 42, {}, 'ftp://youtube.com/watch?v=' + ID, 'javascript:alert(1)']) {
    const r = parseYouTubeUrl(input);
    assert.equal(r.ok, false, String(input));
    assert.ok(r.code && r.message);
  }
  assert.equal(parseYouTubeUrl('https://www.youtube.com/watch?v=' + 'a'.repeat(3000)).ok, false);
  assert.equal(parseYouTubeUrl('https://www.youtube.com:8080/watch?v=' + ID).ok, false);
});
