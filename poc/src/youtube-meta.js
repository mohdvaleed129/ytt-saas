// Official YouTube Data API v3 metadata lookup (videos.list, 1 quota unit).
// Purpose in the PoC: know the duration BEFORE any AI-generation request so cost is bounded.

export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? '');
  if (!m) return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s);
}

export async function getVideoMeta({ videoId, apiKey, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for metadata lookup.');
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('id', videoId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let body = null;
  try {
    // Key is sent as a header so it can never leak through logged URLs.
    res = await fetchImpl(url, { headers: { 'x-goog-api-key': apiKey }, signal: controller.signal });
    body = await res.json().catch(() => null);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`YouTube Data API error ${res.status}: ${body?.error?.message ?? 'unknown error'}`);
  }

  const item = body?.items?.[0];
  if (!item) return { found: false };
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    found: true,
    title: item.snippet?.title ?? null,
    channelTitle: item.snippet?.channelTitle ?? null,
    durationSec: parseIsoDuration(item.contentDetails?.duration),
    isLiveOrUpcoming: (item.snippet?.liveBroadcastContent ?? 'none') !== 'none',
    defaultLanguage: item.snippet?.defaultLanguage ?? null,
    defaultAudioLanguage: item.snippet?.defaultAudioLanguage ?? null,
    thumbnailUrl: (thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null,
  };
}
