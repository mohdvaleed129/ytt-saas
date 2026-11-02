# ytt-server: production API server (P1 foundation)

Express 5 + MongoDB (Mongoose) + Zod + pino. Node.js 24, ES modules, plain JavaScript.

**P1 scope:** configuration, HTTP server, database connection, logging, health endpoints, validation, error handling, tests.
**Not in P1:** authentication, credits, billing, real transcription providers, deployment. The only provider is an in-memory mock,
and the server refuses to start with `NODE_ENV=production` while the mock is the only provider, so P1 cannot be deployed by accident.
No code here calls any external API or needs any API key.

## Requirements
- Node.js 24 (`node --version` must print v24.x). `engines` is `>=24.0.0 <25` (Render recommends an upper bound).
- A MongoDB for development: a local `mongod`, or an Atlas **M0 dev** cluster. Never production data.

## Setup
```bash
cd server
npm ci                    # installs the exact locked versions
cp .env.example .env      # then set MONGODB_URI (git-ignores .env; never commit it)
npm run dev               # node --watch, loads .env if present
npm start                 # production-style start, reads real environment variables only
```

## Verify (the commands your review should run)
```bash
npm ci
npm audit --omit=dev --audit-level=high      # expect: found 0 vulnerabilities
npm test                                      # unit tests; database tests are SKIPPED without a database
# With a real MongoDB (local or Atlas M0 dev). Reads only (ping); writes nothing.
# macOS/Linux:  MONGODB_TEST_URI=mongodb://127.0.0.1:27017/ytt_test REQUIRE_INTEGRATION=1 npm test
# PowerShell:   $env:MONGODB_TEST_URI="mongodb://127.0.0.1:27017/ytt_test"; $env:REQUIRE_INTEGRATION="1"; npm test
```
Expect `skipped 0` with a database on Linux/macOS. On Windows expect `skipped 1`: the SIGTERM graceful-shutdown process test is skipped
(SIGTERM is a hard kill there); CI runs it on Linux.

## Configuration (environment variables)
| Variable | Default | Rule |
|---|---|---|
| `NODE_ENV` | development | development, test, production |
| `PORT` / `HOST` | 8080 / 127.0.0.1 (0.0.0.0 in production) | |
| `LOG_LEVEL` | info | fatal, error, warn, info, debug, trace, silent |
| `MONGODB_URI` | required | mongodb:// or mongodb+srv://; placeholder values are rejected |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | 5000 | how long startup waits for MongoDB before failing fast |
| `CORS_ORIGINS` | none | comma-separated bare origins, no wildcard; https only in production |
| `TRUST_PROXY` | 0 | proxy hops in front of the app (1 behind Render) |
| `BODY_LIMIT_KB`, `RATE_LIMIT_WINDOW_SEC`, `RATE_LIMIT_MAX` | 100, 60, 120 | |
| `REQUEST_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` | 30000, 10000 | |
| `TRANSCRIPTION_PROVIDER` | mock | only `mock` exists in P1 |

On invalid configuration the process exits with code 1 and names each variable and the rule it broke. It never prints the value.

## Endpoints
- `GET /healthz`: liveness (no dependencies checked).
- `GET /readyz`: readiness. 200 when the database answers a ping and the provider is configured, otherwise 503. No error text is returned.
- Everything else: 404 in the standard error envelope `{ "error": { "code", "message", "details?", "requestId" } }`.

## Layout
```
src/config      validated environment (fails fast)
src/lib         logger (pino, redaction), error type, secret scrubbing
src/middleware  request id, request log, helmet/CORS/rate limit, validation, error handler
src/db          MongoDB connection (dedicated connection, ping, graceful close)
src/modules     feature modules (health now; others in later phases)
src/providers   transcription provider contract, mock provider, registry
src/app.js      builds the Express app from injected dependencies
src/runtime.js  start and graceful stop
src/server.js   process entry point (signals, fatal handlers)
test/           node:test suites; test-support/ holds shared fakes
```

## Notes for later phases
- Rate-limit counters are in memory: correct for a single instance only.
- Render picks the first `package.json` it finds when none is at the repo root; set the service's root directory to `server`
  (or set `NODE_VERSION`) in P9, because `poc/package.json` has an unbounded `engines` range.
