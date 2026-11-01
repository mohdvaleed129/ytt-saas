#!/usr/bin/env node
// Creates the annotated tag `poc-complete`, but only after every safety check passes.
//
//   node tools/p0/tag-poc.mjs --commit <hash> [--allow-env-example-modified]            (dry run, default)
//   node tools/p0/tag-poc.mjs --commit <hash> [--allow-env-example-modified] --apply    (creates the tag)
//
// Other flags: --gitleaks <path>  --skip-gitleaks  --skip-tests
// It never pushes, never modifies files, and never prints a secret value.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, repoRoot, statusEntries } from './lib/git.mjs';
import { findSecretIds, redactLine } from './lib/secrets.mjs';

const TAG = 'poc-complete';
const ENV_EXAMPLE = 'poc/.env.example';

function scanHistory(root) {
  const seen = new Map();
  for (const line of git(root, ['rev-list', '--objects', '--all']).split('\n')) {
    const [sha, ...rest] = line.split(' ');
    if (sha && rest.length) seen.set(sha, rest.join(' '));
  }
  const hits = [];
  for (const [sha, p] of seen) {
    if ((git(root, ['cat-file', '-t', sha], { allowFail: true }) ?? '').trim() !== 'blob') continue;
    if (Number(git(root, ['cat-file', '-s', sha])) > 2_000_000) continue;
    const ids = findSecretIds(git(root, ['cat-file', '-p', sha]));
    if (ids.length) hits.push({ path: p, ids });
  }
  return { scanned: seen.size, hits };
}

function strippedEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // set when this script itself runs under `node --test`; it would hide the child's summary
  for (const k of Object.keys(env)) if (/SUPADATA|YOUTUBE|OPENAI|RAZORPAY|MONGO|API_KEY|SECRET|TOKEN/i.test(k)) delete env[k];
  return env;
}

