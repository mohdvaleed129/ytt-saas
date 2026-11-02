// The contract every transcription provider must satisfy. Business logic depends on THIS shape only;
// provider-specific field names (for example Supadata's `offset`/`duration`) never leave the adapter.
//
// Normalized transcript:   { lang: string, availableLangs: string[], segments: Segment[] }
// Segment:                 { startMs: number, endMs: number, text: string }
//
//   fetchNative({ videoId, lang? })
//     -> { status: 'completed', transcript, providerCredits: number|null }
//      | { status: 'unavailable', providerCredits: number|null }      (no captions exist)
//     throws ProviderError for failures (not found, rate limited, provider down, ...)
//   submitAi({ videoId, lang? })
//     -> { status: 'processing', providerJobId: string, providerCredits: number|null }
//   pollJob(providerJobId)
//     -> { status: 'queued' | 'processing' }
//      | { status: 'completed', transcript }
//      | { status: 'failed', error: { code: string, retryable: boolean } }
//
// `providerCredits: null` means "the provider did not tell us", which is different from 0.

export class ProviderError extends Error {
  /** @param {string} code @param {string} message @param {{retryable?: boolean, retryAfterSec?: number}} [opts] */
  constructor(code, message, { retryable = false, retryAfterSec = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSec = retryAfterSec;
  }
}

const REQUIRED = ['isConfigured', 'fetchNative', 'submitAi', 'pollJob'];

export function assertTranscriptProvider(provider) {
  const missing = [];
  if (!provider || typeof provider.name !== 'string' || !provider.name) missing.push('name');
  for (const m of REQUIRED) if (typeof provider?.[m] !== 'function') missing.push(m);
  if (missing.length) throw new TypeError(`Transcription provider is missing: ${missing.join(', ')}`);
  return provider;
}
