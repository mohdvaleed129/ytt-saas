// Client-side YouTube link validation. This is a convenience (instant feedback, no wasted request);
// the server validates again and is the authority.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

const fail = (code, message) => ({ ok: false, code, message });

/**
 * @param {unknown} input
 * @returns {{ok: true, videoId: string, kind: 'video'|'short', canonicalUrl: string} | {ok: false, code: string, message: string}}
 */
export function parseYouTubeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return fail('EMPTY', 'Paste a YouTube link to continue.');
  const raw = input.trim();
  if (raw.length > 2048) return fail('INVALID_URL', 'That link is too long.');

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return fail('INVALID_URL', 'That does not look like a link.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    return fail('INVALID_URL', 'That link format is not supported.');
  }
  if (!HOSTS.has(url.hostname)) return fail('NOT_YOUTUBE', 'Only YouTube links are supported (youtube.com or youtu.be).');

  const parts = url.pathname.split('/').filter(Boolean);
  let id;
  let kind = 'video';
  if (url.hostname === 'youtu.be') {
    id = parts[0] ?? null;
  } else {
    switch (parts[0]) {
      case 'watch': id = url.searchParams.get('v'); break;
      case 'shorts': id = parts[1] ?? null; kind = 'short'; break;
      case 'embed': case 'live': case 'v': id = parts[1] ?? null; break;
      default:
        return fail('UNSUPPORTED_URL', 'Use a link to a single video or Short, not a channel or playlist.');
    }
  }
  if (!id || !VIDEO_ID.test(id)) return fail('INVALID_VIDEO_ID', 'Could not find a valid video ID in that link.');
  return { ok: true, videoId: id, kind, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
}

/** Link that opens the video at a given time (milliseconds). */
export function youtubeTimeUrl(videoId, ms = 0) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${seconds}s`;
}
