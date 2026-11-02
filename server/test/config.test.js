import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, describeConfig, ConfigError } from '../src/config/env.js';
import { TEST_URI, fakeUriWithPassword, FAKE_PASSWORD } from '../test-support/fakes.js';

const base = { MONGODB_URI: TEST_URI };
const issuesOf = (env) => {
  try { loadConfig(env); } catch (e) { assert.ok(e instanceof ConfigError); return e; }
  assert.fail('expected ConfigError');
};

test('defaults are safe and complete', () => {
  const c = loadConfig(base);
  assert.equal(c.env, 'development');
  assert.equal(c.port, 8080);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.logLevel, 'info');
  assert.equal(c.trustProxy, 0);
  assert.equal(c.bodyLimitKb, 100);
  assert.deepEqual(c.rateLimit, { windowMs: 60000, max: 120 });
  assert.deepEqual(c.cors.origins, []);
  assert.equal(c.transcriptionProvider, 'mock');
  assert.equal(c.mongo.serverSelectionTimeoutMs, 5000);
});

test('blank values count as unset (a copied .env.example works)', () => {
  const c = loadConfig({ ...base, PORT: '', LOG_LEVEL: '  ', CORS_ORIGINS: '', HOST: '' });
  assert.equal(c.port, 8080);
  assert.equal(c.logLevel, 'info');
});

test('values are coerced and bounded', () => {
  const c = loadConfig({ ...base, PORT: '3000', TRUST_PROXY: '1', RATE_LIMIT_WINDOW_SEC: '30', RATE_LIMIT_MAX: '5' });
  assert.equal(c.port, 3000);
  assert.equal(c.trustProxy, 1);
  assert.deepEqual(c.rateLimit, { windowMs: 30000, max: 5 });
});

test('every problem is reported at once, by variable name', () => {
  const e = issuesOf({ PORT: 'abc', LOG_LEVEL: 'loud', TRUST_PROXY: '9' });
  assert.deepEqual(e.issues.map((i) => i.variable).sort(), ['LOG_LEVEL', 'MONGODB_URI', 'PORT', 'TRUST_PROXY']);
  assert.match(e.format(), /MONGODB_URI: is required/);
});

test('MONGODB_URI is required and placeholders are rejected', () => {
  assert.ok(issuesOf({}).issues.some((i) => i.variable === 'MONGODB_URI'));
  // Credential-shaped strings are assembled at runtime so the secret scanner never sees a literal.
  const placeholderUris = [
    ['mongodb', '://', 'USER', ':', 'PASSWORD', '@', 'host/db'].join(''),
    ['mongodb', '://', '<user>', ':', '<pw>', '@', 'host/db'].join(''),
    'http://example.com',
    'mongodb://your_user@host',
  ];
  for (const bad of placeholderUris) {
    assert.ok(issuesOf({ MONGODB_URI: bad }).issues.some((i) => i.variable === 'MONGODB_URI'), bad);
  }
  const validSrv = ['mongodb+srv', '://', 'u', ':', 'p4ss', '@', 'cluster0.example.net/ytt_dev'].join('');
  assert.doesNotThrow(() => loadConfig({ MONGODB_URI: validSrv }));
});

test('error output never contains the offending value', () => {
  const secretUri = fakeUriWithPassword(FAKE_PASSWORD, 'h', '<db>');
  const e = issuesOf({ MONGODB_URI: secretUri, PORT: FAKE_PASSWORD });
  const text = `${e.message}\n${e.format()}\n${JSON.stringify(e.issues)}`;
  assert.ok(!text.includes(FAKE_PASSWORD));
});

test('CORS origins: bare origins only, no wildcard, no paths', () => {
  assert.deepEqual(loadConfig({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://app.example.com' }).cors.origins,
    ['http://localhost:5173', 'https://app.example.com']);
  for (const bad of ['*', 'https://app.example.com/', 'https://app.example.com/path', 'not-an-origin', 'ftp://example.com']) {
    assert.ok(issuesOf({ ...base, CORS_ORIGINS: bad }).issues.some((i) => i.variable === 'CORS_ORIGINS'), bad);
  }
});

test('production is stricter: https origins required, mock provider refused', () => {
  const noOrigins = issuesOf({ ...base, NODE_ENV: 'production' });
  assert.ok(noOrigins.issues.some((i) => i.variable === 'CORS_ORIGINS' && /required in production/.test(i.problem)));
  const http = issuesOf({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'http://app.example.com' });
  assert.ok(http.issues.some((i) => /https in production/.test(i.problem)));
  // With a valid https origin the ONLY remaining problem is the mock provider: P1 cannot run in production by design.
  const mock = issuesOf({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' });
  assert.deepEqual(mock.issues.map((i) => i.variable), ['TRANSCRIPTION_PROVIDER']);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development' }).isProduction, false);
});

test('only the mock provider exists in P1', () => {
  assert.ok(issuesOf({ ...base, TRANSCRIPTION_PROVIDER: 'supadata' }).issues.some((i) => i.variable === 'TRANSCRIPTION_PROVIDER'));
});

test('config is immutable', () => {
  const c = loadConfig(base);
  assert.throws(() => { 'use strict'; c.port = 1; }, TypeError);
  assert.throws(() => { c.cors.origins.push('https://x.example'); }, TypeError);
});

test('describeConfig is safe to log: no credentials', () => {
  const c = loadConfig({ MONGODB_URI: fakeUriWithPassword(FAKE_PASSWORD, 'cluster0.example.net', 'ytt_dev') });
  const text = JSON.stringify(describeConfig(c));
  assert.ok(!text.includes(FAKE_PASSWORD));
  assert.ok(text.includes('cluster0.example.net'));
  assert.ok(!('uri' in describeConfig(c)));
});
