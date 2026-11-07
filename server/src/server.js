// Process entry point. Everything testable lives in other modules; this file only wires and handles signals.
import { loadConfig, ConfigError, describeConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createDatabase } from './db/connection.js';
import { createTranscriptionProvider } from './providers/transcription/registry.js';
import { createRuntime } from './runtime.js';
import { transcriptionRouter } from './modules/transcription/transcription-router.js';
let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.format());
    process.exit(1);
  }
  throw err;
}

const logger = createLogger({ level: config.logLevel, env: config.env });
logger.info({ config: describeConfig(config) }, 'starting');

const database = createDatabase({
  uri: config.mongo.uri,
  logger,
  serverSelectionTimeoutMs: config.mongo.serverSelectionTimeoutMs,
  autoIndex: !config.isProduction,
});
const provider = createTranscriptionProvider(config);
const runtime = createRuntime({
  config,
  logger,
  database,
  provider,
  routes: (app) => {
    app.use('/api/transcriptions', transcriptionRouter({ provider }));
  },
});

let stopping = false;
async function shutdown(reason, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  logger.info({ reason }, 'shutting down');
  try {
    await runtime.stop();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  shutdown('uncaughtException', 1);
});

try {
  await runtime.start();
} catch (err) {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
}
