import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimestamp, toSrtTime, cleanText, isNonSpeech, buildSrt, buildTxt, exportFilename, findMatches, totalDurationMs,
} from './transcript-format.js';

const seg = (startMs, endMs, text) => ({ startMs, endMs, text });

/** Parses SRT the way a strict player would, and returns the cues. Throws on any structural problem. */
function parseSrt(srt) {
  assert.ok(srt.endsWith('\n'), 'file must end with a newline');
  const blocks = srt.trimEnd().split(/\n\n/);
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    assert.equal(lines[0], String(i + 1), `cue ${i + 1}: sequence number`);
    const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(lines[1]);
    assert.ok(m, `cue ${i + 1}: timing line "${lines[1]}"`);
    const ms = (h, mi, s, f) => ((Number(h) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + Number(f);
    const start = ms(...m.slice(1, 5));
    const end = ms(...m.slice(5, 9));
    assert.ok(end > start, `cue ${i + 1}: end must be after start`);
    const text = lines.slice(2).join('\n');
    assert.ok(text.length > 0 && !/\n\s*\n/.test(text), `cue ${i + 1}: non-empty text without blank lines`);
    return { start, end, text };
  });
}

test('timestamp formats', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(83_000), '01:23');
  assert.equal(formatTimestamp(3_723_000), '1:02:03');
  assert.equal(formatTimestamp(-5), '00:00');
  assert.equal(toSrtTime(3_723_456), '01:02:03,456');
  assert.equal(toSrtTime(999), '00:00:00,999');
});

test('cleanText and non-speech detection (Latin and Devanagari labels)', () => {
  assert.equal(cleanText('  a \r\n\n  b   c '), 'a\nb c');
  for (const t of ['[Music]', '[♪♪♪]', '(applause)', '[संगीत]', '  [Laughter]  ']) assert.equal(isNonSpeech(t), true, t);
  for (const t of ['Hello [Music] there', 'plain', '']) assert.equal(isNonSpeech(t), false, t);
});

test('SRT is structurally valid and numbered from 1', () => {
  const cues = parseSrt(buildSrt([seg(0, 2000, 'Hello'), seg(2000, 4500, 'World\nsecond line'), seg(5000, 6000, 'नमस्ते दुनिया')]));
  assert.equal(cues.length, 3);
  assert.equal(cues[1].text, 'World\nsecond line');
  assert.equal(cues[2].text, 'नमस्ते दुनिया');
});

test('SRT drops empty cues, sorts by time and renumbers', () => {
  const cues = parseSrt(buildSrt([seg(4000, 5000, 'second'), seg(1000, 2000, '   '), seg(0, 1000, 'first')]));
  assert.deepEqual(cues.map((c) => c.text), ['first', 'second']);
});

test('SRT trims overlapping cue ends by default, and keeps provider timing when asked', () => {
  const overlapping = [seg(0, 3000, 'one'), seg(1500, 4500, 'two'), seg(3000, 6000, 'three')];
  const trimmed = parseSrt(buildSrt(overlapping));
  assert.deepEqual(trimmed.map((c) => [c.start, c.end]), [[0, 1500], [1500, 3000], [3000, 6000]]);
  for (let i = 0; i < trimmed.length - 1; i++) assert.ok(trimmed[i].end <= trimmed[i + 1].start, 'no cue overlaps the next');
  const raw = parseSrt(buildSrt(overlapping, { trimOverlaps: false }));
  assert.deepEqual(raw.map((c) => [c.start, c.end]), [[0, 3000], [1500, 4500], [3000, 6000]]);
});

test('SRT gives zero-duration cues a valid end time and never produces end <= start', () => {
  const cues = parseSrt(buildSrt([seg(0, 0, 'a'), seg(500, 400, 'b'), seg(5000, 5000, 'c')]));
  cues.forEach((c) => assert.ok(c.end > c.start));
  assert.ok(cues[0].end <= 500, 'a short gap to the next cue limits the fallback end');
});

test('exporting never modifies the stored transcript', () => {
  const original = [seg(0, 3000, ' one '), seg(1500, 4500, 'two')];
  const copy = JSON.parse(JSON.stringify(original));
  buildSrt(original); buildTxt(original, { timestamps: true });
  assert.deepEqual(original, copy);
});

test('TXT: one segment per line, optional timestamps, optional sound labels', () => {
  const s = [seg(0, 1000, '[Music]'), seg(61_000, 62_000, 'Hello\nworld')];
  assert.equal(buildTxt(s), '[Music]\nHello world\n');
  assert.equal(buildTxt(s, { timestamps: true }), '[00:00] [Music]\n[01:01] Hello world\n');
  assert.equal(buildTxt(s, { includeSoundLabels: false }), 'Hello world\n');
  assert.equal(buildSrt(s, { includeSoundLabels: false }).includes('[Music]'), false);
});

test('filenames are safe and descriptive', () => {
  assert.equal(exportFilename({ videoId: 'dQw4w9WgXcQ', lang: 'hi', ext: 'srt' }), 'transcript-dQw4w9WgXcQ-hi.srt');
  assert.equal(exportFilename({ videoId: '../../x', lang: null, ext: 'txt' }), 'transcript-x-auto.txt');
});

test('findMatches: case-insensitive, regex-safe, works for Devanagari', () => {
  assert.deepEqual(findMatches('Hello hello HELLO', 'hello'), [[0, 5], [6, 11], [12, 17]]);
  assert.deepEqual(findMatches('a.b a.b', 'a.b'), [[0, 3], [4, 7]]);
  assert.deepEqual(findMatches('a+b', '(+'), []);
  assert.deepEqual(findMatches('यह एक परीक्षण है', 'एक'), [[3, 5]]);
  assert.deepEqual(findMatches('anything', '  '), []);
});

test('totalDurationMs', () => {
  assert.equal(totalDurationMs([seg(0, 1000, 'a'), seg(5000, 4000, 'b')]), 5000);
  assert.equal(totalDurationMs([]), 0);
});
