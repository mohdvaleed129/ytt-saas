import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, redactMongoUri, safeError } from '../src/lib/redact.js';
import { capturedLogger, fakeToken, fakeGoogleKey, fakeUriWithPassword, FAKE_PASSWORD } from '../test-support/fakes.js';

test('scrubSecrets removes URI credentials, provider keys and bearer tokens', () => {
  const s = `fail ${fakeUriWithPassword(FAKE_PASSWORD)} key=${fakeToken()} g=${fakeGoogleKey()} h=Bearer abcdefghijklmnop1234`;
  const out = scrubSecrets(s);
  for (const secret of [FAKE_PASSWORD, fakeToken(), fakeGoogleKey(), 'abcdefghijklmnop1234']) assert.ok(!out.includes(secret), secret);
  assert.match(out, /mongodb:\/\/<redacted>@127\.0\.0\.1:1\/x/);
});

test('redactMongoUri keeps hosts and database, drops credentials and query', () => {
  assert.equal(redactMongoUri(fakeUriWithPassword(FAKE_PASSWORD, 'a.example.net:27017,b.example.net:27017', 'db')),
    'mongodb://<redacted>@a.example.net:27017,b.example.net:27017/db');
  assert.equal(redactMongoUri('mongodb+srv://c.example.net/db?retryWrites=true&w=majority'), 'mongodb+srv://c.example.net/db');
  assert.equal(redactMongoUri('mongodb://127.0.0.1:27017'), 'mongodb://127.0.0.1:27017');
  assert.equal(redactMongoUri('nonsense'), '<invalid mongodb uri>');
});

test('safeError scrubs message and stack and keeps useful fields', () => {
  const err = new Error(`connect failed for ${fakeUriWithPassword(FAKE_PASSWORD)}`);
  err.code = 'ECONNREFUSED';
  const out = safeError(err);
  assert.equal(out.code, 'ECONNREFUSED');
  assert.ok(!JSON.stringify(out).includes(FAKE_PASSWORD));
  assert.deepEqual(safeError('plain'), { message: 'plain' });
});

test('logger emits structured JSON with service and ISO time', () => {
  const cap = capturedLogger();
  cap.logger.info({ a: 1 }, 'hello');
  const [o] = cap.objects();
  assert.equal(o.level, 'info');
  assert.equal(o.service, 'ytt-server');
  assert.equal(o.msg, 'hello');
  assert.match(o.time, /^\d{4}-\d\d-\d\dT/);
});

test('logger censors sensitive field names at any common depth', () => {
  const cap = capturedLogger();
  cap.logger.info({
    password: FAKE_PASSWORD, token: fakeToken(),
    user: { password: FAKE_PASSWORD, apiKey: fakeGoogleKey() },
    req: { headers: { authorization: 'Bearer abcdefghijklmnop1234', cookie: 'sid=abc123456789' } },
  }, 'x');
  const text = cap.text();
  for (const secret of [FAKE_PASSWORD, fakeToken(), fakeGoogleKey(), 'abcdefghijklmnop1234', 'abc123456789']) assert.ok(!text.includes(secret), secret);
  assert.match(text, /\[REDACTED\]/);
});

test('logger scrubs credentials from logged errors (message and stack)', () => {
  const cap = capturedLogger();
  cap.logger.error({ err: new Error(`bad ${fakeUriWithPassword(FAKE_PASSWORD)} ${fakeToken()}`) }, 'boom');
  const text = cap.text();
  assert.ok(!text.includes(FAKE_PASSWORD));
  assert.ok(!text.includes(fakeToken()));
  assert.equal(cap.objects()[0].err.name, 'Error');
});
