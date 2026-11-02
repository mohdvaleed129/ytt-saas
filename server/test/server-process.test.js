// Process-level tests: run the real entry point (src/server.js) as a child process.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeUriWithPassword, FAKE_PASSWORD } from '../test-support/fakes.js';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');
const URI = process.env.MONGODB_TEST_URI;

const children = [];
afterEach(() => { for (const c of children.splice(0)) c.kill('SIGKILL'); });

function run(env, { signalAfterListening = false } = {}) {
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  let err = '';
  const listening = new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      out += d;
      if (signalAfterListening && out.includes('"msg":"listening"')) resolve();
    });
  });
  child.stderr.on('data', (d) => { err += d; });
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal, out, err }));
  return { child, listening, exited };
}

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('invalid configuration: exits 1, names the variables, never prints their values', async () => {
  const { exited } = run({ PORT: FAKE_PASSWORD, LOG_LEVEL: 'loud' });
  const r = await exited;
  assert.equal(r.code, 1);
  assert.match(r.err, /MONGODB_URI/);
  assert.match(r.err, /PORT/);
  assert.match(r.err, /LOG_LEVEL/);
  assert.ok(!r.err.includes(FAKE_PASSWORD) && !r.out.includes(FAKE_PASSWORD));
  assert.equal(r.out, '', 'nothing may be logged before configuration is valid');
});

test('production with the mock provider is refused at startup (P1 cannot be deployed by accident)', async () => {
  const r = await run({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1:27017/x', CORS_ORIGINS: 'https://app.example.com' }).exited;
  assert.equal(r.code, 1);
  assert.match(r.err, /TRANSCRIPTION_PROVIDER: the mock provider cannot run in production/);
});

test('unreachable database: fails fast with exit 1 and no credentials in the output', async () => {
  const r = await run({ MONGODB_URI: fakeUriWithPassword(FAKE_PASSWORD, '127.0.0.1:1', 'x'), MONGODB_SERVER_SELECTION_TIMEOUT_MS: '600', PORT: String(await freePort()) }).exited;
  assert.equal(r.code, 1);
  assert.match(r.out, /"msg":"startup failed"/);
  assert.ok(!r.out.includes(FAKE_PASSWORD) && !r.err.includes(FAKE_PASSWORD));
  for (const line of r.out.split('\n').filter(Boolean)) JSON.parse(line); // every log line is valid JSON
});

const needsDb = URI ? {} : { skip: 'MONGODB_TEST_URI is not set' };
const live = !URI ? needsDb : process.platform === 'win32' ? { skip: 'POSIX signal semantics (SIGTERM is a hard kill on Windows)' } : {};

test('real process: starts, serves /readyz, shuts down gracefully on SIGTERM (exit 0)', live, async () => {
  const port = await freePort();
  const { child, listening, exited } = run({ MONGODB_URI: URI, PORT: String(port), LOG_LEVEL: 'info' }, { signalAfterListening: true });
  await listening;
  const res = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).checks.database.status, 'ok');
  child.kill('SIGTERM');
  const r = await exited;
  assert.equal(r.code, 0);
  const lines = r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const msgs = lines.map((l) => l.msg);
  for (const m of ['starting', 'database connected', 'listening', 'shutting down', 'database closed']) assert.ok(msgs.includes(m), `missing log line: ${m}`);
  assert.ok(lines.every((l) => l.service === 'ytt-server' && l.level && l.time));
  assert.equal(lines.find((l) => l.msg === 'starting').config.mongo.startsWith('mongodb://'), true);
});

test('real MongoDB rejecting wrong credentials: exit 1 and the password appears nowhere', needsDb, async () => {
  const u = new URL(URI);
  u.username = 'appuser';
  u.password = FAKE_PASSWORD;
  const r = await run({ MONGODB_URI: u.toString(), MONGODB_SERVER_SELECTION_TIMEOUT_MS: '1500', PORT: String(await freePort()) }).exited;
  assert.equal(r.code, 1);
  assert.match(r.out, /"msg":"startup failed"/);
  assert.ok(!r.out.includes(FAKE_PASSWORD) && !r.err.includes(FAKE_PASSWORD));
  assert.match(r.out, /"uri":"mongodb:\/\/<redacted>@[^"]+"/, 'the redacted URI should still be logged for debugging');
});
