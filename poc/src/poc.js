#!/usr/bin/env node
// Proof of concept runner. Calls the REAL Supadata API (and optionally the official
// YouTube Data API) for each case in the test matrix and records what actually happens.
//
// Cost safety, in order of enforcement:
//   1. Default mode is "native" (only fetches existing captions, 1 credit, never AI).
//   2. AI modes (auto/generate) are skipped unless --allow-generate is passed.
//   3. AI modes additionally require a known duration (YOUTUBE_API_KEY), a non-live video,
//      and duration <= --max-generate-sec. Unknown duration = unknown cost = refused.
//   4. A hard credit budget (--max-credits) stops the run before it is exceeded.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { parseYouTubeUrl } from './youtube-url.js';
import { createSupadataClient, SupadataError } from './supadata-client.js';
import { getVideoMeta } from './youtube-meta.js';
import { normalizeSegments, analyzeSegments, toSrt } from './transcript-format.js';

const HELP = `
Usage: npm run poc -- [options]

  --matrix <file>          Test matrix JSON (default: test-matrix.json)
  --url <youtube-url>      Run a single ad-hoc case instead of the matrix
  --mode <native|auto|generate>   Override mode (single case or all cases)
  --lang <code>            Preferred language for ad-hoc case
  --allow-generate         Permit AI modes (costs 2 credits per video minute)
  --max-credits <n>        Hard credit budget for this run (default 25)
  --max-generate-sec <n>   Longest video allowed for AI modes (default 180)
  --as-given               Send the URL exactly as written (default: canonical watch URL)
  --out <dir>              Results directory (default: results)
`;

