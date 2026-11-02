// Builds the Express application from explicit dependencies (no globals), so tests can inject fakes.
import express from 'express';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { securityMiddleware, rateLimiter } from './middleware/security.js';
import { notFoundHandler, errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './modules/health/health.routes.js';

/**
 * @param {{config: object, logger: import('pino').Logger,
 *          database: {ping: Function}, provider: {name: string, isConfigured: Function},
 *          routes?: (app: import('express').Express) => void}} deps
 *   `routes` lets later phases (and tests) mount feature routers before the 404 and error handlers.
 */
export function createApp({ config, logger, database, provider, routes }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(securityMiddleware(config));
  app.use(rateLimiter(config));
  app.use(express.json({ limit: `${config.bodyLimitKb}kb`, strict: true }));

  app.use(healthRouter({ database, provider }));
  routes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
