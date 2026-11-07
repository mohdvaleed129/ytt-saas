import { assertTranscriptProvider } from './provider-contract.js';
import { MockProvider } from './mock/mock-provider.js';
import { SupadataProvider } from './supadata/supadata-provider.js';

export function createTranscriptionProvider(config) {
  switch (config.transcriptionProvider) {
    case 'mock':
      return assertTranscriptProvider(new MockProvider());

    case 'supadata':
      return assertTranscriptProvider(
        new SupadataProvider({
          apiKey: config.supadata?.apiKey,
          baseUrl: config.supadata?.baseUrl,
          timeoutMs: config.supadata?.timeoutMs,
          allowGenerate: config.supadata?.allowGenerate ?? false,
        })
      );

    default:
      throw new Error('Unknown transcription provider.');
  }
}