const { values: args } = parseArgs({
  options: {
    matrix: { type: 'string', default: 'test-matrix.json' },
    url: { type: 'string' },
    mode: { type: 'string' },
    lang: { type: 'string' },
    'allow-generate': { type: 'boolean', default: false },
    'max-credits': { type: 'string', default: '25' },
    'max-generate-sec': { type: 'string', default: '180' },
    'as-given': { type: 'boolean', default: false },
    out: { type: 'string', default: 'results' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY?.trim();
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY?.trim();
if (!SUPADATA_API_KEY) {
  console.error('SUPADATA_API_KEY is missing. Copy .env.example to .env and fill it in.');
  process.exit(2);
}

const maxCredits = Number(args['max-credits']);
const maxGenerateSec = Number(args['max-generate-sec']);
const allowGenerate = args['allow-generate'];
const client = createSupadataClient({ apiKey: SUPADATA_API_KEY, allowGenerate, timeoutMs: 120_000 });

let spent = 0;
let creditsUnknown = 0;

function estimateCredits(mode, durationSec) {
  if (mode === 'native') return 1;
  return 2 * Math.ceil(durationSec / 60); // worst case for auto, exact for generate
}

async function runCase(entry) {
  const result = {
    label: entry.label,
    category: entry.category ?? null,
    input: entry.url ?? '',
    mode: null,
    outcome: null,
    verdict: 'OBSERVED',
    notes: [],
  };
  const finish = (outcome, extra = {}) => {
    Object.assign(result, { outcome }, extra);
    if (entry.expect) {
      const e = entry.expect;
      const ok =
        e.outcome === outcome &&
        (!e.code || e.code === result.code) &&
        (!e.lang || e.lang === result.lang);
      result.verdict = outcome === 'skipped' ? 'SKIPPED' : ok ? 'PASS' : 'FAIL';
    } else if (outcome === 'skipped') {
      result.verdict = 'SKIPPED';
    }
    return result;
  };

  if (!entry.url || !entry.url.trim()) {
    return finish('skipped', { code: 'NO_URL', notes: ['No URL provided in the matrix for this case.'] });
  }

  const parsed = parseYouTubeUrl(entry.url);
  if (!parsed.ok) return finish('rejected-locally', { code: parsed.code, message: parsed.message });

  const mode = args.mode ?? entry.mode ?? 'native';
  result.mode = mode;
  result.videoId = parsed.videoId;
  result.urlKind = parsed.kind;

  if (mode !== 'native' && !allowGenerate) {
    return finish('skipped', { code: 'AI_DISABLED', notes: ['AI modes need --allow-generate.'] });
  }

  // Metadata (official API). Informational for native; mandatory gate for AI modes.
  let meta = null;
  if (YOUTUBE_API_KEY) {
    try {
      meta = await getVideoMeta({ videoId: parsed.videoId, apiKey: YOUTUBE_API_KEY });
      result.meta = meta.found
        ? { title: meta.title, durationSec: meta.durationSec, isLiveOrUpcoming: meta.isLiveOrUpcoming,
            defaultAudioLanguage: meta.defaultAudioLanguage }
        : { found: false };
    } catch (err) {
      result.notes.push(`Metadata lookup failed: ${err.message}`);
    }
  }

  let estimate = 1;
  if (mode !== 'native') {
    if (!meta?.found || !Number.isFinite(meta.durationSec)) {
      return finish('blocked-by-guard', {
        code: 'DURATION_UNKNOWN',
        notes: ['AI mode refused: duration unknown (set YOUTUBE_API_KEY), so cost cannot be bounded.'],
      });
    }
    if (meta.isLiveOrUpcoming) return finish('blocked-by-guard', { code: 'LIVE_UNSUPPORTED' });
    if (meta.durationSec > maxGenerateSec) {
      return finish('blocked-by-guard', {
        code: 'DURATION_CAP',
        notes: [`${meta.durationSec}s exceeds --max-generate-sec ${maxGenerateSec}.`],
      });
    }
    estimate = estimateCredits(mode, meta.durationSec);
  }

  if (spent + estimate > maxCredits) {
    return finish('skipped', {
      code: 'BUDGET',
      notes: [`Would exceed --max-credits (${spent}+${estimate} > ${maxCredits}).`],
    });
  }

  const sendUrl = args['as-given'] ? entry.url.trim() : parsed.canonicalUrl;
  result.sentUrl = sendUrl;
  result.requestedLang = args.lang ?? entry.lang ?? null;

  const t0 = performance.now();
  try {
    let res = await client.getTranscript({ url: sendUrl, lang: result.requestedLang ?? undefined, mode });
    let credits = res.billableCredits;
    let httpStatus = res.httpStatus;

    if (res.kind === 'job') {
      result.jobId = res.jobId;
      result.notes.push(`Async job started (HTTP 202), precharge header: ${res.billableCredits}`);
      const job = await client.waitForJob(res.jobId, { intervalMs: 1000, timeoutMs: 300_000 });
      result.jobPolls = job.polls;
      result.jobElapsedMs = job.elapsedMs;
      if (job.status === 'failed') {
        spent += credits ?? estimate;
        return finish('job-failed', { code: 'JOB_FAILED', message: JSON.stringify(job.error), httpStatus,
          credits, latencyMs: Math.round(performance.now() - t0) });
      }
      result.jobResultShape = job.shape;
      res = { kind: 'transcript', ...job };
    }

    if (credits === null) creditsUnknown++;
    spent += credits ?? estimate;
    const latencyMs = Math.round(performance.now() - t0);

    if (res.kind === 'unavailable') {
      return finish('unavailable', { httpStatus, credits, latencyMs, message: res.message });
    }

    const stats = analyzeSegments(res.content, meta?.durationSec ?? null);
    const normalized = normalizeSegments(res.content);
    const srt = toSrt(normalized);
    return finish(res.content.length === 0 ? 'empty-transcript' : 'transcript', {
      httpStatus, credits, latencyMs,
      lang: res.lang,
      availableLangs: res.availableLangs,
      langFallback: result.requestedLang && res.lang && result.requestedLang !== res.lang,
      bodyKeys: res.bodyKeys ?? null,
      stats,
      normalizedCount: normalized.length,
      srtBytes: Buffer.byteLength(srt),
      sample: { first: res.content.slice(0, 3), last: res.content.slice(-2) },
    });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    if (err instanceof SupadataError) {
      // Errors are not documented as billable except 206; do not assume otherwise.
      return finish('api-error', {
        code: err.code, httpStatus: err.httpStatus, message: err.message, latencyMs,
        retryAfterSec: err.retryAfterSec, fatal: err.code === 'unauthorized',
      });
    }
    return finish('api-error', { code: 'LOCAL_ERROR', message: err.message, latencyMs });
  }
}

function pad(v, n) {
  const s = String(v ?? '-');
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function main() {
  let cases;
  if (args.url) {
    cases = [{ label: 'adhoc', category: 'ad-hoc', url: args.url, lang: args.lang }];
  } else {
    const matrix = JSON.parse(await readFile(args.matrix, 'utf8'));
    cases = matrix.cases;
  }

  console.log(`Running ${cases.length} case(s). AI modes: ${allowGenerate ? 'ENABLED' : 'disabled'}. ` +
    `Budget: ${maxCredits} credits. Metadata lookup: ${YOUTUBE_API_KEY ? 'on' : 'off'}.\n`);

  const results = [];
  for (const entry of cases) {
    const r = await runCase(entry);
    results.push(r);
    console.log(`[${pad(r.verdict, 8)}] ${pad(r.label, 34)} ${pad(r.outcome, 17)} ` +
      `${r.code ? `code=${r.code} ` : ''}${r.lang ? `lang=${r.lang} ` : ''}` +
      `${r.stats ? `segs=${r.stats.segmentCount} ` : ''}${r.credits != null ? `credits=${r.credits} ` : ''}` +
      `${r.latencyMs != null ? `${r.latencyMs}ms` : ''}`);
    if (r.fatal) {
      console.error('\nUnauthorized: check SUPADATA_API_KEY. Stopping to avoid pointless requests.');
      break;
    }
    // Free tier allows 1 request/second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  const counts = results.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] ?? 0) + 1), acc), {});
  console.log('\nSummary:', counts);
  console.log(`Credits consumed (header-reported or estimated): ${spent}` +
    (creditsUnknown ? `  [${creditsUnknown} response(s) had no x-billable-requests header]` : ''));

  await mkdir(args.out, { recursive: true });
  const file = `${args.out}/poc-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(file, JSON.stringify({ ranAt: new Date().toISOString(), allowGenerate, maxCredits,
    creditsConsumed: spent, results }, null, 2));
  console.log(`Full results written to ${file} (contains transcript samples; not committed to git).`);

  process.exit(results.some((r) => r.verdict === 'FAIL') ? 1 : 0);
}

main().catch((err) => {
  console.error('PoC crashed:', err.message);
  process.exit(2);
});
