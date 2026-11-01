// Test helpers: build throwaway git repositories and FAKE secrets. Fake secrets are assembled at
// runtime so no secret-shaped literal ever appears in the source tree (and gitleaks stays quiet).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const fakeSupadataKey = () => ['sd', '_', 'ZZfake', '0123456789', 'ABCDEFabcdef'].join('');
export const fakeGoogleKey = () => ['AI', 'za', 'FAKE', 'fake0123456789', 'ABCDEFGHIJKLMNOPQR'].join('');

export function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function write(root, rel, content) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Repo that mirrors the real situation: committed placeholder .env.example, later modified with keys. */
export function makeRepo({ withKeys = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'p0-repo-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.name', 'Test']);
  sh(root, ['config', 'user.email', 'test@example.invalid']);
  write(root, '.gitignore', '.env\nresults/\n');
  write(root, 'poc/.env.example', '# Supadata\nSUPADATA_API_KEY=\n# YouTube\nYOUTUBE_API_KEY=\n');
  write(root, 'poc/src/a.js', 'export const a = 1;\n');
  write(root, 'poc/test/a.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(1, 1));\n");
  write(root, 'poc/package.json', '{"name":"x","type":"module"}\n');
  sh(root, ['add', '-A']);
  sh(root, ['commit', '-q', '-m', 'base']);
  const keys = { supadata: fakeSupadataKey(), google: fakeGoogleKey() };
  if (withKeys) {
    const body = `# Supadata\nSUPADATA_API_KEY=${keys.supadata}\n# YouTube\nYOUTUBE_API_KEY=${keys.google}\n`;
    write(root, 'poc/.env.example', body);
    write(root, 'poc/.env', body);
  }
  return { root, keys };
}
