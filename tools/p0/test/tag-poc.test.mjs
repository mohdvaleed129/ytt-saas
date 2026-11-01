import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTag } from '../tag-poc.mjs';
import { makeRepo, write, sh, fakeSupadataKey } from '../test-support/repo.mjs';

const base = { skipGitleaks: true, skipTests: true };
const failed = (r) => r.checks.filter((c) => c.status === 'FAIL').map((c) => c.name);
const hash = (root) => sh(root, ['rev-parse', 'HEAD']).trim();
const tags = (root) => sh(root, ['tag', '--list']).trim();

/** A repo whose only uncommitted change is the keyed .env.example, like the real situation. */
function readyRepo() {
  const ctx = makeRepo();
  return ctx;
}

test('dry run passes with the env example tolerated and creates no tag', () => {
  const { root } = readyRepo();
  const r = evaluateTag({ cwd: root, commit: 'HEAD', allowEnvExampleModified: true, ...base });
  assert.equal(r.exitCode, 0, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /Dry run: nothing was created/);
  assert.equal(tags(root), '');
});

test('refuses when the env example is modified and the exception flag is absent', () => {
  const { root } = readyRepo();
  const r = evaluateTag({ cwd: root, ...base });
  assert.equal(r.exitCode, 1);
  assert.ok(failed(r).includes('Working tree is clean'));
});

test('refuses unexpected uncommitted or untracked files', () => {
  const { root } = readyRepo();
  write(root, 'poc/src/new.js', 'x\n');
  write(root, 'poc/src/a.js', 'changed\n');
  const r = evaluateTag({ cwd: root, allowEnvExampleModified: true, ...base });
  assert.equal(r.exitCode, 1);
  const detail = r.checks.find((c) => c.name === 'Working tree is clean').detail;
  assert.match(detail, /poc\/src\/new\.js/);
  assert.match(detail, /poc\/src\/a\.js/);
});

test('refuses when the keyed env example is STAGED', () => {
  const { root } = readyRepo();
  sh(root, ['add', 'poc/.env.example']);
  const r = evaluateTag({ cwd: root, allowEnvExampleModified: true, ...base });
  assert.equal(r.exitCode, 1);
  assert.ok(failed(r).includes('Working tree is clean'));
});

test('refuses when the tag already exists', () => {
  const { root } = readyRepo();
  sh(root, ['tag', 'poc-complete']);
  const r = evaluateTag({ cwd: root, allowEnvExampleModified: true, ...base });
  assert.equal(r.exitCode, 1);
  assert.ok(failed(r).includes('Tag poc-complete does not exist locally'));
});

test('refuses when a secret is in any commit of history', () => {
  const { root } = makeRepo({ withKeys: false });
  write(root, 'poc/src/oops.js', `const k = "${fakeSupadataKey()}";\n`);
  sh(root, ['add', '-A']);
  sh(root, ['commit', '-q', '-m', 'oops']);
  write(root, 'poc/src/oops.js', 'const k = process.env.K;\n');   // "fixed" later, still in history
  sh(root, ['add', '-A']);
  sh(root, ['commit', '-q', '-m', 'fix']);
  const r = evaluateTag({ cwd: root, ...base });
  assert.equal(r.exitCode, 1);
  const detail = r.checks.find((c) => c.name.startsWith('Built-in secret scan')).detail;
  assert.match(detail, /oops\.js \[supadata-api-key\]/);
  assert.ok(!r.lines.join('\n').includes(fakeSupadataKey()));
});

test('refuses when poc/ changed after the commit being tagged', () => {
  const { root } = makeRepo({ withKeys: false });
  const first = hash(root);
  write(root, 'poc/src/a.js', 'export const a = 99;\n');
  sh(root, ['commit', '-q', '-am', 'later']);
  const r = evaluateTag({ cwd: root, commit: first, ...base });
  assert.equal(r.exitCode, 1);
  assert.ok(failed(r).includes('poc/ at that commit is identical to poc/ at HEAD'));
});

test('--apply creates an annotated tag on the requested commit, and a second apply is refused', () => {
  const { root } = readyRepo();
  const h = hash(root);
  const r = evaluateTag({ cwd: root, commit: h, apply: true, allowEnvExampleModified: true, ...base });
  assert.equal(r.exitCode, 0, r.lines.join('\n'));
  assert.equal(tags(root), 'poc-complete');
  assert.equal(sh(root, ['cat-file', '-t', 'refs/tags/poc-complete']).trim(), 'tag');
  assert.equal(sh(root, ['rev-parse', 'poc-complete^{commit}']).trim(), h);
  assert.match(r.lines.join('\n'), /NOT pushed|was NOT pushed/);
  const again = evaluateTag({ cwd: root, commit: h, apply: true, allowEnvExampleModified: true, ...base });
  assert.equal(again.exitCode, 1);
  assert.equal(tags(root), 'poc-complete');
});

test('runs the PoC tests with key variables removed, and fails if they fail', () => {
  process.env.SUPADATA_API_KEY = 'must-not-reach-the-tests';
  try {
    const ok = makeRepo({ withKeys: false });
    write(ok.root, 'poc/test/env.test.js',
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('no key in env', () => assert.equal(process.env.SUPADATA_API_KEY, undefined));\n");
    sh(ok.root, ['add', '-A']); sh(ok.root, ['commit', '-q', '-m', 't']);
    const r = evaluateTag({ cwd: ok.root, skipGitleaks: true });
    assert.equal(r.exitCode, 0, r.lines.join('\n'));
    assert.match(r.checks.find((c) => c.name.startsWith('PoC tests')).detail, /2 pass, 0 fail/);

    const bad = makeRepo({ withKeys: false });
    write(bad.root, 'poc/test/bad.test.js',
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fails', () => assert.equal(1, 2));\n");
    sh(bad.root, ['add', '-A']); sh(bad.root, ['commit', '-q', '-m', 't']);
    const r2 = evaluateTag({ cwd: bad.root, skipGitleaks: true });
    assert.equal(r2.exitCode, 1);
  } finally {
    delete process.env.SUPADATA_API_KEY;
  }
});

test('a missing gitleaks binary fails closed unless explicitly skipped', () => {
  const { root } = makeRepo({ withKeys: false });
  const r = evaluateTag({ cwd: root, skipTests: true, gitleaksBin: 'definitely-not-installed-gitleaks' });
  assert.equal(r.exitCode, 1);
  assert.ok(failed(r).includes('gitleaks history scan'));
});
