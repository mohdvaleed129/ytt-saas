// Security middleware: helmet headers, a strict CORS allowlist, and rate limiting.
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';

export function securityMiddleware(config) {
  const allowed = new Set(config.cors.origins);
  return [
    helmet(),
    cors({
      // Requests without an Origin header (curl, server-to-server) are not browser cross-origin calls; they get no CORS headers.
      origin: (origin, callback) => callback(null, Boolean(origin) && allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'idempotency-key', 'x-request-id'],
      exposedHeaders: ['x-request-id', 'retry-after'],
      maxAge: 600,
    }),
  ];
}

/** In-memory counters: correct for a single API instance. Scaling out needs a shared store (documented in the architecture). */
export function rateLimiter(config) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/healthz' || req.path === '/readyz',
    handler: (req, res, next) =>
      next(new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.')),
  });
}
