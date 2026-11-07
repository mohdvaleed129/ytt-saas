// Process lifecycle: start (database, then HTTP) and graceful stop (HTTP, then database).
import { createApp } from './app.js';

export function createRuntime({ config, logger, database, provider, routes }) {
  const app = createApp({ config, logger, database, provider, routes });
  let server = null;

  return {
    app,

    /** @returns {Promise<number>} the port actually bound (useful when PORT is 0 in tests) */
async start() {
  await database.connect();

  server = app.listen(config.port, config.host);

  await new Promise((resolve, reject) => {
    if (server.listening) {
      resolve();
      return;
    }

    server.once('listening', resolve);
    server.once('error', reject);
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs, 60_000);

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('HTTP server failed to bind to a TCP port');
  }

  const { port } = address;

  logger.info({ port, host: config.host }, 'listening');

  return port;
},

    /** Stops accepting connections, lets in-flight requests finish (up to the timeout), then closes the database. */
    async stop() {
      if (server) {
        const closing = new Promise((resolve) => server.close(resolve));
        // Connections that were busy when we started stopping become idle once their response is sent.
        // Sweep them so shutdown ends as soon as the last in-flight request finishes, not at the timeout.
        const sweep = setInterval(() => server.closeIdleConnections(), 50);
        const force = setTimeout(() => {
          logger.warn('shutdown timeout reached; closing remaining connections');
          server.closeAllConnections();
        }, config.shutdownTimeoutMs);
        await closing;
        clearInterval(sweep);
        clearTimeout(force);
        server = null;
      }
      await database.close();
    },
  };
}
