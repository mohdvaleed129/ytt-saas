// Small git helper. Errors never include command output, so a secret can never leak through an error message.
import { execFileSync } from 'node:child_process';

export function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`git ${args[0]} failed (exit ${e.status ?? '?'})`);
  }
}

export function repoRoot(cwd) {
  const out = git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
  return out ? out.trim() : null;
}

/** Parsed `git status`: [{ x, y, path }]. Untracked files are listed individually. */
export function statusEntries(root) {
  const raw = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = raw.split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const x = p[0];
    const y = p[1];
    entries.push({ x, y, path: p.slice(3) });
    if (x === 'R' || x === 'C') i++; // rename/copy entries carry a second path
  }
  return entries;
}
