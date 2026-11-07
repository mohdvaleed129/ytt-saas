import {
  ProviderError,
} from '../provider-contract.js';
import { createSupadataClient, SupadataError } from './supadata-client.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function normalizeTranscript(result) {
  const segments = result.content
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => {
      const startMs = Number(item.offset);
      const durationMs = Number(item.duration);

      return {
        startMs,
        endMs: startMs + durationMs,
        text: item.text.replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((s) =>
      Number.isFinite(s.startMs) &&
      Number.isFinite(s.endMs) &&
      s.startMs >= 0 &&
      s.endMs > s.startMs &&
      s.text.length > 0
    )
    .sort((a, b) => a.startMs - b.startMs);

  return {
    lang: result.lang ?? 'unknown',
    availableLangs: result.availableLangs ?? [],
    segments,
  };
}

function mapError(error) {
  if (error instanceof ProviderError) return error;

  if (error instanceof SupadataError) {
    const mapping = {
      'not-found': 'VIDEO_NOT_FOUND',
      'unauthorized': 'PROVIDER_AUTH_FAILED',
      'upgrade-required': 'PROVIDER_PAYMENT_REQUIRED',
      'forbidden': 'PROVIDER_FORBIDDEN',
      'limit-exceeded': 'PROVIDER_RATE_LIMITED',
      'TIMEOUT': 'PROVIDER_TIMEOUT',
      'NETWORK_ERROR': 'PROVIDER_UNAVAILABLE',
      'UNEXPECTED_RESPONSE': 'PROVIDER_INVALID_RESPONSE',
      'AI_GENERATION_DISABLED': 'AI_GENERATION_DISABLED',
    };

    const code = mapping[error.code] ?? 'PROVIDER_ERROR';

    return new ProviderError(code, 'Transcription provider request failed.', {
      retryable: [
        'PROVIDER_RATE_LIMITED',
        'PROVIDER_TIMEOUT',
        'PROVIDER_UNAVAILABLE',
      ].includes(code),
      retryAfterSec: error.retryAfterSec,
    });
  }

  return new ProviderError(
    'PROVIDER_ERROR',
    'Transcription provider request failed.'
  );
}

export class SupadataProvider {
  constructor({ apiKey, baseUrl, timeoutMs = 30000, allowGenerate = false, client } = {}) {
    this.name = 'supadata';
    this.client = client ?? (
      apiKey
        ? createSupadataClient({
            apiKey,
            baseUrl,
            timeoutMs,
            allowGenerate,
          })
        : null
    );
  }

  isConfigured() {
    return Boolean(this.client);
  }

  validateVideoId(videoId) {
    if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) {
      throw new ProviderError(
        'INVALID_VIDEO_ID',
        'A valid YouTube video ID is required.'
      );
    }
  }

  async fetchNative({ videoId, lang } = {}) {
    try {
      this.validateVideoId(videoId);

      if (!this.client) {
        throw new ProviderError(
          'PROVIDER_NOT_CONFIGURED',
          'Transcription provider is not configured.'
        );
      }

      const result = await this.client.getTranscript({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        lang,
        mode: 'native',
      });

      if (result.kind === 'unavailable') {
        return {
          status: 'unavailable',
          providerCredits: result.billableCredits,
        };
      }

      if (result.kind !== 'transcript') {
        throw new ProviderError(
          'PROVIDER_INVALID_RESPONSE',
          'Unexpected provider response.'
        );
      }

      return {
        status: 'completed',
        transcript: normalizeTranscript(result),
        providerCredits: result.billableCredits,
      };
    } catch (error) {
      throw mapError(error);
    }
  }

  async submitAi() {
    throw new ProviderError(
      'AI_GENERATION_DISABLED',
      'AI transcription is not enabled.'
    );
  }

  async pollJob(providerJobId) {
    try {
      if (!this.client) {
        throw new ProviderError(
          'PROVIDER_NOT_CONFIGURED',
          'Transcription provider is not configured.'
        );
      }

      const result = await this.client.getJob(providerJobId);

      if (result.status === 'completed') {
        return {
          status: 'completed',
          transcript: normalizeTranscript(result),
        };
      }

      if (result.status === 'failed') {
        return {
          status: 'failed',
          error: {
            code: 'PROVIDER_ERROR',
            retryable: false,
          },
        };
      }

      return {
        status: result.status === 'queued' ? 'queued' : 'processing',
      };
    } catch (error) {
      throw mapError(error);
    }
  }
}
