// Shared test helpers. Secret-looking values are ASSEMBLED AT RUNTIME so no secret-shaped literal
// appears in the source tree (keeps gitleaks quiet and proves the redaction works on realistic shapes).
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';

export const fakeToken = () => ['sd', '_', 'Zz9fake', '0123456789', 'ABCDEFabcdef'].join('');
export const fakeGoogleKey = () => ['AI', 'za', 'Qq7', 'fake0123456789', 'ABCDEFGHIJKLMNOPQRST'].join('');
export const fakeUriWithPassword = (pw, host = '127.0.0.1:1', db = 'x') => ['mongodb', '://', 'appuser', ':', pw, '@', host, '/', db].join('');
export const FAKE_PASSWORD = ['Pw', '-', 'Never', 'Log', 'Me', '-', '7391'].join('');

export const TEST_URI = 'mongodb://127.0.0.1:27017/ytt_test';

export function capturedLogger(level = 'debug') {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) lines.push(l);
      cb();
    },
  });
  return {
    logger: createLogger({ level, env: 'test' }, stream),
    lines: () => lines,
    objects: () => lines.map((l) => JSON.parse(l)),
    text: () => lines.join('\n'),
  };
}

/** A real, validated config with test overrides applied on top (spread copies the frozen object). */
export function makeConfig(overrides = {}, env = {}) {
  return { ...loadConfig({ MONGODB_URI: TEST_URI, ...env }), ...overrides };
}

export function fakeDatabase({ ok = true } = {}) {
  const db = {
    ok,
    pings: 0,
    async ping() {
      db.pings += 1;
      return db.ok ? { ok: true, latencyMs: 1 } : { ok: false };
    },
    async connect() {},
    async close() {},
  };
  return db;
}

export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
