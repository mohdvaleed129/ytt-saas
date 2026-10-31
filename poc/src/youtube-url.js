// Strict YouTube URL parsing. No network access. Allow-list based.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const MAX_INPUT_LENGTH = 2048;

const fail = (code, message) => ({ ok: false, code, message });

/**
 * @param {unknown} input
 * @returns {{ok:true, videoId:string, kind:'video'|'short', canonicalUrl:string}
 *          | {ok:false, code:string, message:string}}
 */
export function parseYouTubeUrl(input) {
  if (typeof input !== 'string') return fail('INVALID_URL', 'Enter a YouTube URL.');
  const raw = input.trim();
  if (!raw) return fail('INVALID_URL', 'Enter a YouTube URL.');
  if (raw.length > MAX_INPUT_LENGTH) return fail('INVALID_URL', 'That URL is too long.');

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return fail('INVALID_URL', 'That does not look like a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('INVALID_URL', 'Only http(s) links are supported.');
  }
  if (url.username || url.password || url.port) {
    return fail('INVALID_URL', 'That URL format is not supported.');
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return fail('NOT_YOUTUBE', 'Only YouTube video and Shorts links are supported.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  let id = null;
  let kind = 'video';

  if (url.hostname === 'youtu.be') {
    id = segments[0] ?? null;
  } else {
    switch (segments[0]) {
      case 'watch':
        id = url.searchParams.get('v');
        break;
      case 'shorts':
        id = segments[1] ?? null;
        kind = 'short';
        break;
      case 'embed':
      case 'live':
      case 'v':
        id = segments[1] ?? null;
        break;
      default:
        return fail(
          'UNSUPPORTED_URL',
          'Only single video or Shorts links are supported (not channels or playlists).'
        );
    }
  }

  if (!id || !VIDEO_ID.test(id)) {
    return fail('INVALID_VIDEO_ID', 'Could not find a valid video ID in that URL.');
  }

  return { ok: true, videoId: id, kind, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
}
