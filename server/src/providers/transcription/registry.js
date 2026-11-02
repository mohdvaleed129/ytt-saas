import { assertTranscriptProvider } from './provider-contract.js';
import { MockProvider } from './mock/mock-provider.js';

/** Chooses the provider from validated configuration. Real providers are added in a later phase. */
export function createTranscriptionProvider(config) {
  switch (config.transcriptionProvider) {
    case 'mock':
      return assertTranscriptProvider(new MockProvider());
    default:
      throw new Error('Unknown transcription provider.');
  }
}
