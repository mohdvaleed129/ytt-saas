import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runPreflight } from '../preflight.mjs';
import { makeRepo, write, sh } from '../test-support/repo.mjs';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'p0-backup-'));

test('preflight never prints a secret value, backs up securely, and leaves the repo untouched', () => {
  const { root, keys } = makeRepo();
  write(root, 'poc/src/a.js', 'export const a = 2;\n');       // modified tracked file
  write(root, 'poc/src/new.js', 'export const n = 1;\n');      // untracked file
  const before = sh(root, ['status', '--porcelain']);
  const envBefore = sha(path.join(root, 'poc/.env.example'));
  const backupDir = path.join(tmp(), 'bk');

  const { lines, exitCode } = runPreflight({ cwd: root, backupDir });
  const out = lines.join('\n');

  assert.equal(exitCode, 0, out);
  for (const v of Object.values(keys)) {
    assert.ok(!out.includes(v), 'full key leaked');
    assert.ok(!out.includes(v.slice(0, 12)), 'key prefix leaked');
    assert.ok(!out.includes(v.slice(-12)), 'key suffix leaked');
  }
  assert.match(out, /SUPADATA_API_KEY=<REDACTED len=\d+>/);
  assert.match(out, /SUPADATA_API_KEY: identical|SUPADATA_API_KEY: secret-like/);
  assert.match(out, /Integrity check .*PASS/);
  assert.match(out, /NOTHING IS APPLIED/);

  const files = readdirSync(backupDir);
  assert.equal(files.length, 1);
  const bak = path.join(backupDir, files[0]);
  assert.equal(sha(bak), envBefore, 'backup must equal the original');
  if (process.platform !== 'win32') {
    assert.equal(statSync(bak).mode & 0o777, 0o600);
    assert.equal(statSync(backupDir).mode & 0o777, 0o700);
  }

  assert.equal(sh(root, ['status', '--porcelain']), before, 'repository status changed');
  assert.equal(sha(path.join(root, 'poc/.env.example')), envBefore, '.env.example was modified');
});

test('plan stages the PoC changes but never poc/.env.example', () => {
  const { root } = makeRepo();
  write(root, 'poc/src/a.js', 'export const a = 3;\n');
  write(root, 'poc/src/new.js', 'x\n');
  const { lines } = runPreflight({ cwd: root, dryRun: true });
  const out = lines.join('\n');
  const addLine = lines.find((l) => l.trim().startsWith('git add "poc/'));
  assert.ok(addLine, out);
  assert.ok(addLine.includes('"poc/src/a.js"') && addLine.includes('"poc/src/new.js"'));
  assert.ok(!addLine.includes('.env.example'));
  assert.match(out, /git restore poc\/\.env\.example/);   // described, never executed
});

test('dry run writes nothing', () => {
  const { root } = makeRepo();
  const backupDir = path.join(tmp(), 'never');
  const { lines, exitCode } = runPreflight({ cwd: root, backupDir, dryRun: true });
  assert.equal(exitCode, 0);
  assert.ok(!existsSync(backupDir));
  assert.match(lines.join('\n'), /Would create:/);
});

test('refuses to put the backup inside the repository', () => {
  const { root } = makeRepo();
  const { lines, exitCode } = runPreflight({ cwd: root, backupDir: path.join(root, 'backup') });
  assert.equal(exitCode, 1);
  assert.match(lines.join('\n'), /REFUSED/);
  assert.ok(!existsSync(path.join(root, 'backup')));
});

test('warns when poc/.env is missing so a restore could lose the keys', () => {
  const { root } = makeRepo();
  rmSync(path.join(root, 'poc/.env'));
  const { lines } = runPreflight({ cwd: root, dryRun: true });
  assert.match(lines.join('\n'), /Do NOT restore until you have your own copy/);
});

test('reports an existing tag and a clean file without crashing', () => {
  const { root } = makeRepo({ withKeys: false });
  sh(root, ['tag', 'poc-complete']);
  const { lines, exitCode } = runPreflight({ cwd: root, dryRun: true });
  assert.equal(exitCode, 0);
  assert.match(lines.join('\n'), /already exists: YES/);
});
