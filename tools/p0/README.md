# P0: secret scanning, CI skeleton and the `poc-complete` tag

Nothing here touches `poc/`, calls any API, or deploys anything. None of these tools ever prints a key value.

## What is in P0

| File | Purpose |
|---|---|
| `.gitleaks.toml` | Scanner rules: gitleaks defaults plus Supadata, Razorpay and MongoDB credential rules |
| `.githooks/pre-commit` | Blocks a commit whose staged changes contain a secret. Fails closed if gitleaks is missing |
| `.github/workflows/ci.yml` | GitHub Actions: full-history secret scan, PoC tests, P0 tooling tests. No secrets are used or needed |
| `tools/p0/preflight.mjs` | Read-only report, secure backup of `poc/.env.example`, masked preview of planned changes |
| `tools/p0/tag-poc.mjs` | Verifies everything, then dry-runs or creates the annotated tag `poc-complete`. Never pushes |
| `tools/p0/test/` | 22 tests for the tools themselves |

## Install gitleaks (needed by the hook and by the tag check)

Windows (PowerShell): download `gitleaks_8.30.1_windows_x64.zip` from the gitleaks v8.30.1 GitHub release.
Compare its SHA-256 with the line for that file in the release's `gitleaks_8.30.1_checksums.txt`:

```powershell
Get-FileHash .\gitleaks_8.30.1_windows_x64.zip -Algorithm SHA256
```

The published value for that file is `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`.
Unzip, put `gitleaks.exe` in a folder on your `PATH`, then check `gitleaks version` prints `8.30.1`.
(The checksum comes from the same release page as the file, so it protects against a corrupted download, not against a compromised release.)

## Run order (you run every command; stop and read the output of each step)

```bash
# 0. Safe report + secure backup. Add --dry-run first if you want zero writes.
node tools/p0/preflight.mjs --dry-run
node tools/p0/preflight.mjs
```

Read section 4 of the output. It shows what restoring `poc/.env.example` would change, with values masked. **Do not run `git restore` yet.**

```bash
# 1. Commit your PoC changes WITHOUT poc/.env.example (the exact `git add` line is printed by the preflight)
git add <the paths the preflight printed>
git status --short                       # only " M poc/.env.example" may remain under poc/
git commit -m "feat(poc): final PoC state"

# 2. Enable the hook, commit the P0 files
git config core.hooksPath .githooks
git add --chmod=+x .githooks/pre-commit
git add .gitleaks.toml .github tools
git commit -m "chore(p0): secret scanning, CI skeleton, P0 tooling"

# 3. Tag the PoC commit (dry run, then apply). Find its hash with: git log --oneline
node tools/p0/tag-poc.mjs --commit <poc-commit-hash> --allow-env-example-modified
node tools/p0/tag-poc.mjs --commit <poc-commit-hash> --allow-env-example-modified --apply
```

`git commit -a` or `git add -A` would stage the real keys in `poc/.env.example`. The hook blocks that, but do not rely on it: stage by path.

## What the tag check verifies

Repository and git identity, the tag does not exist locally or on any remote, the commit exists and is an ancestor of HEAD, `poc/` is identical at that commit and at HEAD, the working tree has no changes other than the one allowed unstaged `poc/.env.example`, no secret pattern in any commit (built-in scan and gitleaks), and the PoC tests pass with every key-like environment variable removed. If any check fails, no tag is created.

## Tests

```bash
cd tools/p0 && node --test
```
