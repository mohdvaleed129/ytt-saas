// Pure transcript helpers: display formatting, search, and TXT / SRT export.
// A segment is { startMs: number, endMs: number, text: string }.

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 83000 -> "01:23"; 3723000 -> "1:02:03" */
export function formatTimestamp(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 3723456 -> "01:02:03,456" (SRT time format) */
export function toSrtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

/** Normalizes line endings and surrounding whitespace; keeps single line breaks inside a cue. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Sound labels such as [Music], [♪♪♪], (applause), [संगीत]. */
export function isNonSpeech(text) {
  return /^\s*[[(（【][^\])）】]*[\])）】]\s*$/.test(String(text ?? ''));
}

export function totalDurationMs(segments) {
  return segments.reduce((max, s) => Math.max(max, s.endMs, s.startMs), 0);
}

/** Cues in time order with empty text removed; the originals are never modified. */
function prepared(segments) {
  return segments
    .map((s) => ({ ...s, text: cleanText(s.text) }))
    .filter((s) => s.text)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Valid SRT: sequence numbers from 1, "HH:MM:SS,mmm --> HH:MM:SS,mmm", cue text, blank line between cues.
 * trimOverlaps (default true): a cue never runs past the start of the next one. Providers often give
 * each caption a display window that overlaps the next caption; most players then show two cues at once.
 * Original timing is untouched in the stored transcript; only the exported file is adjusted.
 */
export function buildSrt(segments, { trimOverlaps = true, includeSoundLabels = true } = {}) {
  const cues = prepared(segments).filter((s) => includeSoundLabels || !isNonSpeech(s.text));
  return (
    cues
      .map((cue, i) => {
        const next = cues[i + 1];
        let end = cue.endMs;
        if (trimOverlaps && next && next.startMs > cue.startMs && end > next.startMs) end = next.startMs;
        if (!(end > cue.startMs)) end = cue.startMs + (next && next.startMs > cue.startMs ? Math.min(1000, next.startMs - cue.startMs) : 1000);
        return `${i + 1}\n${toSrtTime(cue.startMs)} --> ${toSrtTime(end)}\n${cue.text}\n`;
      })
      .join('\n')
  );
}

/** One segment per line, optionally prefixed with [mm:ss]. Line breaks inside a cue become spaces. */
export function buildTxt(segments, { timestamps = false, includeSoundLabels = true } = {}) {
  return (
    prepared(segments)
      .filter((s) => includeSoundLabels || !isNonSpeech(s.text))
      .map((s) => {
        const line = s.text.replace(/\n/g, ' ');
        return timestamps ? `[${formatTimestamp(s.startMs)}] ${line}` : line;
      })
      .join('\n') + '\n'
  );
}

export function exportFilename({ videoId, lang, ext }) {
  const safe = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return `transcript-${safe(videoId) || 'video'}-${safe(lang) || 'auto'}.${ext}`;
}

/** Case-insensitive match ranges of `query` in `text` (empty query matches nothing). */
export function findMatches(text, query) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}
