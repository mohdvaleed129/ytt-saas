import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyValue, parseEnv, redactLine, findSecretIds, secretValuesOf, assertNoLeak, lineDiff,
} from '../lib/secrets.mjs';
import { fakeSupadataKey, fakeGoogleKey } from '../test-support/repo.mjs';

test('classifyValue separates empty, placeholder, secret-like and other', () => {
  assert.equal(classifyValue(''), 'empty');
  assert.equal(classifyValue('   '), 'empty');
  assert.equal(classifyValue('your_api_key_here'), 'placeholder');
  assert.equal(classifyValue('<paste key>'), 'placeholder');
  assert.equal(classifyValue(fakeSupadataKey()), 'secret-like');
  assert.equal(classifyValue('"' + fakeGoogleKey() + '"'), 'secret-like');
  assert.equal(classifyValue('short'), 'other');
});

test('redactLine hides secret-like assignments and known key patterns', () => {
  const s = fakeSupadataKey();
  const g = fakeGoogleKey();
  assert.match(redactLine(`SUPADATA_API_KEY=${s}`), /^SUPADATA_API_KEY=<REDACTED len=\d+>$/);
  assert.ok(!redactLine(`# my key is ${s} ok`).includes(s));
  assert.ok(!redactLine(`curl -H "x: ${g}"`).includes(g));
  assert.equal(redactLine('SUPADATA_API_KEY='), 'SUPADATA_API_KEY=');
  assert.equal(redactLine('# plain comment'), '# plain comment');
});

test('findSecretIds reports rule ids, never values', () => {
  const ids = findSecretIds(`a ${fakeSupadataKey()} b ${fakeGoogleKey()}`);
  assert.deepEqual(ids.sort(), ['google-api-key', 'supadata-api-key']);
  assert.deepEqual(findSecretIds('nothing here'), []);
});

test('parseEnv ignores comments and reads assignments', () => {
  const rows = parseEnv('# c\nA=1\nexport B="two"\n\n').filter((r) => r.name);
  assert.deepEqual(rows.map((r) => [r.name, r.value]), [['A', '1'], ['B', 'two']]);
});

test('assertNoLeak throws when output contains a secret value', () => {
  const s = fakeSupadataKey();
  assert.throws(() => assertNoLeak(`oops ${s}`, [s]), /Nothing was printed/);
  assert.doesNotThrow(() => assertNoLeak('clean output', [s]));
  assert.deepEqual(secretValuesOf(`K=${s}\nE=\n`), [s]);
});

test('lineDiff marks removed and added lines', () => {
  const d = lineDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(d.filter((x) => x.t !== ' '), [{ t: '-', line: 'b' }, { t: '+', line: 'x' }]);
});
