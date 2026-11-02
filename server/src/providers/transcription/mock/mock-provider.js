// In-memory provider for development and tests. It makes NO network calls and uses NO credentials.
// Behaviours mirror what the real provider was observed to do in the PoC (results files):
//  - native success costs 1 credit; "unavailable" responses report an UNKNOWN cost (null);
//  - AI costs 2 credits per started minute, reported at submission;
//  - AI jobs are asynchronous: queued -> processing -> completed.
// Scenarios are selected by video ID, so tests are deterministic and need no timers.
import { ProviderError } from '../provider-contract.js';

const seg = (startMs, endMs, text) => ({ startMs, endMs, text });

const EN = [
  seg(0, 2400, 'Welcome to the mock video.'),
  seg(2400, 5200, 'This transcript is fixture data.'),
  seg(5200, 8000, 'It never leaves this process.'),
];
const ES = [
  seg(0, 2400, 'Bienvenido al video de prueba.'),
  seg(2400, 5200, 'Esta transcripción son datos de ejemplo.'),
];
const HI_AI = [
  seg(0, 3000, 'यह एक परीक्षण वीडियो है।'),
  seg(3000, 6500, 'यह केवल जाँच के लिए है।'),
];

export const MOCK_VIDEOS = Object.freeze({
  mockNative1: { durationSec: 214, native: { defaultLang: 'en', tracks: { en: EN, es: ES } } },
  mockNoCaps1: { durationSec: 224, native: null, ai: { lang: 'hi', segments: HI_AI } },
  mockAiVideo: { durationSec: 602, native: null, ai: { lang: 'hi', segments: HI_AI } },
  mockFailJob: { durationSec: 90, native: null, ai: { fail: true } },
  mockRateLim: { durationSec: 60, scenario: 'rate-limited' },
});

export class MockProvider {
  name = 'mock';
  /** Every call is recorded so tests can assert that no unnecessary (billable) call happened. */
  calls = [];
  #videos;
  #jobs = new Map();

  constructor({ videos = MOCK_VIDEOS } = {}) {
    this.#videos = videos;
  }

  isConfigured() {
    return true;
  }

  #video(videoId) {
    const v = this.#videos[videoId];
    if (!v) throw new ProviderError('VIDEO_NOT_FOUND', 'The provider has no such video.');
    if (v.scenario === 'rate-limited') {
      throw new ProviderError('PROVIDER_RATE_LIMITED', 'The provider asked us to slow down.', { retryable: true, retryAfterSec: 2 });
    }
    return v;
  }

  async fetchNative({ videoId, lang }) {
    this.calls.push({ op: 'fetchNative', videoId, lang: lang ?? null });
    const v = this.#video(videoId);
    if (!v.native) return { status: 'unavailable', providerCredits: null };
    const { tracks, defaultLang } = v.native;
    const chosen = lang && tracks[lang] ? lang : defaultLang; // unsupported language falls back, as the docs describe
    return {
      status: 'completed',
      transcript: { lang: chosen, availableLangs: Object.keys(tracks), segments: structuredClone(tracks[chosen]) },
      providerCredits: 1,
    };
  }

  async submitAi({ videoId, lang }) {
    this.calls.push({ op: 'submitAi', videoId, lang: lang ?? null });
    const v = this.#video(videoId);
    if (!v.ai) throw new ProviderError('PROVIDER_ERROR', 'AI transcription is not available for this video.');
    const providerJobId = `mock-job-${this.#jobs.size + 1}`;
    this.#jobs.set(providerJobId, { videoId, polls: 0 });
    return { status: 'processing', providerJobId, providerCredits: 2 * Math.ceil(v.durationSec / 60) };
  }

  async pollJob(providerJobId) {
    this.calls.push({ op: 'pollJob', providerJobId });
    const job = this.#jobs.get(providerJobId);
    if (!job) throw new ProviderError('JOB_NOT_FOUND', 'Unknown or expired job.');
    job.polls += 1;
    const ai = this.#videos[job.videoId].ai;
    if (job.polls === 1) return { status: 'queued' };
    if (job.polls === 2) return { status: 'processing' };
    if (ai.fail) return { status: 'failed', error: { code: 'PROVIDER_ERROR', retryable: false } };
    return {
      status: 'completed',
      transcript: { lang: ai.lang, availableLangs: [ai.lang], segments: structuredClone(ai.segments) },
    };
  }
}
