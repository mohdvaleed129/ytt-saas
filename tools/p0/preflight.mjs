#!/usr/bin/env node
// P0 preflight. Run from anywhere inside the repository:
//   node tools/p0/preflight.mjs            (do the backup, print the report)
//   node tools/p0/preflight.mjs --dry-run  (print the report, write nothing at all)
//
// What it does NOT do: it never modifies the repository, never runs `git restore`, never calls any API,
// and never prints a secret value. Values are shown only as NAME=<REDACTED len=N>.
// The only thing it writes is a permission-restricted backup of poc/.env.example OUTSIDE the repo.

import { existsSync, readFileSync, mkdirSync, copyFileSync, chmodSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, repoRoot, statusEntries } from './lib/git.mjs';
import {
  classifyValue, parseEnv, redactLine, secretValuesOf, assertNoLeak, lineDiff, findSecretIds,
} from './lib/secrets.mjs';

export const P0_FILES = [
  '.gitleaks.toml',
  '.githooks/pre-commit',
  '.github/workflows/ci.yml',
  'tools/p0/README.md',
  'tools/p0/preflight.mjs',
  'tools/p0/tag-poc.mjs',
  'tools/p0/lib/secrets.mjs',
  'tools/p0/lib/git.mjs',
  'tools/p0/test-support/repo.mjs',
  'tools/p0/test/secrets.test.mjs',
  'tools/p0/test/preflight.test.mjs',
  'tools/p0/test/tag-poc.test.mjs',
];

const ENV_EXAMPLE = 'poc/.env.example';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function lockDown(target, isDir, platform) {
  if (platform === 'win32') {
    const user = process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
    if (!user) throw new Error('Cannot determine the current Windows user for the ACL.');
    execFileSync('icacls', [target, '/inheritance:r', '/grant:r', `${user}:${isDir ? '(OI)(CI)F' : 'F'}`], { stdio: 'pipe' });
    return execFileSync('icacls', [target], { encoding: 'utf8' }).trim().split(/\r?\n/).map((l) => `    ${l}`).join('\n');
  }
  chmodSync(target, isDir ? 0o700 : 0o600);
  return `    mode ${isDir ? '700' : '600'} (owner only)`;
}

