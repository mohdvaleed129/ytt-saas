// Unit tests for the database layer using an INJECTED fake Mongoose (no server needed).
// They cover behaviours a real server cannot be made to produce on demand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, DatabaseError } from '../src/db/connection.js';
import { capturedLogger, fakeUriWithPassword, FAKE_PASSWORD } from '../test-support/fakes.js';

function fakeMongoose({ connectError, pingImpl } = {}) {
  const conn = {
    readyState: 1,
    pings: 0,
    closed: false,
    handlers: {},
    on(evt, fn) { this.handlers[evt] = fn; },
    async asPromise() { if (connectError) throw connectError; return this; },
    async close() { this.closed = true; this.readyState = 0; },
    db: { admin: () => ({ ping: async () => { conn.pings += 1; return pingImpl ? pingImpl() : { ok: 1 }; } }) },
  };
  return { conn, lib: { createConnection: () => conn } };
}

test('a driver error that contains credentials is scrubbed from the thrown error and the logs', async () => {
  const cap = capturedLogger();
  const leaky = new Error(`getaddrinfo failed for ${fakeUriWithPassword(FAKE_PASSWORD, 'db.example.net')}`);
  const { lib, conn } = fakeMongoose({ connectError: leaky });
  const db = createDatabase({ uri: fakeUriWithPassword(FAKE_PASSWORD, 'db.example.net'), logger: cap.logger, mongooseLib: lib });
  await assert.rejects(db.connect(), (e) => {
    assert.ok(e instanceof DatabaseError);
    assert.ok(!e.message.includes(FAKE_PASSWORD), 'password in error message');
    assert.ok(!String(e.stack).includes(FAKE_PASSWORD), 'password in stack');
    return true;
  });
  assert.ok(!cap.text().includes(FAKE_PASSWORD));
  assert.equal(conn.closed, true, 'a failed connection attempt must be closed, not leaked');
  assert.equal(db.state(), 'disconnected');
});

test('ping refuses to talk to the driver unless the connection is fully ready', async () => {
  const { lib, conn } = fakeMongoose();
  const db = createDatabase({ uri: 'mongodb://127.0.0.1:27017/x', logger: capturedLogger().logger, mongooseLib: lib });
  await db.connect();
  assert.equal((await db.ping()).ok, true);
  conn.readyState = 2; // connecting
  const before = conn.pings;
  assert.deepEqual(await db.ping(), { ok: false });
  assert.equal(conn.pings, before, 'must not ping a connection that is not ready');
});

test('ping reports failure instead of throwing when the driver errors or hangs', async () => {
  const failing = fakeMongoose({ pingImpl: () => { throw new Error('socket closed'); } });
  const a = createDatabase({ uri: 'mongodb://127.0.0.1:27017/x', logger: capturedLogger().logger, mongooseLib: failing.lib });
  await a.connect();
  assert.deepEqual(await a.ping(), { ok: false });

  const hanging = fakeMongoose({ pingImpl: () => new Promise(() => {}) });
  const b = createDatabase({ uri: 'mongodb://127.0.0.1:27017/x', logger: capturedLogger().logger, mongooseLib: hanging.lib });
  await b.connect();
  const started = Date.now();
  assert.deepEqual(await b.ping({ timeoutMs: 60 }), { ok: false });
  assert.ok(Date.now() - started < 1000, 'a hung database must not hang readiness');
});

test('driver events are logged without leaking details', async () => {
  const cap = capturedLogger();
  const { lib, conn } = fakeMongoose();
  const db = createDatabase({ uri: 'mongodb://127.0.0.1:27017/x', logger: cap.logger, mongooseLib: lib });
  await db.connect();
  conn.handlers.disconnected();
  conn.handlers.reconnected();
  conn.handlers.error(new Error(`boom ${fakeUriWithPassword(FAKE_PASSWORD)}`));
  const msgs = cap.objects().map((o) => o.msg);
  for (const m of ['database disconnected', 'database reconnected', 'database error']) assert.ok(msgs.includes(m), m);
  assert.ok(!cap.text().includes(FAKE_PASSWORD));
});

test('an intentional close is not reported as an unexpected disconnect', async () => {
  const cap = capturedLogger();
  const { lib, conn } = fakeMongoose();
  const db = createDatabase({ uri: 'mongodb://127.0.0.1:27017/x', logger: cap.logger, mongooseLib: lib });
  await db.connect();
  await db.close();
  conn.handlers.disconnected(); // the driver fires this during a deliberate close
  assert.ok(!cap.objects().some((o) => o.level === 'warn' && /disconnected/.test(o.msg)), 'deliberate close logged as a warning');
});
