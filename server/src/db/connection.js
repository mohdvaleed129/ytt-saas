// MongoDB connection (Mongoose). Uses a dedicated connection object instead of the global one, so
// tests can create isolated connections and models bind to an explicit connection later.
import mongoose from 'mongoose';
import { performance } from 'node:perf_hooks';
import { redactMongoUri, scrubSecrets } from '../lib/redact.js';

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export class DatabaseError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DatabaseError';
  }
}

/**
 * @param {{uri: string, logger: import('pino').Logger, serverSelectionTimeoutMs?: number,
 *          autoIndex?: boolean, mongooseLib?: typeof mongoose}} opts
 */
export function createDatabase({ uri, logger, serverSelectionTimeoutMs = 5000, autoIndex = false, mongooseLib = mongoose }) {
  let connection = null;
  let closing = false; // an intentional close must not be logged as an unexpected disconnect

  return {
    /** Fails fast: rejects if no server is reachable within serverSelectionTimeoutMs. */
    async connect() {
      closing = false;
      logger.info({ uri: redactMongoUri(uri) }, 'database connecting');
      const conn = mongooseLib.createConnection(uri, {
        serverSelectionTimeoutMS: serverSelectionTimeoutMs,
        maxPoolSize: 10,
        appName: 'ytt-server',
        autoIndex,
      });
      conn.on('disconnected', () => (closing ? logger.debug('database disconnected (closing)') : logger.warn('database disconnected')));
      conn.on('reconnected', () => logger.info('database reconnected'));
      conn.on('error', (err) => logger.error({ err }, 'database error'));
      try {
        await conn.asPromise();
      } catch (err) {
        await conn.close().catch(() => {});
        // The driver's message can contain the connection string; scrub it before it travels anywhere.
        throw new DatabaseError(`Could not connect to MongoDB: ${scrubSecrets(err?.message)}`);
      }
      connection = conn;
      logger.info({ uri: redactMongoUri(uri) }, 'database connected');
      return conn;
    },

    get connection() {
      return connection;
    },

    state() {
      return connection ? (READY_STATES[connection.readyState] ?? 'unknown') : 'disconnected';
    },

    /** Never throws: readiness checks must report failure, not crash. */
    async ping({ timeoutMs = 2000 } = {}) {
      if (!connection || connection.readyState !== 1) return { ok: false };
      const started = performance.now();
      let timer;
      try {
        await Promise.race([
          connection.db.admin().ping(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('ping timeout')), timeoutMs);
          }),
        ]);
        return { ok: true, latencyMs: Math.round(performance.now() - started) };
      } catch {
        return { ok: false };
      } finally {
        clearTimeout(timer);
      }
    },

    async close() {
      if (!connection) return;
      closing = true;
      const conn = connection;
      connection = null;
      await conn.close();
      logger.info('database closed');
    },
  };
}
