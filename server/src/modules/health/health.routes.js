// Liveness and readiness.
//   /healthz  -> the process is up (no dependencies are checked; an orchestrator restarts on failure).
//   /readyz   -> the process can serve traffic (database reachable, provider configured).
// Neither response includes error text, connection strings or versions of dependencies.
import { Router } from 'express';

export function healthRouter({ database, provider }) {
  const router = Router();

  router.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
  });

  router.get('/readyz', async (req, res) => {
    const db = await database.ping();
    const providerOk = provider.isConfigured();
    const ready = db.ok && providerOk;
    res
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({
        status: ready ? 'ready' : 'not_ready',
        checks: {
          database: db.ok ? { status: 'ok', latencyMs: db.latencyMs } : { status: 'fail' },
          transcriptionProvider: { status: providerOk ? 'ok' : 'fail', name: provider.name },
        },
        requestId: req.id,
      });
  });

  return router;
}