export function evaluateTag({
  cwd = process.cwd(), commit = 'HEAD', apply = false, allowEnvExampleModified = false,
  gitleaksBin = 'gitleaks', skipGitleaks = false, skipTests = false,
} = {}) {
  const checks = [];
  const add = (name, status, detail = '') => checks.push({ name, status, detail });
  const root = repoRoot(cwd);
  if (!root) return { checks: [{ name: 'Inside a git repository', status: 'FAIL', detail: '' }], exitCode: 2, lines: ['Not inside a git repository.'] };
  add('Inside a git repository', 'PASS', root);

  // identity (needed for an annotated tag); values are not printed
  const hasId = Boolean((git(root, ['config', 'user.name'], { allowFail: true }) ?? '').trim()
    && (git(root, ['config', 'user.email'], { allowFail: true }) ?? '').trim());
  add('git user.name and user.email configured', hasId ? 'PASS' : 'FAIL', hasId ? '' : 'needed for an annotated tag');

  // tag must not exist (local + remote best effort)
  const localExists = git(root, ['rev-parse', '-q', '--verify', `refs/tags/${TAG}`], { allowFail: true }) !== null;
  add(`Tag ${TAG} does not exist locally`, localExists ? 'FAIL' : 'PASS');
  const remotes = (git(root, ['remote']) ?? '').split('\n').filter(Boolean);
  if (!remotes.length) {
    add(`Tag ${TAG} does not exist on a remote`, 'INFO', 'no remote configured; only the local check applies');
  } else {
    for (const r of remotes) {
      const res = spawnSync('git', ['ls-remote', '--tags', r, `refs/tags/${TAG}`], { cwd: root, encoding: 'utf8', timeout: 20000 });
      if (res.error || res.status !== 0) add(`Tag ${TAG} does not exist on remote "${r}"`, 'WARN', 'remote unreachable; checked locally only');
      else add(`Tag ${TAG} does not exist on remote "${r}"`, res.stdout.trim() ? 'FAIL' : 'PASS');
    }
  }

  // commit to tag
  const full = (git(root, ['rev-parse', '--verify', `${commit}^{commit}`], { allowFail: true }) ?? '').trim();
  if (!full) {
    add(`Commit "${commit}" exists`, 'FAIL');
  } else {
    add(`Commit "${commit}" exists`, 'PASS', full.slice(0, 12));
    const anc = git(root, ['merge-base', '--is-ancestor', full, 'HEAD'], { allowFail: true }) !== null;
    add('Commit is an ancestor of HEAD', anc ? 'PASS' : 'FAIL');
    const same = git(root, ['diff', '--quiet', full, 'HEAD', '--', 'poc/'], { allowFail: true }) !== null;
    add('poc/ at that commit is identical to poc/ at HEAD', same ? 'PASS' : 'FAIL', same ? '' : 'poc/ changed after the commit you want to tag');
  }

  // working tree
  const bad = [];
  let tolerated = false;
  for (const e of statusEntries(root)) {
    if (allowEnvExampleModified && e.path === ENV_EXAMPLE && e.x === ' ' && e.y === 'M') { tolerated = true; continue; }
    bad.push(`${e.x}${e.y} ${e.path}`);
  }
  add('Working tree is clean', bad.length ? 'FAIL' : 'PASS',
    bad.length ? `unexpected changes: ${bad.join('; ')}` : tolerated ? `except ${ENV_EXAMPLE} (unstaged, explicitly allowed)` : '');

  // secrets
  const hist = scanHistory(root);
  add('Built-in secret scan of all commits', hist.hits.length ? 'FAIL' : 'PASS',
    hist.hits.length ? hist.hits.map((h) => `${h.path} [${h.ids.join(',')}]`).join('; ') : `${hist.scanned} objects scanned`);
  if (skipGitleaks) {
    add('gitleaks history scan', 'WARN', 'skipped by flag');
  } else {
    const cfg = path.join(root, '.gitleaks.toml');
    const res = spawnSync(gitleaksBin, ['git', ...(existsSync(cfg) ? ['--config', cfg] : []), '--redact', '--no-banner', root],
      { cwd: root, encoding: 'utf8', timeout: 120000 });
    if (res.error) add('gitleaks history scan', 'FAIL', `gitleaks not runnable (${res.error.code ?? 'error'}); install it or use --skip-gitleaks`);
    else add('gitleaks history scan', res.status === 0 ? 'PASS' : 'FAIL', res.status === 0 ? 'no leaks found' : 'leaks reported; run gitleaks manually to see them');
  }

  // PoC tests, with every key-like environment variable removed so no API call can happen
  let testCount = null;
  if (skipTests) {
    add('PoC tests (keys removed from the environment)', 'WARN', 'skipped by flag');
  } else {
    const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], {
      cwd: path.join(root, 'poc'), env: strippedEnv(), encoding: 'utf8', timeout: 180000,
    });
    const pass = Number(/^# pass (\d+)/m.exec(res.stdout ?? '')?.[1] ?? NaN);
    const fail = Number(/^# fail (\d+)/m.exec(res.stdout ?? '')?.[1] ?? NaN);
    const okTests = Number.isFinite(pass) && Number.isFinite(fail) && fail === 0 && pass > 0;
    testCount = okTests ? pass : null;
    add('PoC tests (keys removed from the environment)', okTests ? 'PASS' : 'FAIL',
      Number.isFinite(pass) ? `${pass} pass, ${fail} fail` : 'could not read the test summary');
  }

  const blocking = checks.filter((c) => c.status === 'FAIL');
  const lines = ['# poc-complete tag check', `Mode: ${apply ? 'APPLY' : 'DRY RUN'}`];
  for (const c of checks) lines.push(`[${c.status}] ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  lines.push('');

  let exitCode = blocking.length ? 1 : 0;
  if (blocking.length) {
    lines.push(`${blocking.length} check(s) failed. No tag was created.`);
  } else {
    const msg = `PoC complete${testCount ? ` (${testCount} tests passing)` : ''}. Commit ${full.slice(0, 12)}. Not pushed.`;
    const cmd = `git tag -a ${TAG} -m "${msg}" ${full}`;
    if (!apply) {
      lines.push('All checks passed. Dry run: nothing was created. The command that --apply would run:');
      lines.push(`  ${cmd}`);
    } else {
      try {
        execFileSync('git', ['tag', '-a', TAG, '-m', msg, full], { cwd: root, stdio: 'pipe' });
        const target = (git(root, ['rev-parse', `refs/tags/${TAG}^{commit}`]) ?? '').trim();
        const type = (git(root, ['cat-file', '-t', `refs/tags/${TAG}`]) ?? '').trim();
        const ok = target === full && type === 'tag';
        lines.push(`${ok ? 'CREATED' : 'MISMATCH'}: tag ${TAG} (${type}) points to ${target.slice(0, 12)}`);
        lines.push('The tag was NOT pushed. To publish it later: git push <remote> ' + TAG);
        if (!ok) exitCode = 1;
      } catch {
        lines.push('git tag failed; nothing was created.');
        exitCode = 1;
      }
    }
  }
  return { checks, exitCode, lines: lines.map(redactLine) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const { lines, exitCode } = evaluateTag({
    commit: val('--commit') ?? 'HEAD',
    apply: a.includes('--apply'),
    allowEnvExampleModified: a.includes('--allow-env-example-modified'),
    gitleaksBin: val('--gitleaks') ?? 'gitleaks',
    skipGitleaks: a.includes('--skip-gitleaks'),
    skipTests: a.includes('--skip-tests'),
  });
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
