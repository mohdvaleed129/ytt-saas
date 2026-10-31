# Proof of Concept: URL -> transcript (real Supadata API)

Goal: verify the real workflow BEFORE building the app. Nothing here is mocked: `src/poc.js`
calls the live Supadata API (and optionally the official YouTube Data API) and records what
actually comes back.

## Requirements
Node 20.6+ (tested on 22). No npm dependencies.

## Setup
```bash
cd poc
cp .env.example .env        # then fill in SUPADATA_API_KEY (free: https://dash.supadata.ai)
```
Optional: add `YOUTUBE_API_KEY` (Google Cloud, YouTube Data API v3). It is REQUIRED for any AI-mode
test, because AI cost depends on video length and we refuse to spend when duration is unknown.

Open `test-matrix.json` and fill every empty `"url"` with a public video you can watch in an
incognito window. Empty entries are reported SKIPPED, never faked.

## Run
```bash
npm test                                   # offline logic tests (no network, no credits)
npm run poc                                # native mode only: 1 credit per case, never AI
npm run poc -- --as-given                  # send URLs exactly as written (Shorts URL form test)
npm run poc -- --allow-generate --max-credits 10 --url "<<short clip URL>>" --mode generate
```
Free plan = 100 credits/month, 1 request/second (the runner paces itself).
Expected spend for the default matrix once filled in: about 12 credits. One AI test of a
90-second clip costs 4.

## What each result tells us
| Question | Where to look in the output |
|---|---|
| Do captions come back with timestamps? | `stats`, `sample.first/last` (offset and duration are ms) |
| Is timing sane? | `stats.outOfOrder`, `overlaps`, `zeroDuration`, `coverage` (last cue end / video length) |
| Is text clean? | `stats.withHtmlEntities` (YouTube captions sometimes contain `&amp;`-style entities) |
| Language fallback? | `requestedLang` vs `lang`, `langFallback`, `availableLangs` |
| No captions? | outcome `unavailable` (HTTP 206, billed 1 credit per docs) |
| Do Shorts work, and in which URL form? | compare `short-captioned-watch-form` vs `--as-given` run |
| Async jobs? | `jobId`, `jobPolls`, `jobElapsedMs`, `jobResultShape` (`top-level` vs `nested-result`) |
| Real cost? | `credits` (from `x-billable-requests`) per case |
| Restricted videos? | `private-or-unavailable` -> expected 403/404 |

Results are saved to `results/` (git-ignored: they contain transcript text).
Exit code 1 only when a case with an explicit `expect` fails.
