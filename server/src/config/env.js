// Environment configuration. Validated once at startup; the process refuses to boot on any problem.
//
// Rules:
//  - Error messages name the variable and the rule. They NEVER include the offending value,
//    because the value may be a secret (for example a MongoDB URI with a password).
//  - Empty strings count as "not set", so a copied .env.example with blank values behaves correctly.
//  - Production is stricter than development (https-only origins, no mock provider).

import { z } from 'zod';
import { redactMongoUri } from '../lib/redact.js';

export class ConfigError extends Error {
  /** @param {{variable: string, problem: string}[]} issues */
  constructor(issues) {
    super(`Invalid configuration: ${issues.map((i) => i.variable).join(', ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }

  format() {
    return ['Invalid configuration. Fix these environment variables and start again:']
      .concat(this.issues.map((i) => `  - ${i.variable}: ${i.problem}`))
      .join('\n');
  }
}

const int = (min, max) => z.coerce.number().int().min(min).max(max);

const FIELDS = {
  NODE_ENV: {
    schema: z.enum(['development', 'test', 'production']).default('development'),
    problem: 'must be one of: development, test, production',
  },
  PORT: { schema: int(1, 65535).default(8080), problem: 'must be an integer from 1 to 65535' },
  HOST: { schema: z.string().min(1).max(255).optional(), problem: 'must be a host name or IP address' },
  LOG_LEVEL: {
    schema: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    problem: 'must be one of: fatal, error, warn, info, debug, trace, silent',
  },
  MONGODB_URI: {
    schema: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\/\S+$/i)
      .refine((v) => !/[<>]|your[_-]|change[_-]?me|USER:PASSWORD/i.test(v)),
    problem: 'is required and must be a mongodb:// or mongodb+srv:// URI (placeholder values are rejected)',
  },
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: {
    schema: int(500, 60000).default(5000),
    problem: 'must be an integer from 500 to 60000',
  },
  CORS_ORIGINS: { schema: z.string().default(''), problem: 'must be a comma-separated list of origins' },
  TRUST_PROXY: { schema: int(0, 5).default(0), problem: 'must be an integer from 0 to 5 (number of proxy hops)' },
  BODY_LIMIT_KB: { schema: int(1, 1024).default(100), problem: 'must be an integer from 1 to 1024' },
  RATE_LIMIT_WINDOW_SEC: { schema: int(1, 3600).default(60), problem: 'must be an integer from 1 to 3600' },
  RATE_LIMIT_MAX: { schema: int(1, 100000).default(120), problem: 'must be an integer from 1 to 100000' },
  REQUEST_TIMEOUT_MS: { schema: int(1000, 600000).default(30000), problem: 'must be an integer from 1000 to 600000' },
  SHUTDOWN_TIMEOUT_MS: { schema: int(1000, 120000).default(10000), problem: 'must be an integer from 1000 to 120000' },
  TRANSCRIPTION_PROVIDER: {
    schema: z.enum(['mock']).default('mock'),
    problem: 'must be: mock (real providers arrive in a later phase)',
  },
};

function parseOrigins(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function originProblem(origin, production) {
  if (origin === '*') return 'wildcard origins are not allowed';
  let url;
  try {
    url = new URL(origin);
  } catch {
    return 'contains an entry that is not a valid origin (expected scheme://host[:port])';
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
    return 'each entry must be a bare origin such as https://app.example.com (no path, no trailing slash)';
  }
  if (production && url.protocol !== 'https:') return 'must use https in production';
  return null;
}

/** @param {Record<string, string | undefined>} [env] */
export function loadConfig(env = process.env) {
  const issues = [];
  const v = {};

  for (const [name, { schema, problem }] of Object.entries(FIELDS)) {
    const raw = env[name];
    const value = raw === undefined || String(raw).trim() === '' ? undefined : String(raw).trim();
    const result = schema.safeParse(value);
    if (result.success) v[name] = result.data;
    else issues.push({ variable: name, problem });
  }

  const production = v.NODE_ENV === 'production';
  const origins = v.CORS_ORIGINS === undefined ? [] : parseOrigins(v.CORS_ORIGINS);
  for (const origin of origins) {
    const problem = originProblem(origin, production);
    if (problem) {
      issues.push({ variable: 'CORS_ORIGINS', problem });
      break;
    }
  }
  if (production && origins.length === 0) {
    issues.push({ variable: 'CORS_ORIGINS', problem: 'is required in production' });
  }
  if (production && v.TRANSCRIPTION_PROVIDER === 'mock') {
    issues.push({ variable: 'TRANSCRIPTION_PROVIDER', problem: 'the mock provider cannot run in production' });
  }

  if (issues.length) throw new ConfigError(issues);

  return Object.freeze({
    env: v.NODE_ENV,
    isProduction: production,
    port: v.PORT,
    host: v.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    logLevel: v.LOG_LEVEL,
    mongo: Object.freeze({ uri: v.MONGODB_URI, serverSelectionTimeoutMs: v.MONGODB_SERVER_SELECTION_TIMEOUT_MS }),
    cors: Object.freeze({ origins: Object.freeze(origins) }),
    trustProxy: v.TRUST_PROXY,
    bodyLimitKb: v.BODY_LIMIT_KB,
    rateLimit: Object.freeze({ windowMs: v.RATE_LIMIT_WINDOW_SEC * 1000, max: v.RATE_LIMIT_MAX }),
    requestTimeoutMs: v.REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs: v.SHUTDOWN_TIMEOUT_MS,
    transcriptionProvider: v.TRANSCRIPTION_PROVIDER,
  });
}

/** A copy of the configuration that is safe to write to logs (no credentials). */
export function describeConfig(config) {
  return {
    env: config.env,
    host: config.host,
    port: config.port,
    logLevel: config.logLevel,
    mongo: redactMongoUri(config.mongo.uri),
    corsOrigins: config.cors.origins,
    trustProxy: config.trustProxy,
    bodyLimitKb: config.bodyLimitKb,
    rateLimit: config.rateLimit,
    transcriptionProvider: config.transcriptionProvider,
  };
}
