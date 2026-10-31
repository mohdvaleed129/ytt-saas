// Pure transcript helpers: normalization, quality analysis, TXT/SRT output.
// Input shape matches Supadata's documented chunk: { text, offset(ms), duration(ms), lang }.

const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i;

export function normalizeSegments(content) {
  if (!Array.isArray(content)) {
    throw new TypeError('Transcript content must be an array of segments.');
  }
  const out = [];
  content.forEach((seg, i) => {
    if (!seg || typeof seg.text !== 'string' || !Number.isFinite(seg.offset) || seg.offset < 0) {
      throw new TypeError(`Malformed transcript segment at index ${i}.`);
    }
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const duration = Number.isFinite(seg.duration) && seg.duration > 0 ? seg.duration : 0;
    out.push({
      startMs: Math.round(seg.offset),
      endMs: Math.round(seg.offset + duration),
      text,
      lang: typeof seg.lang === 'string' ? seg.lang : null,
    });
  });
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/** Quality statistics on RAW provider output, used to verify assumptions about real data. */
export function analyzeSegments(raw, durationSec = null) {
  const stats = {
    segmentCount: raw.length,
    emptyText: 0,
    zeroDuration: 0,
    outOfOrder: 0,
    overlaps: 0,
    withHtmlEntities: 0,
    chunkLangs: [],
    lastEndSec: 0,
    coverage: null,
  };
  const langs = new Set();
  let prevStart = -Infinity;
  let prevEnd = -Infinity;
  let lastEnd = 0;
  for (const s of raw) {
    if (!s.text || !String(s.text).trim()) stats.emptyText++;
    if (!(s.duration > 0)) stats.zeroDuration++;
    if (s.offset < prevStart) stats.outOfOrder++;
    if (s.offset < prevEnd) stats.overlaps++;
    if (ENTITY.test(s.text ?? '')) stats.withHtmlEntities++;
    if (s.lang) langs.add(s.lang);
    prevStart = s.offset;
    prevEnd = s.offset + (s.duration > 0 ? s.duration : 0);
    lastEnd = Math.max(lastEnd, prevEnd);
  }
  stats.chunkLangs = [...langs];
  stats.lastEndSec = Math.round(lastEnd / 1000);
  if (durationSec && durationSec > 0) stats.coverage = +(lastEnd / 1000 / durationSec).toFixed(2);
  return stats;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 83000 -> "01:23"; 3723000 -> "1:02:03" */
export function formatTimestamp(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 3723456 -> "01:02:03,456" */
export function toSrtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

export function toSrt(segments) {
  return segments
    .map((seg, i) => {
      const end = seg.endMs > seg.startMs ? seg.endMs : seg.startMs + 1000;
      return `${i + 1}\n${toSrtTime(seg.startMs)} --> ${toSrtTime(end)}\n${seg.text}\n`;
    })
    .join('\n');
}

export function toTxt(segments, { timestamps = false } = {}) {
  return segments
    .map((seg) => (timestamps ? `[${formatTimestamp(seg.startMs)}] ${seg.text}` : seg.text))
    .join('\n');
}
