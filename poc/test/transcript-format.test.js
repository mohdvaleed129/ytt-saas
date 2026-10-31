import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSegments, analyzeSegments, formatTimestamp, toSrtTime, toSrt, toTxt,
} from '../src/transcript-format.js';

test('normalizeSegments trims, collapses whitespace, drops empties and sorts', () => {
  const out = normalizeSegments([
    { text: '  second \n line ', offset: 2000, duration: 1500, lang: 'en' },
    { text: 'first', offset: 0, duration: 1000, lang: 'en' },
    { text: '   ', offset: 5000, duration: 500 },
  ]);
  assert.deepEqual(out, [
    { startMs: 0, endMs: 1000, text: 'first', lang: 'en' },
    { startMs: 2000, endMs: 3500, text: 'second line', lang: 'en' },
  ]);
});

test('normalizeSegments rejects malformed input instead of guessing', () => {
  assert.throws(() => normalizeSegments('nope'), TypeError);
  assert.throws(() => normalizeSegments([{ text: 'x' }]), /index 0/);
  assert.throws(() => normalizeSegments([{ text: 'x', offset: -1 }]), /index 0/);
  assert.throws(() => normalizeSegments([null]), /index 0/);
});

test('formatTimestamp', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(83_000), '01:23');
  assert.equal(formatTimestamp(3_599_999), '59:59');
  assert.equal(formatTimestamp(3_723_000), '1:02:03');
  assert.equal(formatTimestamp(-5), '00:00');
});

test('toSrtTime', () => {
  assert.equal(toSrtTime(0), '00:00:00,000');
  assert.equal(toSrtTime(3_723_456), '01:02:03,456');
  assert.equal(toSrtTime(999), '00:00:00,999');
});

test('toSrt produces exact SRT, with a fallback end for zero-duration cues', () => {
  const srt = toSrt([
    { startMs: 0, endMs: 1500, text: 'Hello' },
    { startMs: 2000, endMs: 2000, text: 'World' },
  ]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:02,000 --> 00:00:03,000\nWorld\n');
});

test('toTxt with and without timestamps', () => {
  const segs = [{ startMs: 0, endMs: 1, text: 'a' }, { startMs: 61_000, endMs: 62_000, text: 'b' }];
  assert.equal(toTxt(segs), 'a\nb');
  assert.equal(toTxt(segs, { timestamps: true }), '[00:00] a\n[01:01] b');
});

test('analyzeSegments reports data-quality problems on raw provider output', () => {
  const stats = analyzeSegments([
    { text: 'Tom &amp; Jerry', offset: 0, duration: 2000, lang: 'en' },
    { text: 'overlap', offset: 1500, duration: 1000, lang: 'en' },
    { text: 'late', offset: 500, duration: 0, lang: 'hi' },
    { text: '', offset: 9000, duration: 1000 },
  ], 10);
  assert.equal(stats.segmentCount, 4);
  assert.equal(stats.withHtmlEntities, 1);
  assert.equal(stats.overlaps, 2);
  assert.equal(stats.outOfOrder, 1);
  assert.equal(stats.zeroDuration, 1);
  assert.equal(stats.emptyText, 1);
  assert.deepEqual(stats.chunkLangs.sort(), ['en', 'hi']);
  assert.equal(stats.lastEndSec, 10);
  assert.equal(stats.coverage, 1);
});
