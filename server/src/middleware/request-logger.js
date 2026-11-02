// One structured log line per request. Logs the path WITHOUT the query string and never logs
// bodies, cookies or authorization headers, since any of them can carry credentials or personal data.
export function requestLogger(logger) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 10) / 10;
      const status = res.statusCode;
      const quiet = req.path === '/healthz' || req.path === '/readyz';
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : quiet ? 'debug' : 'info';
      logger[level]({ requestId: req.id, method: req.method, path: req.path, route: req.route?.path, status, durationMs }, 'request');
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        logger.warn({ requestId: req.id, method: req.method, path: req.path }, 'request aborted by client');
      }
    });
    next();
  };
}
