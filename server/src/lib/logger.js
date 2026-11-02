// Structured JSON logging (pino). Secrets are removed in two layers:
//   1. `redact` censors well-known sensitive field names wherever they appear in a log object;
//   2. the `err` serializer scrubs credentials out of error messages and stacks (for example a
//      MongoDB URI inside a driver error).
import pino from 'pino';
import { safeError } from './redact.js';

export const REDACT_PATHS = [
  'password', 'token', 'secret', 'apiKey', 'api_key', 'authorization', 'cookie',
  '*.password', '*.token', '*.secret', '*.apiKey', '*.api_key', '*.authorization', '*.cookie',
  'req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie',
  'headers["set-cookie"]',
];

/**
 * @param {{level?: string, env?: string}} [opts]
 * @param {import('node:stream').Writable} [destination] defaults to stdout; tests pass a capture stream
 */
export function createLogger({ level = 'info', env = 'development' } = {}, destination) {
  return pino(
    {
      level,
      base: { service: 'ytt-server', env },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { err: safeError },
    },
    destination,
  );
}