export function runPreflight({
  cwd = process.cwd(), backupDir = null, dryRun = false, now = new Date(), platform = process.platform,
} = {}) {
  const lines = [];
  const say = (s = '') => lines.push(redactLine(s));
  let exitCode = 0;
  const secrets = [];

  const root = repoRoot(cwd);
  if (!root) {
    return { lines: ['Not inside a git repository.'], exitCode: 2 };
  }

  say('# P0 preflight');
  say(`Repository: ${root}`);
  say(`Mode: ${dryRun ? 'DRY RUN (nothing is written)' : 'normal (writes only the external backup)'}`);

  // 1. Repository state ------------------------------------------------------------------
  say('');
  say('## 1. Repository state');
  const branch = (git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) ?? '?').trim();
  const head = (git(root, ['rev-parse', '--short', 'HEAD'], { allowFail: true }) ?? '?').trim();
  say(`Branch: ${branch}   HEAD: ${head}`);
  const tags = (git(root, ['tag', '--list']) ?? '').split('\n').filter(Boolean);
  say(`Existing tags: ${tags.length ? tags.join(', ') : '(none)'}`);
  say(`Tag "poc-complete" already exists: ${tags.includes('poc-complete') ? 'YES (do not create it)' : 'no'}`);
  const entries = statusEntries(root);
  const pocChanges = entries.filter((e) => e.path.startsWith('poc/') && e.path !== ENV_EXAMPLE);
  const envEntry = entries.find((e) => e.path === ENV_EXAMPLE);
  const p0Present = P0_FILES.filter((f) => existsSync(path.join(root, f)));
  const other = entries.filter((e) => !e.path.startsWith('poc/') && !P0_FILES.includes(e.path)
    && !e.path.startsWith('tools/p0/') && !e.path.startsWith('.githooks/') && !e.path.startsWith('.github/'));
  say(`Changes under poc/ other than ${ENV_EXAMPLE}: ${pocChanges.length}`);
  for (const e of pocChanges) say(`  ${e.x}${e.y} ${e.path}`);
  say(`${ENV_EXAMPLE}: ${envEntry ? `status "${envEntry.x}${envEntry.y}"` : 'no uncommitted change'}`);
  say(`P0 files present in the working tree: ${p0Present.length} of ${P0_FILES.length}`);
  say(`Other uncommitted paths: ${other.length}${other.length ? ` -> ${other.map((e) => e.path).join(', ')}` : ''}`);
  for (const p of ['.env', 'poc/.env', 'poc/results/x.json']) {
    const ig = git(root, ['check-ignore', '-q', p], { allowFail: true });
    say(`Git ignores ${p}: ${ig === null ? 'NO' : 'yes'}`);
  }

  // 2. poc/.env.example, masked ----------------------------------------------------------
  say('');
  say(`## 2. ${ENV_EXAMPLE} (values are never printed)`);
  const envPath = path.join(root, ENV_EXAMPLE);
  let working = null;
  if (!existsSync(envPath)) {
    say('File not found in the working tree.');
  } else {
    working = readFileSync(envPath);
    const text = working.toString('utf8');
    secrets.push(...secretValuesOf(text));
    const committed = git(root, ['show', `HEAD:${ENV_EXAMPLE}`], { allowFail: true });
    if (committed) secrets.push(...secretValuesOf(committed));
    const wParsed = parseEnv(text).filter((e) => e.name);
    say('Working copy:');
    for (const e of wParsed) {
      const cls = classifyValue(e.value);
      say(`  ${e.name}: ${cls}${cls === 'secret-like' ? ` (length ${e.value.length})` : ''}`);
    }
    if (committed !== null) {
      say('Committed version (HEAD):');
      for (const e of parseEnv(committed).filter((x) => x.name)) say(`  ${e.name}: ${classifyValue(e.value)}`);
      say(`Working copy differs from HEAD: ${committed === text ? 'no' : 'YES'}`);
      say(`Secret patterns in the committed version: ${findSecretIds(committed).length ? findSecretIds(committed).join(', ') : 'none'}`);
    }
    const dotEnv = path.join(root, 'poc', '.env');
    if (existsSync(dotEnv)) {
      const envVals = new Map(parseEnv(readFileSync(dotEnv, 'utf8')).filter((e) => e.name).map((e) => [e.name, e.value]));
      secrets.push(...secretValuesOf(readFileSync(dotEnv, 'utf8')));
      say('Same value also present in poc/.env (so a restore loses nothing):');
      for (const e of wParsed.filter((x) => classifyValue(x.value) === 'secret-like')) {
        const other2 = envVals.get(e.name);
        say(`  ${e.name}: ${other2 === undefined ? 'not in poc/.env' : sha256(other2) === sha256(e.value) ? 'identical' : 'DIFFERENT'}`);
      }
    } else {
      say('poc/.env not found, so I cannot confirm the keys also exist there. Do NOT restore until you have your own copy.');
    }
  }

  // 3. Backup ----------------------------------------------------------------------------
  say('');
  say('## 3. Secure backup of the current file');
  if (!working) {
    say('Nothing to back up.');
  } else {
    const dir = backupDir ?? path.join(path.dirname(root), 'ytt-secure-backup');
    const rel = path.relative(root, dir);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      say(`REFUSED: backup folder ${dir} is inside the repository.`);
      exitCode = 1;
    } else {
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      const target = path.join(dir, `poc.env.example.${stamp}.bak`);
      if (/onedrive|dropbox|google ?drive|icloud|sync/i.test(dir)) {
        say('WARNING: that folder looks like a cloud-synced location. Pick another with --backup-dir.');
      }
      if (dryRun) {
        say(`Would create: ${target}`);
      } else {
        try {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          const acl = [lockDown(dir, true, platform)];
          copyFileSync(envPath, target, constants.COPYFILE_EXCL);
          acl.push(lockDown(target, false, platform));
          const ok = sha256(readFileSync(target)) === sha256(working);
          say(`Backup file: ${target}`);
          say(`Integrity check (SHA-256 of copy equals original): ${ok ? 'PASS' : 'FAIL'}`);
          say('Permissions:');
          acl.forEach((a) => say(a));
          say('The backup is protected by filesystem permissions, not encrypted. Delete it after the keys are rotated.');
          if (!ok) exitCode = 1;
        } catch (e) {
          say(`BACKUP FAILED: ${e.code ?? e.message}. Nothing else was changed.`);
          exitCode = 1;
        }
      }
    }
  }

  // 4. Planned changes -------------------------------------------------------------------
  say('');
  say('## 4. Planned changes (NOTHING IS APPLIED)');
  say(`A. ${ENV_EXAMPLE}: no change now. You asked me not to restore it yet.`);
  if (working) {
    const committed = git(root, ['show', `HEAD:${ENV_EXAMPLE}`], { allowFail: true });
    if (committed !== null && committed !== working.toString('utf8')) {
      say('   If you later run `git restore poc/.env.example`, this is what would change (secret values masked):');
      const diff = lineDiff(working.toString('utf8').split(/\r?\n/), committed.split(/\r?\n/));
      for (const d of diff.filter((x) => x.t !== ' ')) say(`   ${d.t} ${redactLine(d.line)}`);
    }
  }
  say(`B. New files P0 adds (none exist in the repository at HEAD): ${P0_FILES.length}`);
  for (const f of P0_FILES) say(`   ${p0Present.includes(f) ? '[present]' : '[missing]'} ${f}`);
  say('C. poc/ is not modified by any P0 step.');

  // 5. Commit and tag plan ---------------------------------------------------------------
  say('');
  say('## 5. Commit and tag plan (you run these; I run nothing)');
  if (pocChanges.length) {
    say('Your PoC changes are not committed yet, so a tag on HEAD would NOT contain them.');
    say('Step 1 - stage the PoC changes, deliberately WITHOUT poc/.env.example:');
    say(`   git add ${pocChanges.map((e) => `"${e.path}"`).join(' ')}`);
    say('   git status --short     (the only remaining poc/ line must be: " M poc/.env.example")');
    say('   git commit -m "feat(poc): final PoC state (transcript saving, overlap diagnostic, matrix URLs)"');
  } else {
    say('No uncommitted PoC changes besides the env file.');
  }
  say('Step 2 - add and commit the P0 files, with the pre-commit hook enabled first:');
  say('   git config core.hooksPath .githooks');
  say('   git add --chmod=+x .githooks/pre-commit && git add .gitleaks.toml .github tools');
  say('   git commit -m "chore(p0): secret scanning, CI skeleton, P0 tooling"');
  say('Step 3 - verify, then tag the PoC commit (dry run first):');
  say('   node tools/p0/tag-poc.mjs --commit <hash of the PoC commit> --allow-env-example-modified');
  say('   node tools/p0/tag-poc.mjs --commit <hash of the PoC commit> --allow-env-example-modified --apply');

  say('');
  say(`Result: ${exitCode === 0 ? 'OK' : 'PROBLEMS FOUND (see above)'}. The repository itself was not modified.`);

  try {
    assertNoLeak(lines.join('\n'), secrets);
  } catch (e) {
    return { lines: [e.message], exitCode: 1 };
  }
  return { lines, exitCode };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--backup-dir');
  const { lines, exitCode } = runPreflight({
    dryRun: args.includes('--dry-run'),
    backupDir: bi >= 0 ? path.resolve(args[bi + 1]) : null,
  });
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
