// These tests need a REAL MongoDB. Set MONGODB_TEST_URI (for example mongodb://127.0.0.1:27017/ytt_test).
// They only read (ping); they write nothing. Without the variable they are skipped, unless
// REQUIRE_INTEGRATION=1 (set in CI), in which case a missing URI is a failure, never a silent skip.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDatabase, DatabaseError } from '../src/db/connection.js';
import { createRuntime } from '../src/runtime.js';
import { MockProvider } from '../src/providers/transcription/mock/mock-provider.js';
import { makeConfig, capturedLogger, fakeUriWithPassword, FAKE_PASSWORD } from '../test-support/fakes.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()().catch(() => {}); });

const URI = process.env.MONGODB_TEST_URI;
const it = URI ? {} : { skip: 'MONGODB_TEST_URI is not set' };

test('integration prerequisite: a database is available when REQUIRE_INTEGRATION=1', () => {
  if (process.env.REQUIRE_INTEGRATION === '1') assert.ok(URI, 'REQUIRE_INTEGRATION=1 but MONGODB_TEST_URI is not set');
});

test('connect, ping, close against a real MongoDB', it, async () => {
  const cap = capturedLogger();
  const db = createDatabase({ uri: URI, logger: cap.logger });
  cleanups.push(() => db.close());
  assert.equal(db.state(), 'disconnected');
  assert.deepEqual(await db.ping(), { ok: false }, 'ping before connect must fail safely, not throw');
  await db.connect();
  assert.equal(db.state(), 'connected');
  const p = await db.ping();
  assert.equal(p.ok, true);
  assert.equal(typeof p.latencyMs, 'number');
  await db.close();
  assert.equal(db.state(), 'disconnected');
  assert.deepEqual(await db.ping(), { ok: false });
  await db.close(); // idempotent
});

test('connection failure is fast, typed, and leaks no credentials into the error or the logs', async () => {
  const cap = capturedLogger();
  const db = createDatabase({ uri: fakeUriWithPassword(FAKE_PASSWORD, '127.0.0.1:1', 'x'), logger: cap.logger, serverSelectionTimeoutMs: 700 });
  const started = Date.now();
  await assert.rejects(db.connect(), (e) => {
    assert.ok(e instanceof DatabaseError);
    assert.match(e.message, /^Could not connect to MongoDB/);
    assert.ok(!e.message.includes(FAKE_PASSWORD) && !String(e.stack).includes(FAKE_PASSWORD));
    return true;
  });
  assert.ok(Date.now() - started < 6000, 'must fail fast');
  assert.ok(!cap.text().includes(FAKE_PASSWORD), 'password reached the logs');
  assert.ok(cap.text().includes('<redacted>@127.0.0.1:1/x'), 'redacted URI should still be logged for debugging');
  assert.equal(db.state(), 'disconnected');
});

function liveRuntime(extra = {}, routes) {
  const cap = capturedLogger();
  const config = makeConfig({ port: 0, host: '127.0.0.1', shutdownTimeoutMs: 3000, ...extra });
  const database = createDatabase({ uri: URI, logger: cap.logger });
  const runtime = createRuntime({ config, logger: cap.logger, database, provider: new MockProvider(), routes });
  cleanups.push(() => runtime.stop());
  return { runtime, database, cap };
}

test('full lifecycle: start, serve readiness from the real database, stop cleanly', it, async () => {
  const { runtime, database } = liveRuntime();
  const port = await runtime.start();
  const base = `http://127.0.0.1:${port}`;
  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status, 200);
  const body = await ready.json();
  assert.equal(body.status, 'ready');
  assert.equal(body.checks.database.status, 'ok');
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  await runtime.stop();
  assert.equal(database.state(), 'disconnected');
  await assert.rejects(fetch(`${base}/healthz`), 'server must stop accepting connections');
});

test('readiness turns 503 when the database goes away while the server keeps running', it, async () => {
  const { runtime, database } = liveRuntime();
  const port = await runtime.start();
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  await database.close(); // simulates losing the database
  const down = await fetch(`${base}/readyz`);
  assert.equal(down.status, 503);
  assert.equal((await down.json()).checks.database.status, 'fail');
  assert.equal((await fetch(`${base}/healthz`)).status, 200, 'liveness must stay green');
  await runtime.stop();
});

test('graceful stop lets an in-flight request finish before closing', it, async () => {
  const { runtime } = liveRuntime({}, (app) => app.get('/slow', async (req, res) => { await sleep(400); res.json({ done: true }); }));
  const port = await runtime.start();
  const base = `http://127.0.0.1:${port}`;
  const inFlight = fetch(`${base}/slow`);
  await sleep(100);
  const t0 = Date.now();
  const stopping = runtime.stop();
  const res = await inFlight;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { done: true });
  await stopping;
  assert.ok(Date.now() - t0 < 1500, `shutdown should end when the last request ends, not at the 3000 ms timeout (took ${Date.now() - t0} ms)`);
  await assert.rejects(fetch(`${base}/healthz`));
});
